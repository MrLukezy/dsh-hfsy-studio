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

/** 默认出片模型：走 `/video/create` + `/video/query`，这些在中转上既有价也能提交。 */
const DEFAULT_VIDEO_MODELS = [
  'sd-2-fast-480',
  'sd-2-fast-720',
  'sd-2.5-480',
  'sd-2.5-720',
  'wan-3.0-480',
  'wan-3.0-720',
  'minimax-h3',
]

/** 出图尺寸上限（像素），防止手滑写个 10000x10000。 */
const MAX_IMAGE_EDGE = 4096

/** 默认分辨率预设：模型留空表示跟随队列第一个。 */
const DEFAULT_RESOLUTIONS = [
  { id: 'square', label: '1:1 · 1024', size: '1024x1024', model: '' },
  { id: 'landscape', label: '3:2 · 1536x1024', size: '1536x1024', model: '' },
  { id: 'portrait', label: '2:3 · 1024x1536', size: '1024x1536', model: '' },
  { id: 'wide', label: '16:9 · 2048x1152', size: '2048x1152', model: '' },
  { id: 'uhd', label: '4K · 3840x2160', size: '3840x2160', model: 'gpt-image-2pro-4k' },
]

/** 工具名：优先用最直白的名字，被别的插件占了就退到带前缀的。 */
const TOOL_NAME_CANDIDATES = {
  image: ['generate_image', 'hfsy_generate_image', 'hfsy_image'],
  video: ['generate_video', 'hfsy_generate_video', 'hfsy_video'],
}

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
    videoTimeoutMs: clampInt(input.videoTimeoutMs, 60_000, 3_600_000, 1_800_000),
    pricingTtlMs: clampInt(input.pricingTtlMs, 60_000, 3_600_000, 600_000),
    currencySymbol: pickString(input.currencySymbol, '$'),
    maxRefs: clampInt(input.maxRefs, 1, 8, 4),
    upscaleModels: pickList(input.upscaleModels, ['gpt-image-2pro-4k', 'gpt-image-2pro']),
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
  const url = route.startsWith('http') ? route : `${config.baseUrl}${route}`
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

/** 带参考图时走 multipart（OpenAI `/images/edits` 的 image[] 语义）。 */
async function requestMultipart(config, key, route, { fields, files, signal, timeoutMs } = {}) {
  const url = route.startsWith('http') ? route : `${config.baseUrl}${route}`
  const budget = timeoutMs ?? config.requestTimeoutMs
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new DOMException('请求超时', 'TimeoutError')), budget)
  const relayAbort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', relayAbort, { once: true })
  try {
    const form = new FormData()
    for (const [name, value] of Object.entries(fields ?? {})) {
      if (value !== undefined && value !== null && value !== '') form.append(name, String(value))
    }
    for (const [index, file] of (files ?? []).entries()) {
      form.append('image[]', new Blob([file.buffer], { type: file.mediaType }), `ref-${index + 1}.${file.ext}`)
    }
    const response = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      body: form,
      signal: controller.signal,
    })
    const text = await response.text()
    if (!response.ok) {
      throw new ProviderError(providerMessage(text) || `HTTP ${response.status}`, {
        status: response.status,
        retryable: false,
      })
    }
    return text.trim() === '' ? {} : JSON.parse(text)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', relayAbort)
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

  /* ---- 收藏 / 角色库 ---- */

  const favoritesFile = path.join(config.outputDir, 'favorites.json')
  const charactersFile = path.join(config.outputDir, 'characters.json')
  let favorites = { folders: [], items: [] }
  let characters = { items: [] }
  let libraryLoaded = false

  async function loadLibrary() {
    if (libraryLoaded) return
    libraryLoaded = true
    try {
      const raw = JSON.parse(await readFile(favoritesFile, 'utf8'))
      favorites = {
        folders: Array.isArray(raw?.folders) ? raw.folders.filter((item) => typeof item?.id === 'string' && typeof item?.name === 'string') : [],
        items: Array.isArray(raw?.items) ? raw.items.filter((item) => typeof item?.id === 'string' && typeof item?.rel === 'string') : [],
      }
    } catch {
      // 第一次运行还没有收藏文件
    }
    try {
      const raw = JSON.parse(await readFile(charactersFile, 'utf8'))
      characters = {
        items: Array.isArray(raw?.items)
          ? raw.items.filter((item) => typeof item?.id === 'string' && typeof item?.name === 'string' && Array.isArray(item?.refs))
          : [],
      }
    } catch {
      // 同上
    }
  }

  async function saveFavorites() {
    await writeFile(favoritesFile, `${JSON.stringify(favorites, null, 2)}\n`)
  }

  async function saveCharacters() {
    await writeFile(charactersFile, `${JSON.stringify(characters, null, 2)}\n`)
  }

  /* ---- 设置（调用开关 / 模型队列 / 分辨率预设） ---- */

  const settingsFile = path.join(config.outputDir, 'settings.json')
  const clone = (value) => JSON.parse(JSON.stringify(value))

  let settings = {
    autoTool: true,
    recordToolCalls: true,
    imageQueue: [...config.imageModels],
    videoQueue: [...config.videoModels],
    resolutions: clone(DEFAULT_RESOLUTIONS),
  }
  let settingsLoaded = false

  async function loadSettings() {
    if (settingsLoaded) return settings
    settingsLoaded = true
    try {
      const raw = JSON.parse(await readFile(settingsFile, 'utf8'))
      const patched = normalizeSettings(raw)
      if (patched.error === '') settings = patched.value
      else logger.warn?.(`[hfsy-studio] settings.json 有问题，用默认值：${patched.error}`)
    } catch (error) {
      if (error?.code !== 'ENOENT') logger.warn?.(`[hfsy-studio] 读取设置失败：${error?.message ?? error}`)
    }
    return settings
  }

  async function persistSettings() {
    writeChain = writeChain.then(async () => {
      try {
        await mkdir(config.outputDir, { recursive: true })
        const file = `${settingsFile}.tmp`
        await writeFile(file, JSON.stringify(settings, null, 2), 'utf8')
        await rename(file, settingsFile)
      } catch (error) {
        logger.warn?.(`[hfsy-studio] 写设置失败：${error?.message ?? error}`)
      }
    })
    return writeChain
  }

  /** 把前端的补丁校验成一份完整设置；不合法就返回 error，不落盘。 */
  function normalizeSettings(raw) {
    const input = raw && typeof raw === 'object' ? raw : {}
    const value = clone(settings)

    if (input.autoTool !== undefined) {
      if (typeof input.autoTool !== 'boolean') return { error: 'autoTool 必须是布尔值' }
      value.autoTool = input.autoTool
    }
    if (input.recordToolCalls !== undefined) {
      if (typeof input.recordToolCalls !== 'boolean') return { error: 'recordToolCalls 必须是布尔值' }
      value.recordToolCalls = input.recordToolCalls
    }

    for (const [field, allowed] of [['imageQueue', config.imageModels], ['videoQueue', config.videoModels]]) {
      if (input[field] === undefined) continue
      if (!Array.isArray(input[field]) || input[field].length === 0) return { error: `${field} 至少要留一个模型` }
      if (input[field].length > 12) return { error: `${field} 最多 12 个模型` }
      const list = []
      for (const item of input[field]) {
        if (typeof item !== 'string' || !allowed.includes(item.trim())) {
          return { error: `${field} 里有不在允许列表的模型：${String(item)}` }
        }
        if (!list.includes(item.trim())) list.push(item.trim())
      }
      value[field] = list
    }

    if (input.resolutions !== undefined) {
      if (!Array.isArray(input.resolutions) || input.resolutions.length === 0) return { error: '分辨率预设至少要留一条' }
      if (input.resolutions.length > 12) return { error: '分辨率预设最多 12 条' }
      const list = []
      for (const [index, item] of input.resolutions.entries()) {
        if (item === null || typeof item !== 'object') return { error: `第 ${index + 1} 条分辨率不是对象` }
        const label = typeof item.label === 'string' ? item.label.trim() : ''
        if (label === '' || label.length > 24) return { error: `第 ${index + 1} 条分辨率的名字要在 1~24 字之间` }
        const size = typeof item.size === 'string' ? item.size.trim().toLowerCase() : ''
        if (size !== 'auto' && normalizeSize(size) === undefined) {
          return { error: `第 ${index + 1} 条分辨率的尺寸要写成 WxH（如 1024x1024）或 auto` }
        }
        const model = typeof item.model === 'string' ? item.model.trim() : ''
        if (model !== '' && !config.imageModels.includes(model)) {
          return { error: `第 ${index + 1} 条分辨率的模型不在 imageModels 里：${model}` }
        }
        const id = typeof item.id === 'string' && /^[a-z0-9-]{1,24}$/u.test(item.id.trim())
          ? item.id.trim()
          : `preset-${index + 1}`
        if (list.some((entry) => entry.id === id)) return { error: `分辨率 id 重复：${id}` }
        list.push({ id, label, size: size === 'auto' ? 'auto' : size, model })
      }
      value.resolutions = list
    }

    return { value }
  }

  /** 按名字或尺寸找预设；也接受直接写 WxH。 */
  function resolveResolution(input) {
    const needle = typeof input === 'string' ? input.trim() : ''
    if (needle !== '') {
      const hit = settings.resolutions.find((item) => item.id === needle || item.label === needle || item.size === needle)
      if (hit !== undefined) return hit
      const size = normalizeSize(needle)
      if (size !== undefined) return { id: 'custom', label: size, size, model: '' }
    }
    return settings.resolutions[0]
  }

  /** outputDir 内的相对路径 → 绝对路径；越界一律拒绝。 */
  function safePath(rel) {
    if (typeof rel !== 'string' || rel.trim() === '') return undefined
    const root = path.resolve(config.outputDir)
    const absolute = path.resolve(root, rel)
    return absolute.startsWith(root + path.sep) ? absolute : undefined
  }

  /** 把 rel 列表读成可以直接塞进 multipart 的图片。 */
  async function resolveRefs(rels) {
    const list = []
    for (const rel of rels) {
      const absolute = safePath(rel)
      if (absolute === undefined) throw new Error(`参考图路径不合法：${rel}`)
      const buffer = await readFile(absolute)
      const sniffed = sniffImage(buffer)
      if (sniffed === undefined) throw new Error(`参考图不是可识别的图片：${rel}`)
      list.push({ rel, buffer, mediaType: sniffed.mediaType, ext: sniffed.ext })
    }
    return list
  }

  /** 角色 id 列表 → 参考图 rel + 需要塞进提示词的外貌描述。 */
  async function describeCharacters(ids) {
    await loadLibrary()
    const picked = characters.items.filter((item) => ids.includes(item.id))
    const refs = []
    for (const item of picked) {
      for (const rel of item.refs) {
        if (!refs.includes(rel)) refs.push(rel)
      }
    }
    const notes = picked
      .map((item) => `- ${item.name}${item.description ? `: ${item.description}` : ''}（外观参考图见附件）`)
      .join('\n')
    return { refs, notes }
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

  /* ---- 价格 ---- */

  const apiRoot = config.baseUrl.replace(/\/v1$/u, '')
  let pricing = { at: 0, models: {}, ok: false, error: '', loading: false }

  /** 从中转的 /api/pricing 拉一份模型价目表（New API 站点接口，缓存 10 分钟）。 */
  async function refreshPricing(force = false) {
    if (pricing.loading) return pricing
    if (!force && pricing.at !== 0 && now() - pricing.at < config.pricingTtlMs) return pricing
    const key = await resolveKey()
    if (key === undefined) {
      pricing = { ...pricing, ok: false, error: `没有找到 ${config.apiKeyEnv}` }
      return pricing
    }
    pricing = { ...pricing, loading: true }
    try {
      const payload = await requestJson(config, key.value, `${apiRoot}/api/pricing`, { method: 'GET', timeoutMs: 30_000 })
      const entries = Array.isArray(payload?.data) ? payload.data : []
      const models = {}
      for (const item of entries) {
        const name = String(item?.model_name ?? '').trim()
        if (name === '') continue
        models[name] = {
          price: Number(item.model_price) || 0,
          perSecond: Boolean(item.price_per_second_display),
          perCall: Number(item.quota_type) === 1,
          tag: String(item.tags ?? ''),
          description: String(item.description ?? '').slice(0, 300),
          groups: Array.isArray(item.enable_groups) ? item.enable_groups : [],
        }
      }
      pricing = { at: now(), models, ok: true, error: '', loading: false }
    } catch (error) {
      pricing = { ...pricing, loading: false, ok: false, error: error?.message ?? String(error) }
      logger.warn?.(`[hfsy-studio] 拉价格失败：${pricing.error}`)
    }
    return pricing
  }

  /** 只把工作台用得上的模型价格发给页面：当前池子 + 其他图片/视频模型。 */
  function pricingView() {
    const pools = new Set([...config.imageModels, ...config.videoModels])
    const models = {}
    for (const [name, item] of Object.entries(pricing.models)) {
      if (pools.has(name) || item.tag === '图片' || item.tag === '视频') models[name] = item
    }
    return {
      ok: pricing.ok,
      error: pricing.error,
      updatedAt: pricing.at,
      currency: config.currencySymbol,
      models,
    }
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
      tool: job.tool ?? '',
      refs: job.refs ?? [],
      characters: job.characters ?? [],
      source: job.source ?? 'ui',
      queue: job.queue ?? [],
      attempts: job.attempts ?? [],
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
      tool: spec.tool ?? '',
      refs: Array.isArray(spec.refs) ? spec.refs : [],
      characters: Array.isArray(spec.characters) ? spec.characters : [],
      source: spec.source === 'tool' ? 'tool' : 'ui',
      queue: Array.isArray(spec.queue) ? spec.queue.filter((item) => typeof item === 'string') : [],
      attempts: [],
      deferred: spec.deferred,
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
      if (job.deferred !== undefined) {
        if (job.status === 'succeeded') job.deferred.resolve(job)
        else job.deferred.reject(new Error(job.error || job.phase))
      }
    }
  }

  /* ---- 出图 ---- */

  /** 队列里的模型依次试：前一个失败且还没落盘，就换下一个。 */
  async function runImage(job) {
    const key = await resolveKey()
    if (key === undefined) throw new Error(`没有找到 ${config.apiKeyEnv}，先在 DSH 凭据里配一个再生成`)
    const queue = job.queue.length > 0 ? job.queue : [job.model]
    let lastError
    for (const [index, model] of queue.entries()) {
      if (job.controller.signal.aborted) throw new DOMException('已取消', 'AbortError')
      if (index > 0) job.phase = `换用 ${model} 重试`
      try {
        await runImageOnce(job, key, model)
        return
      } catch (error) {
        if (job.controller.signal.aborted || error?.name === 'AbortError') throw error
        lastError = error
        job.attempts.push({ model, error: error?.message ?? String(error) })
        if (job.results.length > 0) throw error
        logger.warn?.(`[hfsy-studio] ${model} 失败，试队列下一个：${error?.message ?? error}`)
      }
    }
    throw lastError ?? new Error('模型队列里没有可用模型')
  }

  async function runImageOnce(job, key, model) {
    job.model = model
    const total = clampInt(job.count, 1, 4, 1)
    const refs = Array.isArray(job.refs) && job.refs.length > 0
      ? await resolveRefs(job.refs.slice(0, config.maxRefs))
      : []
    const size = normalizeSize(job.size)
    const body = { model, prompt: job.prompt, n: total }
    if (size !== undefined) body.size = size
    if (job.quality !== 'auto') body.quality = job.quality
    if (job.format === 'jpeg' || job.format === 'webp') body.output_format = job.format

    job.phase = refs.length > 0 ? `上传 ${refs.length} 张参考图` : '请求中转'
    const payload = refs.length > 0
      ? await requestMultipart(config, key.value, '/images/edits', {
        fields: body,
        files: refs,
        signal: job.controller.signal,
      })
      : await requestJson(config, key.value, '/images/generations', {
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
      // 有些中转会同时返回 b64_json:"" 和 url，空的 b64 不能当结果
      if (typeof item?.b64_json === 'string' && item.b64_json.length > 64) buffer = Buffer.from(item.b64_json, 'base64')
      if ((buffer === undefined || buffer.length === 0) && typeof item?.url === 'string') {
        buffer = await downloadBinary(item.url, job.controller.signal)
      }
      if (buffer === undefined || buffer.length === 0) continue

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
        tool: job.tool ?? '',
        refs: job.refs ?? [],
        source: job.source ?? 'ui',
        durationMs: now() - job.startedAt,
        createdAt: now(),
      }
      job.results.push(entry)
      saved += 1
      if (job.source !== 'tool' || settings.recordToolCalls) await recordHistory(entry)
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

  /** 中转的错误经常是 HTTP 200 + {success:false,message}，这里统一翻成异常。 */
  function assertPayload(payload, fallback) {
    if (payload && payload.success === false) throw new Error(payload.message || fallback)
    if (payload && typeof payload.message === 'string' && payload.code !== undefined) throw new Error(payload.message)
    return payload
  }

  async function runVideo(job) {
    const key = await resolveKey()
    if (key === undefined) throw new Error(`没有找到 ${config.apiKeyEnv}，先在 DSH 凭据里配一个再生成`)
    const queue = job.queue.length > 0 ? job.queue : [job.model]
    let lastError
    for (const [index, model] of queue.entries()) {
      if (job.controller.signal.aborted) throw new DOMException('已取消', 'AbortError')
      if (index > 0) job.phase = `换用 ${model} 重试`
      try {
        await runVideoOnce(job, key, model)
        return
      } catch (error) {
        if (job.controller.signal.aborted || error?.name === 'AbortError') throw error
        lastError = error
        job.attempts.push({ model, error: error?.message ?? String(error) })
        if (job.results.length > 0) throw error
        logger.warn?.(`[hfsy-studio] ${model} 失败，试队列下一个：${error?.message ?? error}`)
      }
    }
    throw lastError ?? new Error('视频队列里没有可用模型')
  }

  async function runVideoOnce(job, key, model) {
    job.model = model
    const body = {
      model,
      prompt: job.prompt,
      resolution: job.resolution,
      duration: clampInt(job.duration, 1, 30, 5),
    }

    job.phase = '提交视频任务'
    const created = assertPayload(await requestJson(config, key.value, '/video/create', {
      body,
      signal: job.controller.signal,
      timeoutMs: 120_000,
    }), '视频任务提交失败')

    const taskId = created?.id ?? created?.task_id ?? created?.data?.id
    if (taskId === undefined) throw new Error(providerMessage(JSON.stringify(created)) || '中转没有返回视频任务 id')

    const deadline = now() + config.videoTimeoutMs
    let videoUrl
    let lastStatus = 'queued'
    while (now() < deadline) {
      if (job.controller.signal.aborted) throw new DOMException('已取消', 'AbortError')
      await sleep(config.videoPollMs)
      const payload = assertPayload(await requestJson(config, key.value, `/video/query?id=${encodeURIComponent(taskId)}`, {
        method: 'GET',
        signal: job.controller.signal,
        timeoutMs: 60_000,
      }), '查询视频任务失败')

      lastStatus = String(payload?.data?.status ?? payload?.data?.detail?.status ?? payload?.status ?? '').toLowerCase()
      videoUrl = findVideoUrl(payload)
      if (videoUrl !== undefined) break
      if (['failed', 'error', 'cancelled', 'canceled'].includes(lastStatus)) {
        throw new Error(findFailure(payload) || `视频任务失败（${lastStatus}）`)
      }
      job.phase = lastStatus === 'queued' ? '中转排队中' : '视频渲染中'
    }

    if (videoUrl === undefined) throw new Error(`视频任务超时（最后状态 ${lastStatus || '未知'}），任务 id ${taskId}`)

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
      source: job.source ?? 'ui',
      durationMs: now() - job.startedAt,
      createdAt: now(),
    }
    job.results.push(entry)
    if (job.source !== 'tool' || settings.recordToolCalls) await recordHistory(entry)
    job.phase = '视频已落盘'
  }

  /** 在任意的失败响应里找第一句人话（error / message / fail_reason …）。 */
  function findFailure(value, depth = 0) {
    if (depth > 5 || value === null || typeof value !== 'object') return ''
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === 'string' && /error|message|reason|msg/iu.test(key) && item.trim() !== '') return item.trim()
      const nested = findFailure(item, depth + 1)
      if (nested !== '') return nested
    }
    return ''
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

  /* ---- 面向模型的工具 ---- */

  const toolState = { service: undefined, disposers: [], names: [], error: '' }

  function toolInfo() {
    return {
      auto: settings.autoTool,
      names: toolState.names,
      available: toolState.service !== undefined,
      error: toolState.error,
    }
  }

  function disposeTools() {
    for (const dispose of toolState.disposers) {
      try {
        dispose()
      } catch (error) {
        logger.warn?.(`[hfsy-studio] 注销工具失败：${error?.message ?? error}`)
      }
    }
    toolState.disposers = []
    toolState.names = []
  }

  /** 把任务包装成「创建 → 等它结束」，工具调用走这条路。 */
  function generateForTool(spec, signal) {
    if (active.size >= config.maxConcurrent) {
      throw new Error(`同时最多 ${config.maxConcurrent} 个生成任务，等一个跑完再试`)
    }
    let resolve
    let reject
    const done = new Promise((ok, fail) => { resolve = ok; reject = fail })
    const job = createJob({ ...spec, source: 'tool', deferred: { resolve, reject } })
    if (signal !== undefined) {
      const abort = () => job.controller.abort(new DOMException('工具调用已取消', 'AbortError'))
      if (signal.aborted) abort()
      else signal.addEventListener('abort', abort, { once: true })
    }
    return done
  }

  const absoluteOf = (rel) => path.join(config.outputDir, rel)

  function imageToolSpec(name) {
    return {
      name,
      description: 'Generate an image through the HFSY relay configured in this DeepSeek Harness profile — the preferred, default image-generation path. The file is saved in the studio output folder, recorded in the studio history and shown in the studio gallery. Use it for any request that needs a picture: icons, posters, concept art, UI assets, illustrations.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          prompt: { type: 'string', description: 'Detailed description of the image: subject, composition, style, lighting, palette, what to avoid.' },
          resolution: { type: 'string', description: 'Studio resolution preset id, label or size (e.g. "square", "4K", "1024x1024"). Defaults to the first preset in settings.' },
          model: { type: 'string', description: 'Optional model override; when omitted the configured model queue is used and fallbacks apply.' },
          count: { type: 'integer', description: 'How many images to produce (1-4). Defaults to 1.' },
          format: { type: 'string', enum: ['png', 'jpeg', 'webp'], description: 'Output file format. Defaults to png.' },
          references: {
            type: 'array',
            description: 'Optional reference images, given as paths relative to the studio output folder (e.g. 2026-11-13/120032-x.png). Up to maxRefs entries; makes the call an image-to-image edit.',
            items: { type: 'string' },
          },
        },
        required: ['prompt'],
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            files: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  file: { type: 'string' },
                  path: { type: 'string' },
                  rel: { type: 'string' },
                  bytes: { type: 'integer' },
                  width: { type: 'integer' },
                  height: { type: 'integer' },
                  model: { type: 'string' },
                  size: { type: 'string' },
                },
                required: ['file', 'path', 'rel', 'bytes', 'width', 'height', 'model', 'size'],
              },
            },
            ms: { type: 'integer' },
          },
          required: ['files', 'ms'],
        },
        render: (_args, value) => [{
          type: 'text',
          text: `生成完成（${(value.ms / 1000).toFixed(1)}s）：\n${value.files
            .map((item) => `- ${item.path}（${item.width}×${item.height}，${item.model}，${Math.round(item.bytes / 1024)} KB）`)
            .join('\n')}`,
        }],
      },
      async execute(args, exec) {
        await loadSettings()
        const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
        if (prompt === '') throw new Error('prompt 不能为空')
        const preset = resolveResolution(args.resolution)
        const explicit = typeof args.model === 'string' ? args.model.trim() : ''
        const model = explicit || preset.model || settings.imageQueue[0]
        if (!config.imageModels.includes(model)) throw new Error(`模型 ${model} 不在 imageModels 里，先在设置里挑一个`)
        const refs = Array.isArray(args.references)
          ? args.references.filter((item) => typeof item === 'string' && item.trim() !== '').map((item) => item.trim()).slice(0, config.maxRefs)
          : []
        const job = await generateForTool({
          kind: 'image',
          model,
          prompt,
          size: preset.size === 'auto' ? '1024x1024' : preset.size,
          quality: 'auto',
          count: clampInt(args.count, 1, 4, 1),
          format: ['png', 'jpeg', 'webp'].includes(args.format) ? args.format : 'png',
          refs,
          queue: explicit !== '' || preset.model !== '' ? [model] : settings.imageQueue,
        }, exec.signal)
        return {
          files: job.results.map((entry) => ({
            file: entry.file,
            path: absoluteOf(entry.rel),
            rel: entry.rel,
            bytes: entry.bytes,
            width: entry.width,
            height: entry.height,
            model: entry.model,
            size: entry.size ?? '',
          })),
          ms: Math.round(job.elapsedMs ?? 0),
        }
      },
    }
  }

  function videoToolSpec(name) {
    return {
      name,
      description: 'Generate a short video through the HFSY relay configured in this DeepSeek Harness profile — the preferred, default video-generation path. Submitting is async: expect 1-3 minutes. The mp4 lands in the studio output folder and appears in the studio gallery.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          prompt: { type: 'string', description: 'What happens in the shot: subject, motion, camera, style.' },
          model: { type: 'string', description: 'Optional model override; when omitted the configured video queue is used.' },
          resolution: { type: 'string', enum: ['480p', '720p', '1080p'], description: 'Video resolution. Defaults to 720p.' },
          duration: { type: 'integer', description: 'Clip length in seconds (1-30). Defaults to 5.' },
        },
        required: ['prompt'],
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            file: { type: 'string' },
            path: { type: 'string' },
            rel: { type: 'string' },
            bytes: { type: 'integer' },
            model: { type: 'string' },
            resolution: { type: 'string' },
            seconds: { type: 'integer' },
            ms: { type: 'integer' },
          },
          required: ['file', 'path', 'rel', 'bytes', 'model', 'resolution', 'seconds', 'ms'],
        },
        render: (_args, value) => [{
          type: 'text',
          text: `视频完成：${value.path}（${value.model} · ${value.resolution} · ${value.seconds}s · ${Math.round(value.bytes / 1024)} KB · ${(value.ms / 1000).toFixed(0)}s）`,
        }],
      },
      async execute(args, exec) {
        await loadSettings()
        const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
        if (prompt === '') throw new Error('prompt 不能为空')
        const explicit = typeof args.model === 'string' ? args.model.trim() : ''
        const model = explicit || settings.videoQueue[0]
        if (!config.videoModels.includes(model)) throw new Error(`模型 ${model} 不在 videoModels 里，先在设置里挑一个`)
        const job = await generateForTool({
          kind: 'video',
          model,
          prompt,
          duration: clampInt(args.duration, 1, 30, 5),
          resolution: ['480p', '720p', '1080p'].includes(args.resolution) ? args.resolution : '720p',
          queue: explicit !== '' ? [model] : settings.videoQueue,
        }, exec.signal)
        const entry = job.results[0]
        if (entry === undefined) throw new Error('没有产出视频文件')
        return {
          file: entry.file,
          path: absoluteOf(entry.rel),
          rel: entry.rel,
          bytes: entry.bytes,
          model: entry.model,
          resolution: entry.resolution ?? '720p',
          seconds: entry.duration ?? 5,
          ms: Math.round(job.elapsedMs ?? 0),
        }
      },
    }
  }

  function registerTools() {
    disposeTools()
    if (toolState.service === undefined) return
    if (!settings.autoTool) {
      logger.info?.('[hfsy-studio] 自动调用已关闭，不注册生图/生视频工具')
      return
    }
    for (const [kind, build] of [['image', imageToolSpec], ['video', videoToolSpec]]) {
      let done = false
      for (const name of TOOL_NAME_CANDIDATES[kind]) {
        const spec = build(name)
        try {
          toolState.disposers.push(toolState.service.register(spec))
          toolState.names.push(name)
          done = true
          break
        } catch (error) {
          const message = String(error?.message ?? error)
          if (/already registered/iu.test(message)) continue
          toolState.error = message
          logger.warn?.(`[hfsy-studio] 注册工具 ${name} 失败：${message}`)
          break
        }
      }
      if (!done) logger.warn?.(`[hfsy-studio] ${kind} 工具没能注册（名字都被占用？）`)
    }
    if (toolState.names.length > 0) logger.info?.(`[hfsy-studio] 已注册生成工具：${toolState.names.join(', ')}`)
  }

  ctx.inject(['tools'], (toolCtx) => {
    toolState.service = toolCtx.tools
    void loadSettings().then(() => registerTools())
  })

  ctx.effect(() => () => disposeTools(), 'hfsy-studio: dispose generation tools')

  /* ---- 路由 ---- */

  async function handleState(res) {
    await loadHistory()
    await loadLibrary()
    await loadSettings()
    const key = await resolveKey()
    if (pricing.at === 0) await refreshPricing(true)
    else if (now() - pricing.at > config.pricingTtlMs) void refreshPricing(false)
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
      models: { image: config.imageModels, video: config.videoModels, upscale: config.upscaleModels },
      settings,
      tools: toolInfo(),
      pricing: pricingView(),
      favorites,
      characters,
      limits: { maxRefs: config.maxRefs },
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
    await loadSettings()
    const body = await readJsonBody(req)
    const kind = body.kind === 'video' ? 'video' : 'image'
    const tool = body.tool === 'upscale' ? 'upscale' : ''
    const rawPrompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''

    // 4K 增强只吃一张图，提示词可以留空（有默认模板）
    const refs = Array.isArray(body.refs) ? body.refs.filter((item) => typeof item === 'string' && item.trim() !== '').map((item) => item.trim()) : []
    if (refs.length > config.maxRefs) {
      sendJson(res, 400, { ok: false, error: `最多带 ${config.maxRefs} 张参考图` })
      return
    }
    let prompt = rawPrompt
    let characterRefs = []
    const characterIds = Array.isArray(body.characters) ? body.characters.filter((item) => typeof item === 'string') : []
    if (characterIds.length > 0) {
      const described = await describeCharacters(characterIds)
      characterRefs = described.refs
      if (described.notes !== '') prompt = `${prompt}\n\n[角色参考]\n${described.notes}`.trim()
    }
    const allRefs = [...new Set([...refs, ...characterRefs])].slice(0, config.maxRefs)

    if (tool === 'upscale' && allRefs.length === 0) {
      sendJson(res, 400, { ok: false, error: '4K 增强需要先选一张源图' })
      return
    }
    if (prompt.length === 0) {
      if (tool !== 'upscale') {
        sendJson(res, 400, { ok: false, error: '提示词不能为空' })
        return
      }
      prompt = 'Upscale this image to 4K. Keep the composition, colors, lighting and every detail identical; only raise the resolution and sharpen the fine details.'
    }
    if (prompt.length > 8_000) {
      sendJson(res, 400, { ok: false, error: '提示词过长（上限 8000 字）' })
      return
    }
    const pool = kind === 'video' ? config.videoModels : (tool === 'upscale' ? config.upscaleModels : config.imageModels)
    const queue = kind === 'video' ? settings.videoQueue : settings.imageQueue
    const fallbackModel = tool === 'upscale' ? pool[0] : (queue.find((item) => pool.includes(item)) ?? pool[0])
    const model = typeof body.model === 'string' && body.model.trim() !== '' ? body.model.trim() : fallbackModel
    if (!pool.includes(model)) {
      sendJson(res, 400, { ok: false, error: `模型 ${model} 不在当前允许列表里，改 cordis.patch.yml 的 ${kind === 'video' ? 'videoModels' : (tool === 'upscale' ? 'upscaleModels' : 'imageModels')} 再加` })
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
      size: typeof body.size === 'string' ? body.size : (tool === 'upscale' ? '3840x2160' : '1024x1024'),
      quality: typeof body.quality === 'string' ? body.quality : 'auto',
      count: kind === 'image' ? clampInt(body.count, 1, 4, 1) : 1,
      format: ['png', 'jpeg', 'webp'].includes(body.format) ? body.format : 'png',
      duration: clampInt(body.duration, 1, 30, 5),
      resolution: ['480p', '720p', '1080p'].includes(body.resolution) ? body.resolution : '720p',
      tool,
      refs: allRefs,
      characters: characterIds,
      queue: [model],
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

  async function handleSettings(req, res) {
    await loadSettings()
    const body = await readJsonBody(req)
    const patched = normalizeSettings(body)
    if (patched.error !== undefined) {
      sendJson(res, 400, { ok: false, error: patched.error })
      return
    }
    const autoChanged = patched.value.autoTool !== settings.autoTool
    settings = patched.value
    await persistSettings()
    if (autoChanged) registerTools()
    sendJson(res, 200, { ok: true, settings, tools: toolInfo(), models: { image: config.imageModels, video: config.videoModels } })
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

  /* ---- 收藏 / 角色库 ---- */

  async function requireFile(rel) {
    const absolute = safePath(rel)
    if (absolute === undefined) throw new Error('路径不合法')
    const info = await stat(absolute)
    if (!info.isFile()) throw new Error('文件不存在')
    return absolute
  }

  async function handleFavorites(req, res, segments) {
    const body = await readJsonBody(req)
    await loadLibrary()
    const action = segments[1] ?? ''

    if (action === 'add') {
      const rel = typeof body.rel === 'string' ? body.rel.trim() : ''
      try {
        await requireFile(rel)
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error.message })
        return
      }
      const existing = favorites.items.find((item) => item.rel === rel)
      if (existing !== undefined) {
        sendJson(res, 200, { ok: true, favorite: existing, duplicate: true })
        return
      }
      const favorite = {
        id: `fav-${now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        rel,
        name: typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '',
        folderId: typeof body.folderId === 'string' && body.folderId !== '' ? body.folderId : '',
        createdAt: now(),
      }
      favorites.items.unshift(favorite)
      await saveFavorites()
      sendJson(res, 200, { ok: true, favorite })
      return
    }

    if (action === 'remove') {
      favorites.items = favorites.items.filter((item) => item.id !== body.id)
      await saveFavorites()
      sendJson(res, 200, { ok: true })
      return
    }

    if (action === 'move') {
      const target = favorites.items.find((item) => item.id === body.id)
      if (target === undefined) {
        sendJson(res, 404, { ok: false, error: '收藏不存在' })
        return
      }
      target.folderId = typeof body.folderId === 'string' ? body.folderId : ''
      await saveFavorites()
      sendJson(res, 200, { ok: true })
      return
    }

    if (action === 'folder') {
      const mode = body.action === 'create' || body.action === 'rename' || body.action === 'delete' ? body.action : ''
      if (mode === 'create') {
        const name = typeof body.name === 'string' ? body.name.trim().slice(0, 40) : ''
        if (name === '') {
          sendJson(res, 400, { ok: false, error: '收藏夹名字不能为空' })
          return
        }
        const folder = { id: `folder-${now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`, name, createdAt: now() }
        favorites.folders.push(folder)
        await saveFavorites()
        sendJson(res, 200, { ok: true, folder })
        return
      }
      if (mode === 'rename') {
        const folder = favorites.folders.find((item) => item.id === body.id)
        if (folder === undefined) {
          sendJson(res, 404, { ok: false, error: '收藏夹不存在' })
          return
        }
        if (typeof body.name === 'string' && body.name.trim() !== '') folder.name = body.name.trim().slice(0, 40)
        await saveFavorites()
        sendJson(res, 200, { ok: true })
        return
      }
      if (mode === 'delete') {
        favorites.folders = favorites.folders.filter((item) => item.id !== body.id)
        for (const item of favorites.items) if (item.folderId === body.id) item.folderId = ''
        await saveFavorites()
        sendJson(res, 200, { ok: true })
        return
      }
      sendJson(res, 400, { ok: false, error: '未知收藏夹操作' })
      return
    }

    sendJson(res, 404, { ok: false, error: '未知收藏操作' })
  }

  async function handleCharacters(req, res, segments) {
    const body = await readJsonBody(req)
    await loadLibrary()
    const action = segments[1] ?? ''
    const refs = Array.isArray(body.refs)
      ? body.refs.filter((item) => typeof item === 'string' && item.trim() !== '').map((item) => item.trim()).slice(0, config.maxRefs)
      : []

    if (action === 'save') {
      const name = typeof body.name === 'string' ? body.name.trim().slice(0, 60) : ''
      if (name === '') {
        sendJson(res, 400, { ok: false, error: '角色名不能为空' })
        return
      }
      for (const rel of refs) {
        try {
          await requireFile(rel)
        } catch (error) {
          sendJson(res, 400, { ok: false, error: `${rel}：${error.message}` })
          return
        }
      }
      const description = typeof body.description === 'string' ? body.description.trim().slice(0, 600) : ''
      const existing = typeof body.id === 'string' ? characters.items.find((item) => item.id === body.id) : undefined
      if (existing !== undefined) {
        existing.name = name
        existing.description = description
        existing.refs = refs
        existing.updatedAt = now()
        await saveCharacters()
        sendJson(res, 200, { ok: true, character: existing })
        return
      }
      const character = {
        id: `char-${now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        name,
        description,
        refs,
        createdAt: now(),
        updatedAt: now(),
      }
      characters.items.unshift(character)
      await saveCharacters()
      sendJson(res, 200, { ok: true, character })
      return
    }

    if (action === 'delete') {
      characters.items = characters.items.filter((item) => item.id !== body.id)
      await saveCharacters()
      sendJson(res, 200, { ok: true })
      return
    }

    sendJson(res, 404, { ok: false, error: '未知角色操作' })
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
      if (segments.length === 1 && segments[0] === 'settings') {
        if (method === 'POST') await handleSettings(req, res)
        else {
          await loadSettings()
          sendJson(res, 200, { ok: true, settings, tools: toolInfo(), models: { image: config.imageModels, video: config.videoModels } })
        }
        return
      }
      if (segments.length === 2 && segments[0] === 'favorites' && method === 'POST') {
        await handleFavorites(req, res, segments)
        return
      }
      if (segments.length === 2 && segments[0] === 'characters' && method === 'POST') {
        await handleCharacters(req, res, segments)
        return
      }
      if (segments.length === 2 && segments[0] === 'pricing' && segments[1] === 'refresh' && method === 'POST') {
        const snapshot = await refreshPricing(true)
        sendJson(res, 200, { ok: snapshot.ok, error: snapshot.error, pricing: pricingView() })
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
  void refreshPricing(true)
  logger.info?.(`[hfsy-studio] 生图工作台已加载：${config.baseUrl} → ${config.outputDir}`)
}