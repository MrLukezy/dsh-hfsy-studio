/**
 * dsh-hfsy-studio —— 宿主半边。
 *
 * 职责：
 * 1. 在本机 dsh 的 Web 服务上挂 `/hfsy-studio/api/*` 路由，浏览器只跟本机说话，密钥不出宿主进程。
 * 2. 调 hfsy 中转（OpenAI 兼容）出图 / 出片，结果落到 outputDir，并按天归档文件名。
 * 3. 维护内存任务表（进度、取消）与磁盘历史（history.json），供工作台页面轮询。
 *
 * 设计约束：
 * - 不 import 任何 @deepseek-ai/* 运行时包：插件以普通 ESM 装进 profile，靠 ctx 注入取服务。
 * - 所有注册都包在 ctx.effect 里，插件卸载即回收路由与在跑任务。
 */

import { spawn } from 'node:child_process'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const name = 'hfsy-studio'

const ROUTE_PREFIX = '/hfsy-studio/api'
const HISTORY_VERSION = 1
const MAX_HISTORY = 400
const MAX_FINISHED_JOBS = 20

/** 默认出图模型：hfsy 中转上可用的 OpenAI 兼容图像模型。 */
const DEFAULT_IMAGE_MODELS = [
  'gpt-image-2',
  'gpt-image-2.5',
  'gpt-image-2.6',
  'gpt-image-2pro',
  'gpt-image-2pro-4k',
]

/** 默认出片模型：hfsy 中转列出了这些，但当前站点未配价格，调用会返回 model_price_error。 */
const DEFAULT_VIDEO_MODELS = [
  'Doubao-Seedance-2.0-fast',
  'Doubao-Seedance-2.0',
  'Doubao-Seedance-2.5',
]

/** 出图尺寸上限（像素），防止手滑写个 10000x10000。 */
const MAX_IMAGE_EDGE = 4096

/* ------------------------------------------------------------------ 配置 */

function clampInt(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

function pickString(value, fallback) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback
}

function pickList(value, fallback) {
  if (!Array.isArray(value)) return fallback
  const list = value.filter((item) => typeof item === 'string' && item.trim() !== '').map((item) => item.trim())
  return list.length > 0 ? [...new Set(list)] : fallback
}

/** 把补丁里的 config 归一成宿主内部结构；缺项一律回落默认值。 */
function normalizeConfig(raw) {
  const input = raw && typeof raw === 'object' ? raw : {}
  const outputDir = path.resolve(pickString(input.outputDir, path.join(process.cwd(), 'hfsy-output')))
  return {
    baseUrl: pickString(input.baseUrl, 'https://www.hfsyapi.cn/v1').replace(/\/+$/u, ''),
    apiKeyEnv: pickString(input.apiKeyEnv, 'OPENAI_API_KEY'),
    outputDir,
    historyFile: path.join(outputDir, 'history.json'),
    imageModels: pickList(input.imageModels, DEFAULT_IMAGE_MODELS),
    videoModels: pickList(input.videoModels, DEFAULT_VIDEO_MODELS),
    maxConcurrent: clampInt(input.maxConcurrent, 1, 4, 2),
    requestTimeoutMs: clampInt(input.requestTimeoutMs, 15_000, 600_000, 240_000),
    maxRetries: clampInt(input.maxRetries, 0, 4, 2),
    videoPollMs: clampInt(input.videoPollMs, 2_000, 30_000, 5_000),
    videoTimeoutMs: clampInt(input.videoTimeoutMs, 60_000, 1_800_000, 900_000),
  }
}

/* -------------------------------------------------------------- HTTP 工具 */

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

async function readJsonBody(req, limit = 64 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  return parsed && typeof parsed === 'object' ? parsed : {}
}

/** 只接受同源页面发来的请求，别让别的本地网页借道刷你的额度。 */
function sameOriginOnly(req) {
  const origin = req.headers.origin
  const host = req.headers.host
  if (typeof origin === 'string' && origin.length > 0) {
    try {
      if (new URL(origin).host !== host) return false
    } catch {
      return false
    }
  }
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  return true
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/* ------------------------------------------------------------ 中转调用的底层 */

/** 从 New API 风格的中转错误体里挖出人话。 */
function providerMessage(text) {
  if (typeof text !== 'string' || text.trim() === '') return ''
  try {
    const parsed = JSON.parse(text)
    const error = parsed?.error
    if (typeof error === 'string') return error
    if (error && typeof error.message === 'string') return error.message
    if (typeof parsed?.message === 'string') return parsed.message
    if (typeof parsed?.msg === 'string') return parsed.msg
  } catch {
    /* 不是 JSON，直接当文本 */
  }
  return text.slice(0, 500)
}

function retryableStatus(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500
}

class ProviderError extends Error {
  constructor(message, { status, retryable } = {}) {
    super(message)
    this.name = 'ProviderError'
    this.status = status
    this.retryable = Boolean(retryable)
  }
}

/**
 * 带重试的 JSON 请求。
 * timeout 用独立 AbortController，保证外部取消（job.stop）能立刻打断重试循环。
 */
async function requestJson(config, key, route, { method = 'POST', body, signal, timeoutMs } = {}) {
  const url = `${config.baseUrl}${route}`
  const budget = timeoutMs ?? config.requestTimeoutMs
  let attempt = 0
  for (;;) {
    attempt += 1
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new DOMException('请求超时', 'TimeoutError')), budget)
    const relayAbort = () => controller.abort(signal?.reason)
    signal?.addEventListener('abort', relayAbort, { once: true })
    try {
      const response = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${key}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      })
      const text = await response.text()
      if (!response.ok) {
        throw new ProviderError(providerMessage(text) || `HTTP ${response.status}`, {
          status: response.status,
          retryable: retryableStatus(response.status),
        })
      }
      return text.trim() === '' ? {} : JSON.parse(text)
    } catch (error) {
      const aborted = controller.signal.aborted
      const timedOut = aborted && controller.signal.reason?.name === 'TimeoutError'
      const network = error instanceof TypeError
      const retryable = error instanceof ProviderError ? error.retryable : timedOut || network
      if (signal?.aborted || attempt > config.maxRetries || !retryable) throw error
      await sleep(600 * attempt)
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', relayAbort)
    }
  }
}

/** 下载成品文件；校验大小上限，避免被塞一个离谱的响应。 */
async function downloadBinary(url, signal, maxBytes = 64 * 1024 * 1024) {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new ProviderError(`下载结果失败：HTTP ${response.status}`, { status: response.status })
  const length = Number(response.headers.get('content-length') ?? '0')
  if (length > maxBytes) throw new ProviderError(`结果文件过大：${length} 字节`)
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.byteLength > maxBytes) throw new ProviderError(`结果文件过大：${buffer.byteLength} 字节`)
  return buffer
}

/* --------------------------------------------------------------- 图片探测 */

/** 读 PNG / JPEG / WebP 头拿宽高；拿不到就返回空对象，画廊按 1:1 兜底。 */
function probeImageSize(buffer) {
  if (buffer.length > 24 && buffer[0] === 0x89 && buffer.toString('ascii', 1, 4) === 'PNG') {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  }
  if (buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buffer.toString('ascii', 12, 16)
    if (chunk === 'VP8X' && buffer.length > 30) {
      return {
        width: 1 + buffer.readUIntLE(24, 3),
        height: 1 + buffer.readUIntLE(27, 3),
      }
    }
    if (chunk === 'VP8 ' && buffer.length > 30) {
      return {
        width: buffer.readUInt16LE(26) & 0x3fff,
        height: buffer.readUInt16LE(28) & 0x3fff,
      }
    }
    if (chunk === 'VP8L' && buffer.length > 25) {
      const bits = buffer.readUInt32LE(21)
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
    }
  }
  if (buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1
        continue
      }
      const marker = buffer[offset + 1]
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) }
      }
      const length = buffer.readUInt16BE(offset + 2)
      if (length <= 0) break
      offset += 2 + length
    }
  }
  return {}
}

/** 判断图片魔数，顺手定扩展名，别把 webp 存成 png。 */
function sniffImage(buffer) {
  if (buffer.length > 8 && buffer[0] === 0x89 && buffer.toString('ascii', 1, 4) === 'PNG') return { ext: 'png', mediaType: 'image/png' }
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8) return { ext: 'jpg', mediaType: 'image/jpeg' }
  if (buffer.length > 12 && buffer.toString('ascii', 8, 12) === 'WEBP') return { ext: 'webp', mediaType: 'image/webp' }
  return undefined
}

function sniffVideo(buffer, contentType) {
  if (buffer.length > 12 && buffer.toString('ascii', 4, 8) === 'ftyp') return 'mp4'
  if (typeof contentType === 'string' && contentType.includes('webm')) return 'webm'
  return 'mp4'
}

/* ------------------------------------------------------------------- 落盘 */

function dateParts(timestamp = Date.now()) {
  const date = new Date(timestamp)
  const pad = (n) => String(n).padStart(2, '0')
  return {
    day: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`,
  }
}

/** 提示词 → 文件名片段：保留中文，剔掉 Windows 非法字符。 */
function slugify(prompt, limit = 28) {
  const cleaned = String(prompt ?? '')
    .replace(/[\u0000-\u001f\\/:*?"<>|]/gu, ' ')
    .replace(/\s+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  return cleaned.slice(0, limit) || 'result'
}

/* ------------------------------------------------------------------- 插件 */

/** 注册工作台的 HTTP 路由与生成引擎。 */
export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  const logger = ctx.logger ?? console
  const jobs = new Map()
  const active = new Set()
  let history = []
  let historyLoaded = undefined
  let writeChain = Promise.resolve()

  const now = () => Date.now()

  /* ---- 历史 ---- */

  async function loadHistory() {
    if (historyLoaded !== undefined) return historyLoaded
    historyLoaded = (async () => {
      try {
        const raw = await readFile(config.historyFile, 'utf8')
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed?.entries)) {
          history = parsed.entries.filter((entry) => entry && typeof entry.file === 'string')
        }
      } catch (error) {
        if (error?.code !== 'ENOENT') logger.warn?.(`[hfsy-studio] 读取历史失败：${error?.message ?? error}`)
      }
      return history
    })()
    return historyLoaded
  }

  function persistHistory() {
    writeChain = writeChain.then(async () => {
      try {
        await mkdir(config.outputDir, { recursive: true })
        const file = `${config.historyFile}.tmp`
        await writeFile(file, JSON.stringify({ version: HISTORY_VERSION, entries: history }, null, 2), 'utf8')
        await rename(file, config.historyFile)
      } catch (error) {
        logger.warn?.(`[hfsy-studio] 写历史失败：${error?.message ?? error}`)
      }
    })
    return writeChain
  }

  function recordHistory(entry) {
    history.unshift(entry)
    if (history.length > MAX_HISTORY) history = history.slice(0, MAX_HISTORY)
    return persistHistory()
  }

  /* ---- 密钥 ---- */

  let credentials
  ctx.inject(['credentials'], (credentialCtx) => {
    credentials = credentialCtx.credentials
  })

  async function resolveKey() {
    try {
      const hit = await credentials?.resolve?.(config.apiKeyEnv)
      if (hit && typeof hit.value === 'string' && hit.value.trim() !== '') {
        return { value: hit.value.trim(), source: hit.source ?? 'credentials' }
      }
    } catch (error) {
      logger.warn?.(`[hfsy-studio] 解析凭据失败：${error?.message ?? error}`)
    }
    const fromEnv = process.env[config.apiKeyEnv]
    if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return { value: fromEnv.trim(), source: 'env' }
    return undefined
  }

  /* ---- 任务 ---- */

  function serializeJob(job) {
    return {
      id: job.id,
      kind: job.kind,
      model: job.model,
      prompt: job.prompt,
      size: job.size,
      quality: job.quality,
      count: job.count,
      format: job.format,
      duration: job.duration,
      resolution: job.resolution,
      status: job.status,
      phase: job.phase,
      error: job.error ?? '',
      startedAt: job.startedAt,
      finishedAt: job.finishedAt ?? 0,
      elapsedMs: job.elapsedMs ?? (job.startedAt ? now() - job.startedAt : 0),
      results: job.results,
    }
  }

  function pruneJobs() {
    const finished = [...jobs.values()].filter((job) => job.status !== 'running' && job.status !== 'queued')
    if (finished.length <= MAX_FINISHED_JOBS) return
    finished
      .sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0))
      .slice(0, finished.length - MAX_FINISHED_JOBS)
      .forEach((job) => jobs.delete(job.id))
  }

  function createJob(spec) {
    const id = `job-${now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    const job = {
      id,
      kind: spec.kind,
      model: spec.model,
      prompt: spec.prompt,
      size: spec.size ?? '1024x1024',
      quality: spec.quality ?? 'auto',
      count: spec.count ?? 1,
      format: spec.format ?? 'png',
      duration: spec.duration ?? 5,
      resolution: spec.resolution ?? '720p',
      status: 'queued',
      phase: '排队中',
      startedAt: now(),
      results: [],
      controller: new AbortController(),
    }
    jobs.set(id, job)
    active.add(job)
    void runJob(job).finally(() => {
      active.delete(job)
      pruneJobs()
    })
    return job
  }

  async function runJob(job) {
    job.status = 'running'
    job.phase = '准备请求'
    try {
      if (job.kind === 'image') await runImage(job)
      else await runVideo(job)
      job.status = 'succeeded'
      job.phase = '完成'
    } catch (error) {
      const message = error?.message ?? String(error)
      job.status = job.controller.signal.aborted ? 'cancelled' : 'failed'
      job.phase = job.status === 'cancelled' ? '已取消' : '失败'
      job.error = job.status === 'cancelled' ? '' : message
      if (job.error !== '') logger.warn?.(`[hfsy-studio] ${job.kind} 失败（${job.model}）：${message}`)
    } finally {
      job.finishedAt = now()
      job.elapsedMs = job.finishedAt - job.startedAt
    }
  }

  /* ---- 出图 ---- */

  async function runImage(job) {
    const key = await resolveKey()
    if (key === undefined) throw new Error(`没有找到 ${config.apiKeyEnv}，先在 DSH 凭据里配一个再生成`)

    const total = clampInt(job.count, 1, 4, 1)
    const body = { model: job.model, prompt: job.prompt, n: total }
    const size = normalizeSize(job.size)
    if (size !== undefined) body.size = size
    if (job.quality !== 'auto') body.quality = job.quality
    if (job.format === 'jpeg' || job.format === 'webp') body.output_format = job.format

    job.phase = '请求中转'
    const payload = await requestJson(config, key.value, '/images/generations', {
      body,
      signal: job.controller.signal,
    })

    const items = Array.isArray(payload?.data) ? payload.data : []
    if (items.length === 0) throw new Error('中转没有返回图片数据')

    const stamp = dateParts()
    const folder = path.join(config.outputDir, stamp.day)
    await mkdir(folder, { recursive: true })

    let saved = 0
    for (const [index, item] of items.entries()) {
      if (job.controller.signal.aborted) throw new DOMException('已取消', 'AbortError')
      job.phase = `下载第 ${index + 1}/${items.length} 张`
      let buffer
      if (typeof item?.b64_json === 'string') buffer = Buffer.from(item.b64_json, 'base64')
      else if (typeof item?.url === 'string') buffer = await downloadBinary(item.url, job.controller.signal)
      else continue

      const sniffed = sniffImage(buffer)
      if (sniffed === undefined) throw new Error('中转返回的不是可识别的图片字节')
      const { width, height } = probeImageSize(buffer)
      const file = `${stamp.time}-${job.id.slice(-4)}-${slugify(job.prompt)}-${index + 1}.${sniffed.ext}`
      const absolute = path.join(folder, file)
      await writeFile(absolute, buffer)

      const entry = {
        id: `${job.id}-${index + 1}`,
        kind: 'image',
        model: job.model,
        prompt: job.prompt,
        file,
        rel: `${stamp.day}/${file}`,
        bytes: buffer.byteLength,
        width,
        height,
        mediaType: sniffed.mediaType,
        size: job.size,
        quality: job.quality,
        durationMs: now() - job.startedAt,
        createdAt: now(),
      }
      job.results.push(entry)
      saved += 1
      await recordHistory(entry)
      job.phase = `已落盘 ${saved}/${items.length} 张`
    }

    if (saved === 0) throw new Error('中转返回的数据里没有可下载的图片')
  }

  /** 允许 auto 或 WxH；不合法就当没传，让模型自己定。 */
  function normalizeSize(value) {
    if (typeof value !== 'string') return undefined
    const trimmed = value.trim().toLowerCase()
    if (trimmed === '' || trimmed === 'auto') return undefined
    const match = /^(\d{2,4})x(\d{2,4})$/u.exec(trimmed)
    if (match === null) return undefined
    const width = Number(match[1])
    const height = Number(match[2])
    if (width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE) return undefined
    return `${width}x${height}`
  }

  /* ---- 出片 ---- */

  async function runVideo(job) {
    const key = await resolveKey()
    if (key === undefined) throw new Error(`没有找到 ${config.apiKeyEnv}，先在 DSH 凭据里配一个再生成`)

    const body = { model: job.model, prompt: job.prompt }
    if (job.duration) body.duration = clampInt(job.duration, 3, 20, 5)
    if (job.resolution) body.size = job.resolution

    job.phase = '提交视频任务'
    const created = await requestJson(config, key.value, '/video/generations', {
      body,
      signal: job.controller.signal,
      timeoutMs: 120_000,
    })

    let videoUrl = findVideoUrl(created)
    const taskId = created?.id ?? created?.task_id ?? created?.data?.id
    if (videoUrl === undefined && taskId !== undefined) {
      const deadline = now() + config.videoTimeoutMs
      while (now() < deadline) {
        if (job.controller.signal.aborted) throw new DOMException('已取消', 'AbortError')
        job.phase = '等待视频渲染'
        await sleep(config.videoPollMs)
        const status = await requestJson(config, key.value, `/video/generations/${taskId}`, {
          method: 'GET',
          signal: job.controller.signal,
          timeoutMs: 60_000,
        })
        const state = String(status?.status ?? status?.data?.status ?? '').toLowerCase()
        videoUrl = findVideoUrl(status)
        if (videoUrl !== undefined) break
        if (['failed', 'error', 'cancelled', 'canceled'].includes(state)) {
          throw new Error(providerMessage(JSON.stringify(status)) || '视频任务失败')
        }
      }
    }

    if (videoUrl === undefined) throw new Error('中转没有返回可下载的视频（可能未开通该模型）')

    job.phase = '下载视频'
    const buffer = await downloadBinary(videoUrl, job.controller.signal, 512 * 1024 * 1024)
    const stamp = dateParts()
    const folder = path.join(config.outputDir, stamp.day)
    await mkdir(folder, { recursive: true })
    const ext = sniffVideo(buffer)
    const file = `${stamp.time}-${job.id.slice(-4)}-${slugify(job.prompt)}.${ext}`
    await writeFile(path.join(folder, file), buffer)

    const entry = {
      id: job.id,
      kind: 'video',
      model: job.model,
      prompt: job.prompt,
      file,
      rel: `${stamp.day}/${file}`,
      bytes: buffer.byteLength,
      duration: job.duration,
      resolution: job.resolution,
      mediaType: ext === 'webm' ? 'video/webm' : 'video/mp4',
      durationMs: now() - job.startedAt,
      createdAt: now(),
    }
    job.results.push(entry)
    await recordHistory(entry)
    job.phase = '视频已落盘'
  }

  /** 在任意的响应结构里找第一个像视频地址的字符串。 */
  function findVideoUrl(value, depth = 0) {
    if (depth > 6 || value === null || typeof value !== 'object') {
      if (typeof value === 'string' && /^https?:\/\//u.test(value) && /\.(mp4|webm|mov)(\?|$)/iu.test(value)) return value
      return undefined
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findVideoUrl(item, depth + 1)
        if (found !== undefined) return found
      }
      return undefined
    }
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === 'string' && /url|video|output|result/iu.test(key)
        && /^https?:\/\//u.test(item) && /\.(mp4|webm|mov)(\?|$)/iu.test(item)) return item
      const found = findVideoUrl(item, depth + 1)
      if (found !== undefined) return found
    }
    return undefined
  }

  /* ---- 路由 ---- */

  async function handleState(res) {
    await loadHistory()
    const key = await resolveKey()
    const running = [...jobs.values()].filter((job) => job.status === 'running' || job.status === 'queued')
    sendJson(res, 200, {
      ok: true,
      config: {
        baseUrl: config.baseUrl,
        outputDir: config.outputDir,
        apiKeyEnv: config.apiKeyEnv,
        hasKey: key !== undefined,
        keySource: key?.source ?? '',
        maxConcurrent: config.maxConcurrent,
      },
      models: { image: config.imageModels, video: config.videoModels },
      jobs: [...jobs.values()].map(serializeJob).sort((a, b) => b.startedAt - a.startedAt).slice(0, 30),
      history: history.slice(0, 200),
      running: running.length,
      stats: {
        count: history.length,
        bytes: history.reduce((total, entry) => total + (Number(entry.bytes) || 0), 0),
      },
    })
  }

  async function handleGenerate(req, res) {
    const body = await readJsonBody(req)
    const kind = body.kind === 'video' ? 'video' : 'image'
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
    if (prompt.length === 0) {
      sendJson(res, 400, { ok: false, error: '提示词不能为空' })
      return
    }
    if (prompt.length > 8_000) {
      sendJson(res, 400, { ok: false, error: '提示词过长（上限 8000 字）' })
      return
    }
    const pool = kind === 'video' ? config.videoModels : config.imageModels
    const model = typeof body.model === 'string' && body.model.trim() !== '' ? body.model.trim() : pool[0]
    if (!pool.includes(model)) {
      sendJson(res, 400, { ok: false, error: `模型 ${model} 不在当前允许列表里，改 cordis.patch.yml 的 ${kind === 'video' ? 'videoModels' : 'imageModels'} 再加` })
      return
    }
    if (active.size >= config.maxConcurrent) {
      sendJson(res, 429, { ok: false, error: `同时最多跑 ${config.maxConcurrent} 个任务，等一个跑完再提交` })
      return
    }
    const job = createJob({
      kind,
      model,
      prompt,
      size: typeof body.size === 'string' ? body.size : '1024x1024',
      quality: typeof body.quality === 'string' ? body.quality : 'auto',
      count: kind === 'image' ? clampInt(body.count, 1, 4, 1) : 1,
      format: ['png', 'jpeg', 'webp'].includes(body.format) ? body.format : 'png',
      duration: clampInt(body.duration, 3, 20, 5),
      resolution: typeof body.resolution === 'string' ? body.resolution : '720p',
    })
    sendJson(res, 200, { ok: true, job: serializeJob(job) })
  }

  async function handleFile(url, res) {
    const rel = url.searchParams.get('rel') ?? ''
    const absolute = path.resolve(config.outputDir, rel)
    const root = path.resolve(config.outputDir)
    if (!absolute.startsWith(root + path.sep)) {
      sendJson(res, 400, { ok: false, error: '非法路径' })
      return
    }
    try {
      const info = await stat(absolute)
      if (!info.isFile()) throw new Error('不是文件')
      const buffer = await readFile(absolute)
      const ext = path.extname(absolute).toLowerCase()
      const type = ext === '.png' ? 'image/png'
        : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
          : ext === '.webp' ? 'image/webp'
            : ext === '.mp4' ? 'video/mp4'
              : ext === '.webm' ? 'video/webm'
                : 'application/octet-stream'
      res.writeHead(200, {
        'content-type': type,
        'content-length': buffer.byteLength,
        'cache-control': 'no-cache',
      })
      res.end(buffer)
    } catch {
      sendJson(res, 404, { ok: false, error: '文件不存在或已被删除' })
    }
  }

  async function handleModels(res) {
    const key = await resolveKey()
    if (key === undefined) {
      sendJson(res, 400, { ok: false, error: `没有找到 ${config.apiKeyEnv}` })
      return
    }
    try {
      const payload = await requestJson(config, key.value, '/models', { method: 'GET', timeoutMs: 30_000 })
      const ids = (Array.isArray(payload?.data) ? payload.data : []).map((item) => String(item?.id ?? '')).filter(Boolean)
      const image = ids.filter((id) => /image|img|dall|flux|mj_/iu.test(id))
      const video = ids.filter((id) => /video|sora|veo|seedance|kling|wan-|muse|runway/iu.test(id))
      sendJson(res, 200, { ok: true, total: ids.length, image, video })
    } catch (error) {
      sendJson(res, 502, { ok: false, error: error?.message ?? String(error) })
    }
  }

  async function handleHistoryAction(req, res, segments) {
    const body = await readJsonBody(req)
    await loadHistory()
    if (segments[1] === 'delete') {
      const id = typeof body.id === 'string' ? body.id : ''
      history = history.filter((entry) => entry.id !== id)
      await persistHistory()
      sendJson(res, 200, { ok: true })
      return
    }
    if (segments[1] === 'clear') {
      history = []
      await persistHistory()
      sendJson(res, 200, { ok: true })
      return
    }
    sendJson(res, 404, { ok: false, error: '未知历史操作' })
  }

  function openOutputFolder() {
    const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open'
    try {
      const child = spawn(command, [config.outputDir], { detached: true, stdio: 'ignore' })
      child.unref()
      return true
    } catch (error) {
      logger.warn?.(`[hfsy-studio] 打开目录失败：${error?.message ?? error}`)
      return false
    }
  }

  async function route(req, res) {
    if (!sameOriginOnly(req)) {
      sendJson(res, 403, { ok: false, error: '拒绝跨站请求' })
      return
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const segments = url.pathname.slice(ROUTE_PREFIX.length).split('/').filter(Boolean)
    const method = req.method ?? 'GET'

    try {
      if (segments.length === 1 && segments[0] === 'state') {
        await handleState(res)
        return
      }
      if (segments.length === 1 && segments[0] === 'generate' && method === 'POST') {
        await handleGenerate(req, res)
        return
      }
      if (segments.length === 1 && segments[0] === 'models') {
        await handleModels(res)
        return
      }
      if (segments.length === 1 && segments[0] === 'file') {
        await handleFile(url, res)
        return
      }
      if (segments.length === 1 && segments[0] === 'open-output' && method === 'POST') {
        const opened = openOutputFolder()
        sendJson(res, 200, { ok: opened, error: opened ? '' : '无法调用系统文件管理器' })
        return
      }
      if (segments[0] === 'history') {
        await handleHistoryAction(req, res, segments)
        return
      }
      if (segments.length === 2 && segments[0] === 'jobs' && method === 'POST') {
        const job = jobs.get(segments[1])
        if (job === undefined) {
          sendJson(res, 404, { ok: false, error: '任务不存在' })
          return
        }
        job.controller.abort(new DOMException('用户取消', 'AbortError'))
        sendJson(res, 200, { ok: true })
        return
      }
      sendJson(res, 404, { ok: false, error: `未知接口：${url.pathname}` })
    } catch (error) {
      const message = error?.message ?? String(error)
      logger.warn?.(`[hfsy-studio] ${method} ${url.pathname} 出错：${message}`)
      sendJson(res, 500, { ok: false, error: message })
    }
  }

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(
      () => webCtx.webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler: (req, res) => void route(req, res) }),
      'hfsy-studio: api routes',
    )
  })

  ctx.effect(() => () => {
    for (const job of active) job.controller.abort(new DOMException('插件已卸载', 'AbortError'))
    active.clear()
  }, 'hfsy-studio: abort jobs on unload')

  void loadHistory()
  logger.info?.(`[hfsy-studio] 生图工作台已加载：${config.baseUrl} → ${config.outputDir}`)
}