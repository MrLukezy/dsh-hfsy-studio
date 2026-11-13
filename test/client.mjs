/**
 * 浏览器半边的结构冒烟测试：不启动 dsh、不装 React。
 *
 * 用假的 React（createElement 出普通对象、hooks 返回桩值）跑一遍工厂函数，
 * 验证：ModuleLoader 注册 id 正确、apply 注册了侧栏入口 + 主面板、
 * 面板组件能完整执行 render 体而不抛错、样式只注入一次。
 *
 *   node test/client.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = readFileSync(path.join(here, '..', 'client.js'), 'utf8')

/* --------------------------------------------------------------- 假的宿主 */

let captured
const styleCalls = []
const sandbox = {
  console,
  setTimeout: (fn) => { fn(); return 0 },
  clearTimeout: () => {},
  setInterval: () => 0,
  clearInterval: () => {},
  navigator: { language: 'zh-CN' },
  fetch: async () => ({ ok: false, status: 500, text: async () => '' }),
  document: {
    createElement: () => ({ dataset: {}, style: {}, textContent: '', remove() {} }),
    head: { append: (node) => styleCalls.push(node) },
    querySelector: () => null,
  },
  window: {
    localStorage: { getItem: () => null, setItem: () => {} },
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: (fn) => { fn(); return 0 },
    clearTimeout: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    confirm: () => true,
    __ModuleLoader__: {
      load(spec) { captured = spec },
    },
  },
}
vm.createContext(sandbox)
vm.runInContext(source, sandbox, { filename: 'client.js' })

assert.ok(captured, 'client.js 应调用 window.__ModuleLoader__.load')
assert.equal(captured.id, 'dsh-hfsy-studio')

/* --------------------------------------------------------------- 假的 React */

const hooks = []
function makeReact() {
  const createElement = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(4) })
  return {
    createElement,
    useState(initial) { return [typeof initial === 'function' ? initial() : initial, () => {}] },
    useMemo(fn) { return fn() },
    useCallback(fn) { return fn },
    useRef(value) { return { current: value } },
    useEffect(fn) { hooks.push(fn) },
  }
}

const React = makeReact()
const module = captured.factory((name) => {
  if (name === 'react') return React
  throw new Error(`意外的 require：${name}`)
})

assert.equal(module.inject[0], 'slots')
assert.equal(typeof module.apply, 'function')

/* --------------------------------------------------------------- 注册与渲染 */

const registrations = []
const ctx = {
  slots: {
    inject(_key, callback) { callback() },
    register(options, component) { registrations.push({ options, component }); return () => {} },
  },
  effect(fn) {
    const dispose = fn()
    return typeof dispose === 'function' ? dispose : () => {}
  },
}

module.apply(ctx)

assert.equal(registrations.length, 2, '应注册侧栏入口 + 主面板两个插槽')
const sidebar = registrations.find((item) => item.options.name === 'sidebar.panellist')
const main = registrations.find((item) => item.options.name === 'main')
assert.ok(sidebar && main)
assert.equal(sidebar.options.id, 'hfsy-studio')
assert.equal(main.options.key, 'hfsy-studio')

const glyph = sidebar.component({ size: 18, active: false })
assert.equal(glyph.type, 'svg')

const tree = main.component()
assert.equal(tree.type, 'div')
assert.equal(tree.props.className, 'hs-root')

/** 递归数节点，顺带确认没有 undefined 混进 children。 */
function walk(node, depth = 0) {
  if (node === null || node === undefined) return 0
  if (Array.isArray(node)) return node.reduce((total, item) => total + walk(item, depth), 0)
  if (typeof node !== 'object') return 0
  if (node.type === undefined && node.children.length === 0) {
    throw new Error('渲染树里出现了没有 type 的对象')
  }
  let count = 1
  for (const child of node.children ?? []) count += walk(child, depth + 1)
  return count
}

const nodes = walk(tree)
assert.ok(nodes > 30, `面板应渲染出完整结构，实际节点 ${nodes}`)
assert.equal(styleCalls.length, 1, '样式只应注入一次')

const css = styleCalls[0].textContent
assert.ok(css.includes('.hs-root'))
assert.ok(!css.includes('undefined'), 'CSS 里不该出现 undefined')

console.log('✓ ModuleLoader 注册 id:', captured.id)
console.log('✓ 插槽注册:', registrations.map((item) => item.options.name).join(', '))
console.log('✓ 侧栏图标 / 主面板渲染节点数:', nodes)
console.log('✓ 样式注入一次，长度', css.length)
console.log('\n全部通过')