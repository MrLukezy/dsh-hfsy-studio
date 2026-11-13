/**
 * 工具侧验证：注册给模型的 generate_image / generate_video 是不是真能跑通。
 *
 *   node test/tool.mjs            # 只查注册与参数校验（不花钱）
 *   node test/tool.mjs --live     # 真跑一次生成，校验落盘、历史 source 标记、分辨率预设
 */

import assert from 'node:assert/strict'
import { readFile, rm, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const outputDir = path.join(here, 'output-tool')
const live = process.argv.includes('--live')

async function readKeyFromCredentials() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY
  try {
    const raw = await readFile(path.join(os.homedir(), '.dsh', '.credentials.yaml'), 'utf8')
    return /OPENAI_API_KEY:\s*(\S+)/u.exec(raw)?.[1]
  } catch {
    return undefined
  }
}

const key = await readKeyFromCredentials()
if (key) process.env.OPENAI_API_KEY = key

await rm(outputDir, { recursive: true, force: true })

const { apply } = await import('../index.js')

/** 假 ctx：webServer 走真 server，tools 只记下注册进来的定义。 */
const tools = []
const webHandlers = []
let toolsCallback

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
    if (names.includes('tools')) {
      toolsCallback = callback
      callback({
        tools: {
          register(definition) {
            tools.push(definition)
            return () => {
              const at = tools.indexOf(definition)
              if (at >= 0) tools.splice(at, 1)
            }
          },
        },
      })
    }
    if (names.includes('webServer')) {
      callback({
        webServer: {
          register(spec) {
            webHandlers.push(spec)
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

assert.equal(typeof toolsCallback, 'function', '插件应在 tools 服务可用时注册工具')
await new Promise((resolve) => setTimeout(resolve, 200))

const names = tools.map((item) => item.name)
assert.deepEqual(names.slice(0, 2), ['generate_image', 'generate_video'])
console.log('✓ 注册工具', names.join(', '))

const imageTool = tools.find((item) => item.name === 'generate_image')
const videoTool = tools.find((item) => item.name === 'generate_video')
for (const tool of [imageTool, videoTool]) {
  assert.equal(typeof tool.description, 'string')
  assert.equal(tool.parameters.type, 'object')
  assert.ok(tool.output && typeof tool.output.render === 'function')
  assert.equal(typeof tool.execute, 'function')
}
console.log('✓ 工具定义结构（描述 / JSON Schema / render / execute）')

const route = webHandlers[0]
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
  return { status: response.status, payload: JSON.parse(await response.text()) }
}

/* 分辨率预设：工具按预设名挑尺寸 */
const preset = await call('/settings', {
  method: 'POST',
  body: {
    resolutions: [
      { id: 'square', label: '1:1 · 1024', size: '1024x1024', model: '' },
      { id: 'uhd', label: '4K · 3840', size: '3840x2160', model: 'gpt-image-2pro-4k' },
    ],
  },
})
assert.equal(preset.status, 200)
assert.equal(preset.payload.settings.resolutions.length, 2)
console.log('✓ 分辨率预设保存')

/* 关闭自动调用应该把工具全部注销 */
const off = await call('/settings', { method: 'POST', body: { autoTool: false } })
assert.equal(off.status, 200)
assert.equal(off.payload.tools.names.length, 0)
assert.equal(tools.length, 0, '关闭后不应该还有注册中的工具')
const back = await call('/settings', { method: 'POST', body: { autoTool: true } })
assert.equal(back.status, 200)
assert.equal(back.payload.tools.names.length, 2)
assert.equal(tools.length, 2)
console.log('✓ 开关能真正注册 / 注销工具')

/* 队列顺序：第一个模型失败时换下一个（这里只验队列落进设置） */
const reorder = await call('/settings', { method: 'POST', body: { imageQueue: ['gpt-image-2pro-4k', 'gpt-image-2'] } })
assert.equal(reorder.status, 200)
assert.equal(reorder.payload.settings.imageQueue[0], 'gpt-image-2pro-4k')
await call('/settings', { method: 'POST', body: { imageQueue: ['gpt-image-2', 'gpt-image-2pro'] } })
console.log('✓ 模型队列顺序保存')

if (live) {
  const startedAt = Date.now()
  const result = await imageTool.execute(
    { prompt: 'a single red cube on a seamless white background, product shot', resolution: 'square', count: 1 },
    { signal: new AbortController().signal },
  )
  const file = result.files[0]
  assert.ok(file, '工具应返回至少一个文件')
  const info = await stat(file.path)
  assert.ok(info.size > 10_000, '落盘文件应该够大')
  assert.ok(file.width >= 512 && file.height >= 512)
  console.log('✓ 工具生成成功', JSON.stringify({
    file: path.basename(file.path),
    width: file.width,
    height: file.height,
    bytes: info.size,
    ms: result.ms,
  }))

  const state = await call('/state')
  const entry = state.payload.history.find((item) => item.rel === file.rel)
  assert.equal(entry.source, 'tool', '工具调用应记成独立来源')
  console.log('✓ 历史记录标记为 tool，画廊可按「调用」筛选')

  const render = imageTool.output.render({}, result)
  assert.equal(render[0].type, 'text')
  console.log('✓ render 输出文本', render[0].text.split('\n')[0])

  console.log(`总耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)
}

await new Promise((resolve) => server.close(resolve))
console.log('\n全部通过')