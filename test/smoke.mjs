/**
 * 独立冒烟测试：不启动 dsh，直接把宿主插件挂到一个临时 HTTP 服务上跑。
 *
 *   node test/smoke.mjs          # 只测状态与参数校验，不花钱
 *   node test/smoke.mjs --live   # 真调一次 gpt-image-2，落盘到 test/output
 *
 * 密钥来源：环境变量 OPENAI_API_KEY，或 ~/.dsh/.credentials.yaml 里的 refs.OPENAI_API_KEY。
 */

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply } from '../index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const outputDir = path.join(here, 'output')
const live = process.argv.includes('--live')
const liveVideo = process.argv.includes('--live-video')
const liveEdit = process.argv.includes('--live-edit')

async function readKeyFromCredentials() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY
  try {
    const raw = await readFile(path.join(os.homedir(), '.dsh', '.credentials.yaml'), 'utf8')
    const match = /OPENAI_API_KEY:\s*(\S+)/u.exec(raw)
    return match?.[1]
  } catch {
    return undefined
  }
}

const key = await readKeyFromCredentials()
if (key) process.env.OPENAI_API_KEY = key

await rm(outputDir, { recursive: true, force: true })

/** 极简 cordis ctx 替身，只实现插件用到的 inject / effect / logger。 */
const registrations = []
const ctx = {
  logger: {
    info: (message) => console.log('[host]', message),
    warn: (message) => console.warn('[host]', message),
  },
  effect(fn) {
    const dispose = fn()
    return typeof dispose === 'function' ? dispose : () => {}
  },
  inject(names, callback) {
    if (names.includes('credentials')) {
      callback({ credentials: { resolve: async () => (key ? { value: key, source: 'credentials' } : undefined) } })
    }
    if (names.includes('webServer')) {
      callback({
        webServer: {
          register(spec) {
            registrations.push(spec)
            return () => {}
          },
        },
        effect(fn) {
          const dispose = fn()
          return typeof dispose === 'function' ? dispose : () => {}
        },
      })
    }
  },
}

apply(ctx, {
  baseUrl: process.env.HFSY_BASE_URL || 'https://www.hfsyapi.cn/v1',
  apiKeyEnv: 'OPENAI_API_KEY',
  outputDir,
  maxConcurrent: 2,
})

assert.equal(registrations.length, 1, '插件应注册一组路由')
const route = registrations[0]
assert.equal(route.kind, 'prefix')
assert.equal(route.path, '/hfsy-studio/api')

const server = createServer((req, res) => {
  if (!req.url?.startsWith(route.path)) {
    res.writeHead(404).end('no')
    return
  }
  void route.handler(req, res)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}${route.path}`

const call = async (suffix, options = {}) => {
  const init = { method: options.method ?? 'GET', headers: {} }
  if (options.body !== undefined) {
    init.headers['content-type'] = 'application/json'
    init.body = JSON.stringify(options.body)
  }
  const response = await fetch(`${base}${suffix}`, init)
  const text = await response.text()
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error(`非 JSON 响应：${text.slice(0, 200)}`)
  }
  return { status: response.status, payload }
}

/* ---------------------------------------------------------------- 状态接口 */

const state = await call('/state')
assert.equal(state.status, 200)
assert.equal(state.payload.ok, true)
assert.equal(state.payload.config.outputDir, outputDir)
assert.ok(Array.isArray(state.payload.models.image) && state.payload.models.image.length > 0)
assert.equal(state.payload.config.hasKey, Boolean(key))
console.log('✓ /state', JSON.stringify({
  hasKey: state.payload.config.hasKey,
  keySource: state.payload.config.keySource,
  imageModels: state.payload.models.image.length,
  videoModels: state.payload.models.video.length,
}))

/* ---------------------------------------------------------------- 价目表 */

let priced
for (let attempt = 0; attempt < 20; attempt += 1) {
  const snapshot = await call('/state')
  priced = snapshot.payload.pricing
  if (priced?.ok === true && Object.keys(priced.models ?? {}).length > 0) break
  await new Promise((resolve) => setTimeout(resolve, 1000))
}
assert.equal(priced?.ok, true, '应能从 /api/pricing 拉到价目表')
const firstImage = state.payload.models.image.find((id) => priced.models[id])
const firstVideo = state.payload.models.video.find((id) => priced.models[id])
assert.ok(firstImage, '出图模型应有标价')
assert.ok(firstVideo, '出片模型应有标价')
assert.ok(priced.models[firstImage].price > 0)
assert.equal(priced.models[firstVideo].perSecond, true, '视频价格应按秒')
console.log('✓ 价目表', JSON.stringify({
  currency: priced.currency,
  models: Object.keys(priced.models).length,
  [firstImage]: priced.models[firstImage].price,
  [firstVideo]: `${priced.models[firstVideo].price}/s`,
}))

/* ---------------------------------------------------------------- 参数校验 */

const empty = await call('/generate', { method: 'POST', body: { prompt: '   ' } })
assert.equal(empty.status, 400)
assert.match(empty.payload.error, /提示词/u)

const badModel = await call('/generate', { method: 'POST', body: { prompt: 'x', model: 'not-a-model' } })
assert.equal(badModel.status, 400)
console.log('✓ 参数校验（空提示词 / 未知模型）')

const traversal = await call('/file?rel=../../evil.txt')
assert.equal(traversal.status, 400)
console.log('✓ 路径穿越被拒')

/* ---------------------------------------------------------------- 收藏 / 角色 / 工具 */

const badFav = await call('/favorites/add', { method: 'POST', body: { rel: '../evil.png' } })
assert.equal(badFav.status, 400)
const badChar = await call('/characters/save', { method: 'POST', body: { name: '  ' } })
assert.equal(badChar.status, 400)
const noSource = await call('/generate', { method: 'POST', body: { kind: 'image', tool: 'upscale', model: 'gpt-image-2pro-4k' } })
assert.equal(noSource.status, 400)
assert.match(noSource.payload.error, /源图/u)
console.log('✓ 收藏 / 角色 / 4K 参数校验')

async function runLive() {
  /* -------------------------------------------------------------- 真实生成 */

  assert.equal(state.payload.config.hasKey, true, '真实生成需要 OPENAI_API_KEY')

  const created = await call('/generate', {
    method: 'POST',
    body: { kind: 'image', model: 'gpt-image-2', prompt: 'a red apple on a white table, flat icon style', size: '1024x1024', quality: 'auto', count: 1, format: 'png' },
  })
  assert.equal(created.status, 200)
  assert.equal(created.payload.ok, true)
  const jobId = created.payload.job.id
  console.log('✓ 提交任务', jobId)

  const deadline = Date.now() + 240_000
  let job
  for (;;) {
    const snapshot = await call('/state')
    job = snapshot.payload.jobs.find((item) => item.id === jobId)
    if (job && (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled')) break
    if (Date.now() > deadline) throw new Error('等待生成超时')
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }

  if (job.status !== 'succeeded') throw new Error(`生成失败：${job.error}`)

  assert.equal(job.results.length, 1)
  const entry = job.results[0]
  const absolute = path.join(outputDir, entry.rel)
  const bytes = await readFile(absolute)
  assert.ok(bytes.byteLength > 5_000, '落盘文件应是一张真图')
  console.log('✓ 生成完成', JSON.stringify({ file: entry.file, bytes: entry.bytes, width: entry.width, height: entry.height, ms: job.elapsedMs }))

  const served = await fetch(`${base}/file?rel=${encodeURIComponent(entry.rel)}`)
  assert.equal(served.status, 200)
  assert.match(String(served.headers.get('content-type')), /image\//u)
  console.log('✓ /file 可回读')

  const historyJson = JSON.parse(await readFile(path.join(outputDir, 'history.json'), 'utf8'))
  assert.equal(historyJson.entries.length, 1)
  console.log('✓ history.json 已持久化')
}

async function runLiveVideo() {
  assert.equal(state.payload.config.hasKey, true, '真实出片需要 OPENAI_API_KEY')

  const model = process.env.HFSY_VIDEO_MODEL || 'sd-2-fast-480'
  const created = await call('/generate', {
    method: 'POST',
    body: { kind: 'video', model, prompt: 'a paper boat drifting on a puddle, light rain, slow push in', duration: 4, resolution: '480p' },
  })
  assert.equal(created.status, 200, JSON.stringify(created.payload))
  assert.equal(created.payload.ok, true)
  const jobId = created.payload.job.id
  console.log('✓ 提交视频任务', jobId, model)

  const deadline = Date.now() + 900_000
  let job
  for (;;) {
    const snapshot = await call('/state')
    job = snapshot.payload.jobs.find((item) => item.id === jobId)
    if (job && (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled')) break
    if (Date.now() > deadline) throw new Error('等待出片超时')
    process.stdout.write(`\r  ${job?.phase ?? '…'} ${Math.round((job?.elapsedMs ?? 0) / 1000)}s   `)
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }
  process.stdout.write('\n')

  if (job.status !== 'succeeded') throw new Error(`出片失败：${job.error}`)

  const entry = job.results[0]
  const bytes = await readFile(path.join(outputDir, entry.rel))
  assert.ok(bytes.byteLength > 50_000, '落盘文件应是一段真视频')
  assert.match(entry.mediaType, /video\//u)
  console.log('✓ 视频完成', JSON.stringify({ file: entry.file, bytes: entry.bytes, resolution: entry.resolution, duration: entry.duration, ms: job.elapsedMs }))

  const served = await fetch(`${base}/file?rel=${encodeURIComponent(entry.rel)}`)
  assert.equal(served.status, 200)
  assert.match(String(served.headers.get('content-type')), /video\//u)
  console.log('✓ /file 可回读视频')
}

async function runLiveEdit() {
  assert.equal(state.payload.config.hasKey, true, '真实图生图需要 OPENAI_API_KEY')
  await runLive()

  const entry = state.payload.history.length > 0 ? state.payload.history[0] : undefined
  const stateNow = await call('/state')
  const source = stateNow.payload.history[0]
  assert.ok(source, '需要一条历史图才能测收藏 / 角色 / 4K')
  console.log('✓ 源图', source.rel)

  const fav = await call('/favorites/add', { method: 'POST', body: { rel: source.rel } })
  assert.equal(fav.payload.ok, true, JSON.stringify(fav.payload))
  console.log('✓ 收藏已写入 favorites.json')

  const character = await call('/characters/save', {
    method: 'POST',
    body: { name: '测试角色', description: 'a blue glowing sword icon, flat vector', refs: [source.rel] },
  })
  assert.equal(character.payload.ok, true, JSON.stringify(character.payload))
  console.log('✓ 角色已保存', character.payload.character.id)

  const withRefs = await call('/generate', {
    method: 'POST',
    body: { kind: 'image', model: 'gpt-image-2', prompt: 'the same icon but tinted emerald green', count: 1, refs: [source.rel] },
  })
  assert.equal(withRefs.status, 200, JSON.stringify(withRefs.payload))
  console.log('✓ 提交图生图', withRefs.payload.job.id)

  const deadline = Date.now() + 240_000
  let job
  for (;;) {
    const snapshot = await call('/state')
    job = snapshot.payload.jobs.find((item) => item.id === withRefs.payload.job.id)
    if (job && (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled')) break
    if (Date.now() > deadline) throw new Error('图生图超时')
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  if (job.status !== 'succeeded') throw new Error(`图生图失败：${job.error}`)
  assert.equal(job.results.length, 1)
  assert.deepEqual(job.results[0].refs, [source.rel])
  console.log('✓ 图生图完成', JSON.stringify({ file: job.results[0].file, bytes: job.results[0].bytes, ms: job.elapsedMs }))

  const up = await call('/generate', {
    method: 'POST',
    body: { kind: 'image', tool: 'upscale', model: 'gpt-image-2pro-4k', size: '3840x2160', refs: [source.rel], count: 1 },
  })
  assert.equal(up.status, 200, JSON.stringify(up.payload))
  const deadline2 = Date.now() + 300_000
  let upJob
  for (;;) {
    const snapshot = await call('/state')
    upJob = snapshot.payload.jobs.find((item) => item.id === up.payload.job.id)
    if (upJob && (upJob.status === 'succeeded' || upJob.status === 'failed' || upJob.status === 'cancelled')) break
    if (Date.now() > deadline2) throw new Error('4K 超时')
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  if (upJob.status !== 'succeeded') throw new Error(`4K 失败：${upJob.error}`)
  const out = upJob.results[0]
  assert.equal(out.width, 3840)
  assert.equal(out.height, 2160)
  assert.equal(out.tool, 'upscale')
  console.log('✓ 4K 增强完成', JSON.stringify({ file: out.file, size: `${out.width}x${out.height}`, bytes: out.bytes }))
}

if (live || liveVideo || liveEdit) {
  try {
    if (live) await runLive()
    if (liveVideo) await runLiveVideo()
    if (liveEdit) await runLiveEdit()
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
  console.log('\n全部通过')
} else {
  console.log('\n跳过真实生成（加 --live 出图 / --live-video 出片）')
  await new Promise((resolve) => server.close(resolve))
}