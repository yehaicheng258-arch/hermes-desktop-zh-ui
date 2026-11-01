/**
 * Hermes Desktop — 中文界面 / Chinese UI for Hermes Desktop
 *
 * This file is a TEMPLATE. scripts/build_zh_ui.py replaces the DICT placeholder below with
 * generated dictionary and writes plugin.js into your desktop-plugins folder.
 * Do not hand-edit the generated plugin.js — re-run the build instead.
 *
 * How it works: dictionary + exact whole-node match. A text node is only replaced when
 * its entire (whitespace-normalised) text equals a dictionary key, so chat transcripts,
 * code blocks, commands and file paths are never touched. When React re-renders a node
 * back to English, the MutationObserver translates it again.
 */

import { atom, host, useValue, PALETTE_AREA } from '@hermes/plugin-sdk'
import { jsx } from 'react/jsx-runtime'

// ==ZHUI-ENGINE-START==
/** 英文原文（空白归一化后）→ 中文。 */
const DICT = /*__DICT__*/{}

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/
const SKIP_TAGS = new Set([
  'PRE', 'CODE', 'KBD', 'SAMP', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION',
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TITLE', 'CANVAS', 'SVG', 'MATH',
])

const originals = new Map() // textNode -> 原文
const misses = new Set() // 未命中的英文（只在 catalog/connector 容器里收，用于事后补词库）
let missTimer = null
let observer = null
let engineStats = { nodes: 0, scanned: 0, dict: 0 }
let onUpdate = null

/** 把「应该是 UI 文案但词库没有」的英文记下来，flush 时写进 desktop.log —— 这是补词库的唯一回路。 */
function noteMiss(node, text) {
  if (misses.size >= 200) return
  const t = String(text).trim()
  if (t.length < 10 || t.length > 240) return
  if (CJK.test(t)) return
  if (/^(https?:|\/|[A-Za-z]:\\)/.test(t)) return
  const el = node.parentElement
  if (!el || !el.closest) return
  if (!el.closest('[class*="catalog"],[data-slot*="connector"],[class*="toolset"]')) return
  misses.add(t)
}

function norm(s) {
  return String(s).replace(/\s+/g, ' ').trim()
}

/** 命中词库返回中文，否则 null。 */
function pick(text) {
  const n = norm(text)
  if (n.length < 5) return null
  if (CJK.test(n)) return null
  if (Object.prototype.hasOwnProperty.call(DICT, n)) return DICT[n]
  // 同一句在源数据里没句号、在 UI 上补了句号（连接器目录就是这样）：去掉尾标点再试一次。
  const trimmed = n.replace(/[.。!！?？]+$/, '')
  if (trimmed.length >= 5 && Object.prototype.hasOwnProperty.call(DICT, trimmed)) return DICT[trimmed]
  return null
}
function blocked(node) {
  let el = node.parentElement
  while (el) {
    if (SKIP_TAGS.has(el.tagName)) return true
    if (el.isContentEditable) return true
    if (el.hasAttribute && el.hasAttribute('data-zh-skip')) return true
    el = el.parentElement
  }
  return false
}

function applyTo(node) {
  if (!node || node.nodeType !== 3) return false
  const cur = node.nodeValue
  if (!cur) return false
  engineStats.scanned++
  const hit = pick(cur)
  if (hit === null) {
    noteMiss(node, cur)
    return false
  }
  if (blocked(node)) return false
  const start = cur.length - cur.trimStart().length
  const end = cur.trimEnd().length
  if (!originals.has(node)) originals.set(node, cur)
  node.nodeValue = cur.slice(0, start) + hit + cur.slice(end)
  engineStats.nodes++
  return true
}

function walk(root) {
  if (!root) return 0
  if (root.nodeType === 3) return applyTo(root) ? 1 : 0
  if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return 0
  let n = 0
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
  let node
  while ((node = tw.nextNode())) {
    if (applyTo(node)) n++
  }
  return n
}

function bump() {
  if (typeof onUpdate === 'function') onUpdate(engineStats.nodes)
}

function startEngine() {
  if (observer || typeof document === 'undefined' || !document.body) return engineStats
  engineStats.dict = Object.keys(DICT).length
  walk(document.body)
  observer = new MutationObserver(records => {
    for (const r of records) {
      if (r.type === 'characterData') applyTo(r.target)
      else if (r.addedNodes && r.addedNodes.length) {
        for (const added of r.addedNodes) walk(added)
      }
    }
    bump()
  })
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  if (typeof setInterval === 'function') {
    missTimer = setInterval(() => {
      if (!misses.size) return
      const batch = Array.from(misses)
      misses.clear()
      say('[zh-ui] misses ' + batch.length)
      for (const m of batch) say('[zh-ui] miss|' + m)
    }, 5000)
  }
  bump()
  return engineStats
}

function stopEngine() {
  if (observer) {
    observer.disconnect()
    observer = null
  }
  if (missTimer) {
    clearInterval(missTimer)
    missTimer = null
  }
  for (const [node, original] of originals) {
    if (node && node.nodeType === 3) node.nodeValue = original
  }
  originals.clear()
  engineStats.nodes = 0
  bump()
  return engineStats
}
// ==ZHUI-ENGINE-END==

// ---------------------------------------------------------------------------
// Host wiring — 状态栏开关 + ⌘K 命令
// ---------------------------------------------------------------------------
const onAtom = atom(false)
const countAtom = atom(0)

onUpdate = n => {
  if (countAtom.get() !== n) countAtom.set(n)
}

let ctxRef = null

function say(msg) {
  try {
    console.log(msg)
  } catch (e) {}
  trace(msg)
}

/** 写进 desktop.log（renderer console 不落盘，这条 IPC 会落盘）——验证插件行为只能靠它。 */
function trace(line) {
  try {
    if (window.hermesDesktop && window.hermesDesktop.logLine) window.hermesDesktop.logLine(String(line))
  } catch (e) {}
}

function toggle() {
  const next = !onAtom.get()
  onAtom.set(next)
  try {
    if (ctxRef && ctxRef.storage) ctxRef.storage.set('enabled', next)
  } catch (e) {}
  if (next) {
    startEngine()
    say('[zh-ui] on: ' + engineStats.nodes + ' nodes')
    host.notify({ kind: 'success', message: '中文界面已开启：' + countAtom.get() + ' 段' })
  } else {
    stopEngine()
    say('[zh-ui] off (restored)')
    host.notify({ kind: 'info', message: '中文界面已关闭，英文已还原' })
  }
}

function Chip() {
  const on = useValue(onAtom)
  const n = useValue(countAtom)
  return jsx('button', {
    type: 'button',
    'aria-label': '中文界面开关',
    title: on ? '界面已中文化 ' + n + ' 段，点一下还原英文' : '把英文技能/插件说明换成中文，点一下开启',
    onClick: toggle,
    className:
      'inline-flex h-full items-center gap-1 px-1.5 text-[0.6875rem] ' +
      (on ? 'text-(--ui-accent)' : 'text-(--ui-text-tertiary)'),
    children: on ? '中 ' + n : '中·关',
  })
}

const DIAG = false // 一次性自检开关：自动切到工具集/Connectors 页并 dump 未命中英文；验完改回 false

function diagClick(prefix) {
  const cands = []
  for (const el of document.querySelectorAll('button,[role="tab"],a,span,div')) {
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim()
    if (!t || t.length > 24) continue
    if (!t.startsWith(prefix)) continue
    if (el.offsetParent === null) continue
    cands.push(el)
  }
  // 文本越短越像标签本身；按钮优先
  cands.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length)
  const el = cands.find(x => x.tagName === 'BUTTON') || cands[0]
  if (!el) return 'none'
  const label = (el.tagName + ':' + (el.textContent || '').replace(/\s+/g, ' ').trim()).slice(0, 40)
  try {
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      const Ctor = type.startsWith('pointer') && typeof PointerEvent === 'function' ? PointerEvent : MouseEvent
      el.dispatchEvent(new Ctor(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        button: 0,
        buttons: type.endsWith('down') ? 1 : 0,
        isPrimary: true,
        pointerId: 1,
        pointerType: 'mouse',
      }))
    }
    const clickable = el.closest('button,[role="tab"]') || el
    if (clickable !== el) clickable.click()
    else el.click()
    const r = el.getBoundingClientRect()
    return label + '@' + Math.round(r.left + r.width / 2) + ',' + Math.round(r.top + r.height / 2)
  } catch (e) {
    return 'err:' + label
  }
  return label
}

function diagClickAny(prefixes) {
  for (const p of prefixes) {
    const r = diagClick(p)
    if (r !== 'none') return p + '->' + r
  }
  return 'none'
}

function tabStrip() {
  const out = []
  for (const el of document.querySelectorAll('button,[role="tab"],a')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.top < 55 || r.top > 95) continue
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim()
    if (!t || t.length > 24) continue
    out.push(t + '@' + Math.round(r.left + r.width / 2))
  }
  return out.join(' | ')
}

function probe(tag) {
  try {
    const marks = [
      'Most used', '最常使用',
      'Terminal & Processes', '终端与进程',
      'The toolsets Hermes reaches for most on this profile.', '此配置下 Hermes 最常使用的工具集。',
      'Use Adobe Marketing Agent through Hermes', '通过 Hermes 使用 Adobe Marketing Agent',
      'Disable', '禁用',
    ]
    const leaves = new Set()
    for (const el of document.querySelectorAll('*')) {
      if (el.children && el.children.length) continue
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim()
      if (t) leaves.add(t)
    }
    const hit = marks.filter(m => leaves.has(m)).map(m => m.slice(0, 18))
    trace('[zh-ui] probe|' + tag + '|leaves=' + leaves.size + '|hit=' + hit.join(' ; '))
  } catch (e) {}
}

function dumpPage(tag) {
  try {
    const txt = (document.body.innerText || '').replace(/\s+/g, ' ').trim()
    trace('[zh-ui] page|' + tag + '|len=' + txt.length + '|' + txt.slice(0, 300))
    const kids = Array.from(document.body.children)
      .map(el => el.tagName + '.' + String(el.className || '').slice(0, 40))
      .join(' / ')
    const cat = document.querySelector('[class*="catalog"]')
    const catText = cat ? (cat.textContent || '').replace(/\s+/g, ' ').trim() : 'none'
    trace('[zh-ui] cattext|' + tag + '|' + catText.slice(0, 400))
    const tabHits = []
    for (const el of document.querySelectorAll('button,[role="tab"],[class*="tab"]')) {
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim()
      if (t && t.length < 30 && /工具集|Connectors|技能|插件/.test(t)) {
        tabHits.push(el.tagName + ':' + t + ':vis=' + (el.offsetParent !== null))
      }
      if (tabHits.length >= 8) break
    }
    trace('[zh-ui] tabs|' + tabHits.join(' | ').slice(0, 300))
    trace(
      '[zh-ui] dom|' + tag +
      '|all=' + document.querySelectorAll('*').length +
      '|shadow=' + (Array.from(document.querySelectorAll('*')).filter(el => el.shadowRoot).length) +
      '|catalog=' + document.querySelectorAll('[class*="catalog"]').length +
      '|kids=' + kids.slice(0, 240)
    )
  } catch (e) {}
}

function runDiag() {
  try {
    trace('[zh-ui] diag start hash=' + (location.hash || '-'))
    setTimeout(() => trace('[zh-ui] diag click 技能与工具=' + diagClick('技能与工具')), 100)
    setTimeout(() => trace('[zh-ui] diag click 工具集=' + diagClick('工具集')), 2400)
    setTimeout(() => {
      trace('[zh-ui] diag toolsets nodes=' + engineStats.nodes + ' misses=' + misses.size)
      probe('toolsets')
      trace('[zh-ui] tabstrip|' + tabStrip())
    }, 4400)
    setTimeout(() => trace('[zh-ui] diag click conn=' + diagClickAny(['Connectors', '连接器', 'Connect'])), 4900)
    setTimeout(() => {
      trace('[zh-ui] diag connectors nodes=' + engineStats.nodes + ' misses=' + misses.size)
      probe('connectors')
    }, 6900)
    setTimeout(() => trace('[zh-ui] diag click 技能=' + diagClick('技能')), 7400)
  } catch (e) {
    trace('[zh-ui] diag err ' + e)
  }
}

const plugin = {
  id: 'zh-ui',
  name: '中文界面',
  description:
    '桌面端英文技能/插件描述就地换成简体中文（词库精确匹配，聊天与代码不动）。状态栏「中」开关。',
  register(ctx) {
    ctxRef = ctx
    ctx.register({
      id: 'zh-ui-chip',
      area: 'statusBar.right',
      order: 140,
      render: () => jsx(Chip, {}),
    })
    ctx.register({
      id: 'zh-ui-toggle',
      area: PALETTE_AREA,
      data: {
        id: 'zh-ui.toggle',
        label: '中文界面：开 / 关',
        keywords: ['zh', 'chinese', 'translate', '中文', '翻译'],
        run: () => toggle(),
      },
    })
    const saved = ctx.storage && ctx.storage.get ? ctx.storage.get('enabled', true) : true
    if (saved !== false) {
      onAtom.set(true)
      startEngine()
      say('[zh-ui] registered dict=' + Object.keys(DICT).length + ' nodes=' + engineStats.nodes)
      if (DIAG) setTimeout(runDiag, 1200)
    }
  },
}

export default plugin
