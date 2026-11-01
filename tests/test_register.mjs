// Contract test: load the generated plugin.js as a real ESM module (SDK stubbed), call
// register(), and check the UI contributions + the engine actually rewriting the DOM.
//   node tests/test_register.mjs [path/to/plugin.js]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'

const here = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN = path.resolve(process.argv[2] || process.env.ZH_PLUGIN || 'dist/plugin.js')
const src = fs.readFileSync(PLUGIN, 'utf8')

// --- a real dictionary key, taken from the build output -----------------------
function dictKeys() {
  const s = src.slice(src.indexOf('// ==ZHUI-ENGINE-START=='), src.indexOf('// ==ZHUI-ENGINE-END=='))
  return new Function(s + '\nreturn Object.keys(DICT)')()
}
const keys = dictKeys().sort((a, b) => a.length - b.length)
const EN = keys[Math.floor(keys.length / 3)]
console.log('fixture string: ' + EN.slice(0, 60) + '…')

// --- stub SDK next to a copy of the plugin so its imports resolve --------------
const runtime = path.join(here, '.runtime')
fs.rmSync(runtime, { recursive: true, force: true })
fs.mkdirSync(path.join(runtime, 'node_modules', '@hermes', 'plugin-sdk'), { recursive: true })
fs.mkdirSync(path.join(runtime, 'node_modules', 'react'), { recursive: true })
fs.writeFileSync(
  path.join(runtime, 'node_modules', '@hermes', 'plugin-sdk', 'package.json'),
  JSON.stringify({ name: '@hermes/plugin-sdk', version: '0.0.0-stub', type: 'module', main: 'index.js' })
)
fs.writeFileSync(
  path.join(runtime, 'node_modules', '@hermes', 'plugin-sdk', 'index.js'),
  [
    "export const PALETTE_AREA = 'palette'",
    'export function atom(v) { let val = v; return { get: () => val, set: n => { val = n } } }',
    'export const useValue = a => a.get()',
    'export const host = { notify: o => { (globalThis.__notified ||= []).push(o) }, request: async () => ({}) }',
  ].join('\n')
)
fs.writeFileSync(
  path.join(runtime, 'node_modules', 'react', 'package.json'),
  JSON.stringify({
    name: 'react',
    version: '0.0.0-stub',
    type: 'module',
    main: 'index.js',
    exports: { '.': './index.js', './jsx-runtime': './jsx-runtime.js' },
  })
)
fs.writeFileSync(path.join(runtime, 'node_modules', 'react', 'index.js'), 'export const useState = () => [undefined, () => {}]\n')
fs.writeFileSync(
  path.join(runtime, 'node_modules', 'react', 'jsx-runtime.js'),
  'export function jsx(type, props) { return { $$jsx: true, type, props } }\nexport const jsxs = jsx\n'
)
const copy = path.join(runtime, 'plugin.mjs')
fs.writeFileSync(copy, src)

// --- DOM ----------------------------------------------------------------------
const dom = new JSDOM(
  `<!doctype html><html><body>
     <div class="catalog-card"><span id="desc"></span></div>
     <p id="chat">Sure — the pipeline runs faster now.</p>
     <pre><code id="code"></code></pre>
   </body></html>`,
  { pretendToBeVisual: true }
)
dom.window.document.getElementById('desc').textContent = EN
dom.window.document.getElementById('code').textContent = EN

globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.MutationObserver = dom.window.MutationObserver
globalThis.NodeFilter = dom.window.NodeFilter
globalThis.Node = dom.window.Node

const plugin = (await import(pathToFileURL(copy).href)).default

const contributions = []
const store = new Map()
const ctx = {
  register(c) {
    contributions.push(c)
  },
  storage: {
    get: (k, d) => (store.has(k) ? store.get(k) : d),
    set: (k, v) => store.set(k, v),
    remove: k => store.delete(k),
  },
}
plugin.register(ctx)

const chip = contributions.find(c => c.area === 'statusBar.right')
const palette = contributions.find(c => c.area === 'palette')
let pass = 0
let fail = 0
const check = (n, c, extra = '') => {
  if (c) {
    pass++
    console.log('  ok   ' + n)
  } else {
    fail++
    console.log('  FAIL ' + n + (extra ? ' → ' + extra : ''))
  }
}

check('plugin id is zh-ui', plugin.id === 'zh-ui', plugin.id)
check('status bar chip registered', !!chip)
check('chip renders an element', !!(chip && chip.render() && chip.render().$$jsx))
check('command palette entry registered', !!(palette && palette.data && typeof palette.data.run === 'function'))

const desc = document.getElementById('desc')
const chat = document.getElementById('chat')
const code = document.getElementById('code')

await new Promise(r => setTimeout(r, 20))
check('card translated after register', /[\u4e00-\u9fff]/.test(desc.textContent), desc.textContent.slice(0, 30))
check('chat untouched', chat.textContent.includes('pipeline runs faster'))
check('code block untouched', code.textContent === EN)

palette.data.run()
await new Promise(r => setTimeout(r, 20))
check('toggle off restores English', desc.textContent === EN, desc.textContent.slice(0, 30))
check('toggle off persists', store.get('enabled') === false, JSON.stringify([...store]))
check('toggle shows a toast', (globalThis.__notified || []).length > 0)

palette.data.run()
await new Promise(r => setTimeout(r, 20))
check('toggle on translates again', /[\u4e00-\u9fff]/.test(desc.textContent))
check('toggle on persists', store.get('enabled') === true)

console.log(`\nresult: ${pass} passed / ${fail} failed`)
process.exit(fail ? 1 : 0)
