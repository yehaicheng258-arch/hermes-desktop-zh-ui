// Engine test: run the REAL generated plugin's translation engine against a real DOM (jsdom).
//   node tests/test_engine.mjs [path/to/plugin.js]
import fs from 'node:fs'
import path from 'node:path'
import { JSDOM } from 'jsdom'

const PLUGIN = path.resolve(process.argv[2] || process.env.ZH_PLUGIN || 'dist/plugin.js')
const src = fs.readFileSync(PLUGIN, 'utf8')

const START = '// ==ZHUI-ENGINE-START=='
const END = '// ==ZHUI-ENGINE-END=='
const i = src.indexOf(START)
const j = src.indexOf(END)
if (i < 0 || j < 0) throw new Error('engine markers missing in ' + PLUGIN)
const engineSrc = src.slice(i + START.length, j)

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
const { window } = dom
const doc = window.document

const factory = new Function(
  'document',
  'window',
  'MutationObserver',
  'NodeFilter',
  'Node',
  engineSrc +
    '\nreturn { DICT, pick, applyTo, walk, startEngine, stopEngine, norm, stats: () => engineStats, setUpdate: f => { onUpdate = f } };'
)
const eng = factory(doc, window, window.MutationObserver, window.NodeFilter, window.Node)

let pass = 0
let fail = 0
function check(name, cond, extra = '') {
  if (cond) {
    pass++
    console.log('  ok   ' + name)
  } else {
    fail++
    console.log('  FAIL ' + name + (extra ? ' → ' + extra : ''))
  }
}

const keys = Object.keys(eng.DICT)
console.log('dictionary entries: ' + keys.length)
if (keys.length < 10) {
  console.log('dictionary too small — build the plugin first (scripts/build_zh_ui.py)')
  process.exit(2)
}

const byLen = keys.slice().sort((a, b) => a.length - b.length)
const shortEn = byLen[0]
const midEn = byLen[Math.floor(byLen.length / 2)]
const longEn = byLen[byLen.length - 1]

const card = doc.createElement('div')
card.className = 'catalog-card'
const cardDesc = doc.createElement('span')
cardDesc.textContent = midEn
card.appendChild(cardDesc)

const chip = doc.createElement('div')
const chipText = doc.createElement('span')
chipText.textContent = shortEn
chip.appendChild(chipText)

const longWrap = doc.createElement('div')
const longText = doc.createElement('span')
longText.textContent = longEn
longWrap.appendChild(longText)

// must stay English
const pre = doc.createElement('pre')
const preText = doc.createElement('code')
preText.textContent = midEn
pre.appendChild(preText)

const optOut = doc.createElement('div')
optOut.setAttribute('data-zh-skip', '')
const optOutText = doc.createElement('span')
optOutText.textContent = midEn
optOut.appendChild(optOutText)

const chat = doc.createElement('p')
const chatText = doc.createTextNode('Sure — I rewrote the ingest pipeline and it now runs 3x faster.')
chat.appendChild(chatText)

const zh = doc.createElement('p')
const zhText = doc.createTextNode('主人🐴 的仓库已经改成中文说明，无需再翻。')
zh.appendChild(zhText)

for (const n of [card, chip, longWrap, pre, optOut, chat, zh]) doc.body.appendChild(n)

let updates = 0
eng.setUpdate(() => updates++)
const st = eng.startEngine()
check('startEngine reports stats', st && st.dict === keys.length, JSON.stringify(st))
check('card description translated', /[\u4e00-\u9fff]/.test(cardDesc.textContent))
check('short title translated', /[\u4e00-\u9fff]/.test(chipText.textContent))
check('long description translated', /[\u4e00-\u9fff]/.test(longText.textContent))
check('<code> stays English', preText.textContent === midEn)
check('[data-zh-skip] stays English', optOutText.textContent === midEn)
check('chat text untouched', chatText.nodeValue.startsWith('Sure — I rewrote'))
check('already-Chinese text untouched', zhText.nodeValue.startsWith('主人🐴'))
check('counter > 0', eng.stats().nodes >= 3, String(eng.stats().nodes))

// React re-render writes English back → observer must translate again
cardDesc.textContent = midEn
await new Promise(r => setTimeout(r, 30))
check('re-render translated again', /[\u4e00-\u9fff]/.test(cardDesc.textContent), cardDesc.textContent.slice(0, 40))

// dynamically mounted node (tab switch)
const later = doc.createElement('div')
const laterText = doc.createElement('span')
laterText.textContent = shortEn
later.appendChild(laterText)
doc.body.appendChild(later)
await new Promise(r => setTimeout(r, 30))
check('late-mounted node translated', /[\u4e00-\u9fff]/.test(laterText.textContent))

// toggle off restores English
eng.stopEngine()
await new Promise(r => setTimeout(r, 30))
check('stop(): card restored', cardDesc.textContent === midEn, cardDesc.textContent.slice(0, 40))
check('stop(): late node restored', laterText.textContent === shortEn)
check('stop(): <code> never polluted', preText.textContent === midEn)
check('stop(): chat still untouched', chatText.nodeValue.startsWith('Sure — I rewrote'))

// whitespace-insensitive matching
const messy = doc.createElement('p')
messy.textContent = '  ' + midEn.replace(/ /g, '  \n ') + '  '
doc.body.appendChild(messy)
check('whitespace differences still match', eng.pick(messy.textContent) !== null)

console.log(`\nresult: ${pass} passed / ${fail} failed (updates=${updates})`)
process.exit(fail ? 1 : 0)
