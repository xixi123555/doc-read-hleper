/**
 * Content Script 宿主（注入页面，隔离世界）
 * 职责：
 *  - 以 Shadow DOM 注入聊天窗 / 划词翻译两个扩展页面 iframe（不污染原生 DOM）
 *  - 窗口交互：拖拽、缩放、收起、全屏、关闭、状态持久化
 *  - 网页上下文提取（供聊天窗通过 storage.session 读取）
 *  - 划词翻译触发与定位
 *  - 响应 popup / 快捷键的打开与快捷指令
 */
import { extractPage } from './extractor'
import { HOST_STYLE } from './host.css'
import {
  AppSettings,
  ChatWindowState,
  PageContext,
  TranslateMode,
  TranslatePayload,
  WindowRect,
} from '../shared/types'
import { getSettings } from '../shared/storage'
import { logger } from '../shared/logger'
import {
  CHAT_IFRAME_URL,
  CTX_KEY_PREFIX,
  HOST_ID,
  PM,
  RT,
  TRANSLATE_IFRAME_URL,
  WINDOW_STATE_KEY,
} from '../shared/msg'

const EXT_ORIGIN = chrome.runtime.getURL('').replace(/\/$/, '')

/* ---------------- 状态 ---------------- */

let settings: AppSettings = {
  globalEnabled: true,
  disabledSites: [],
  translateEnabled: false,
  theme: 'light',
}
let tabId = 0
/** 用于校验 iframe 消息来源（页面无法得知该随机值） */
const nonce =
  Math.random().toString(36).slice(2) + Date.now().toString(36) + Math.random().toString(36).slice(2)

let hostEl: HTMLDivElement | null = null
let shadow: ShadowRoot | null = null
let chatBox: HTMLDivElement | null = null
let chatFrame: HTMLIFrameElement | null = null
let translateBox: HTMLDivElement | null = null
let translateFrame: HTMLIFrameElement | null = null

let chatState: ChatWindowState = 'closed'
let winRect: WindowRect | null = null
let fullscreen = false
let chatLoaded = false
let translateLoaded = false
let ctxCache: { ts: number; ctx: PageContext } | null = null
let lastUrl = location.href
let translatePayload: TranslatePayload | null = null
let translateVisible = false
/** 翻译状态缓存：iframe 尚未加载完成时保留结果，加载后重放 */
let translateState: {
  mode: TranslateMode
  loading: boolean
  ok?: boolean
  data?: any
  error?: string
} | null = null

function clampNum(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}
function siteDisabled(): boolean {
  return settings.disabledSites.includes(location.hostname)
}
function pluginActive(): boolean {
  return settings.globalEnabled && !siteDisabled()
}

/* ---------------- 初始化 ---------------- */

async function init() {
  settings = await getSettings()
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings?.newValue) {
      settings = { ...settings, ...changes.settings.newValue }
      applyState()
    }
  })
  chrome.runtime.onMessage.addListener(onRuntimeMessage)
  document.addEventListener('mouseup', onMouseUp)
  document.addEventListener('mousedown', onDocMouseDown, true)
  document.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('scroll', hideTranslate, true)
  window.addEventListener('resize', onWindowResize)
  window.addEventListener('message', onWindowMessage)
  try {
    const res = await chrome.runtime.sendMessage({ type: RT.GetTabId })
    tabId = res?.tabId || 0
  } catch {
    tabId = 0
  }
  await restoreWindowState()
  applyState()
  startUrlWatch()
}

function onRuntimeMessage(msg: any, _sender: any, sendResponse: (r?: any) => void) {
  switch (msg?.type) {
    case RT.OpenChat:
      openChat()
      sendResponse({ ok: true })
      break
    case RT.ToggleChat:
      if (chatState === 'closed') openChat()
      else setChatState('closed')
      sendResponse({ ok: true })
      break
    case RT.QuickCommand: {
      openChat()
      setTimeout(() => {
        sendToChat({ type: PM.QuickCommand, nonce, command: msg.command })
      }, 500)
      sendResponse({ ok: true })
      break
    }
    case RT.Ping:
      sendResponse({ ok: true, injected: true })
      break
    case RT.GetContext:
      // 供弹窗快捷对话获取当前页面上下文
      try {
        sendResponse({ ok: true, ctx: getCtx() })
      } catch (e) {
        logger.error('host', '响应 GetContext 失败', e)
        sendResponse({ ok: false, error: '页面上下文提取失败' })
      }
      break
    default:
      return false
  }
  return false
}

function applyState() {
  if (!pluginActive()) {
    if (chatState !== 'closed') setChatState('closed')
    hideTranslate()
  }
}

/* ---------------- 宿主 DOM ---------------- */

function ensureHost() {
  if (hostEl) return
  hostEl = document.createElement('div')
  hostEl.id = HOST_ID
  hostEl.style.cssText =
    'all:initial;position:fixed;inset:0;width:0;height:0;z-index:2147483647;pointer-events:none;'
  shadow = hostEl.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = HOST_STYLE
  shadow.appendChild(style)

  chatBox = document.createElement('div')
  chatBox.id = 'chat'
  chatFrame = document.createElement('iframe')
  chatFrame.src = CHAT_IFRAME_URL
  chatFrame.setAttribute('scrolling', 'no')
  chatFrame.setAttribute('tabindex', '-1')
  chatBox.appendChild(chatFrame)
  chatFrame.addEventListener('load', () => {
    chatLoaded = true
    sendChatInit()
  })

  translateBox = document.createElement('div')
  translateBox.id = 'translate'
  translateFrame = document.createElement('iframe')
  translateFrame.src = TRANSLATE_IFRAME_URL
  // 注意：不设 scrolling="no"，内容超高时允许弹窗内部滚动（高度自适应不写死）
  translateBox.appendChild(translateFrame)
  translateFrame.addEventListener('load', () => {
    translateLoaded = true
    // iframe 加载完成：重放当前翻译状态，避免结果丢失
    if (translateVisible && translateState) {
      sendToTranslate({
        type: PM.TranslateInit,
        nonce,
        mode: translateState.mode,
        text: translatePayload?.text || '',
        loading: translateState.loading,
      })
      if (!translateState.loading) {
        sendToTranslate({
          type: PM.TranslateResult,
          nonce,
          ok: translateState.ok,
          data: translateState.data,
          error: translateState.error,
        })
      }
    }
  })

  shadow.appendChild(chatBox)
  shadow.appendChild(translateBox)
  ;(document.documentElement || document.body).appendChild(hostEl)
}

/* ---------------- 聊天窗状态与几何 ---------------- */

function defaultRect(): WindowRect {
  const w = Math.min(380, window.innerWidth - 32)
  const h = Math.min(640, window.innerHeight - 48)
  return { left: Math.max(8, window.innerWidth - w - 16), top: 16, width: w, height: h }
}

function currentRect(): WindowRect {
  const r = chatBox ? chatBox.getBoundingClientRect() : defaultRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

function applyChatRect(rect: WindowRect) {
  if (!chatBox) return
  chatBox.style.left = `${rect.left}px`
  chatBox.style.top = `${rect.top}px`
  chatBox.style.width = `${rect.width}px`
  chatBox.style.height = `${rect.height}px`
}

function setChatState(state: ChatWindowState) {
  ensureHost()
  chatState = state
  if (!chatBox) return
  if (state === 'closed') {
    chatBox.classList.remove('collapsed', 'fullscreen')
    chatBox.style.display = 'none'
  } else if (state === 'collapsed') {
    chatBox.classList.add('collapsed')
    chatBox.classList.remove('fullscreen')
    chatBox.style.display = 'block'
    if (!winRect) winRect = currentRect()
    applyChatRect({ left: winRect.left, top: winRect.top, width: 56, height: 56 })
  } else {
    chatBox.classList.remove('collapsed', 'fullscreen')
    chatBox.style.display = 'block'
    if (!winRect) winRect = defaultRect()
    applyChatRect(winRect)
  }
  void persistWindowState()
  sendChatInit()
}

function openChat() {
  if (!pluginActive()) return
  if (chatState === 'open') return
  if (chatState === 'collapsed') {
    // 收起状态下再次唤起 = 展开
    winRect = null
  }
  setChatState('open')
}

function setFullscreen(on: boolean) {
  fullscreen = on
  if (!chatBox) return
  if (on) {
    if (!winRect) winRect = currentRect()
    chatBox.classList.add('fullscreen')
    applyChatRect({
      left: 8,
      top: 8,
      width: window.innerWidth - 16,
      height: window.innerHeight - 16,
    })
  } else {
    chatBox.classList.remove('fullscreen')
    applyChatRect(winRect || defaultRect())
  }
  void persistWindowState()
  sendChatInit()
}

async function persistWindowState() {
  try {
    const data = await chrome.storage.session.get(WINDOW_STATE_KEY)
    const map: Record<number, ChatWindowState> = data[WINDOW_STATE_KEY] || {}
    map[tabId] = chatState
    await chrome.storage.session.set({ [WINDOW_STATE_KEY]: map })
  } catch {
    /* session 存储不可用时忽略 */
  }
}

async function restoreWindowState() {
  try {
    const data = await chrome.storage.session.get(WINDOW_STATE_KEY)
    const map: Record<number, ChatWindowState> = data[WINDOW_STATE_KEY] || {}
    const st = map[tabId]
    if (st === 'open' || st === 'collapsed') {
      winRect = defaultRect()
      setChatState(st)
    }
  } catch {
    /* ignore */
  }
}

function onWindowResize() {
  if (chatState === 'closed') return
  if (fullscreen) {
    applyChatRect({
      left: 8,
      top: 8,
      width: window.innerWidth - 16,
      height: window.innerHeight - 16,
    })
  } else if (chatBox) {
    const r = chatBox.getBoundingClientRect()
    applyChatRect({
      left: clampNum(r.left, 0, Math.max(0, window.innerWidth - r.width)),
      top: clampNum(r.top, 0, Math.max(0, window.innerHeight - r.height)),
      width: Math.min(r.width, window.innerWidth - 16),
      height: Math.min(r.height, window.innerHeight - 16),
    })
  }
}

/* ---------------- 拖拽 / 缩放 ---------------- */

function startDrag() {
  if (!chatBox || !chatFrame) return
  const rect = chatBox.getBoundingClientRect()
  let dx = 0
  let dy = 0
  let first = true
  chatFrame.style.pointerEvents = 'none'
  const onMove = (e: MouseEvent) => {
    if (first) {
      dx = e.clientX - rect.left
      dy = e.clientY - rect.top
      first = false
    }
    chatBox!.style.left = `${clampNum(e.clientX - dx, 0, window.innerWidth - rect.width)}px`
    chatBox!.style.top = `${clampNum(e.clientY - dy, 0, window.innerHeight - rect.height)}px`
  }
  const onUp = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    if (chatFrame) chatFrame.style.pointerEvents = ''
    winRect = currentRect()
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

function startResize() {
  if (!chatBox || !chatFrame) return
  const rect = chatBox.getBoundingClientRect()
  let dx = 0
  let dy = 0
  let first = true
  chatFrame.style.pointerEvents = 'none'
  const onMove = (e: MouseEvent) => {
    if (first) {
      dx = e.clientX - rect.right
      dy = e.clientY - rect.bottom
      first = false
    }
    const width = clampNum(e.clientX - dx - rect.left, 320, window.innerWidth - 16)
    const height = clampNum(e.clientY - dy - rect.top, 400, window.innerHeight - 16)
    chatBox!.style.width = `${width}px`
    chatBox!.style.height = `${height}px`
  }
  const onUp = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    if (chatFrame) chatFrame.style.pointerEvents = ''
    winRect = currentRect()
    sendChatInit()
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

/* ---------------- iframe 消息 ---------------- */

function sendToChat(msg: any) {
  // 未加载完成前不要 postMessage：about:blank 初始文档继承页面 origin，目标不匹配会抛异常
  if (!chatLoaded) return
  chatFrame?.contentWindow?.postMessage(msg, EXT_ORIGIN)
}
function sendToTranslate(msg: any) {
  if (!translateLoaded) return
  translateFrame?.contentWindow?.postMessage(msg, EXT_ORIGIN)
}

function sendChatInit() {
  if (!chatFrame?.contentWindow) return
  sendToChat({
    type: PM.Init,
    nonce,
    tabId,
    domain: location.hostname,
    pageTitle: document.title,
    url: location.href,
    state: chatState,
    rect: currentRect(),
    fullscreen,
    pluginActive: pluginActive(),
  })
}

function onWindowMessage(e: MessageEvent) {
  if (e.origin !== EXT_ORIGIN) {
    logger.debug('host', '忽略非扩展来源消息', { origin: e.origin })
    return
  }
  const msg = e.data || {}
  if (msg.nonce !== nonce) {
    logger.warn('host', '收到 nonce 不匹配的消息', { type: msg.type })
    return
  }
  logger.debug('host', '收到 iframe 消息', { type: msg.type })
  switch (msg.type) {
    case PM.GetContext:
      void handleGetContext()
      break
    case PM.SetSize: {
      if (chatState !== 'open' || fullscreen) break
      if (!winRect) winRect = currentRect()
      winRect.width = clampNum(Number(msg.width) || 380, 320, window.innerWidth - 16)
      winRect.height = clampNum(Number(msg.height) || 640, 360, window.innerHeight - 16)
      applyChatRect(winRect)
      break
    }
    case PM.DragStart:
      startDrag()
      break
    case PM.ResizeStart:
      startResize()
      break
    case PM.Collapse:
      setChatState('collapsed')
      break
    case PM.Expand:
      openChat()
      break
    case PM.Fullscreen:
      setFullscreen(!!msg.fullscreen)
      break
    case PM.Close:
      setChatState('closed')
      break
    case PM.TranslateRetry:
      if (translatePayload) void doTranslate(translatePayload)
      break
    case PM.SetHeight: {
      if (!translateBox) break
      // 不写死展示高度：完整内容自适应（最高不超过可视区，超出部分由弹窗内部滚动）
      const h = clampNum(Number(msg.height) || 200, 120, window.innerHeight - 24)
      translateBox.style.height = `${h}px`
      break
    }
    case PM.TranslateClose:
      hideTranslate()
      break
    default:
      break
  }
}

async function handleGetContext() {
  let ctx: PageContext | null = null
  try {
    ctx = getCtx()
  } catch (e) {
    logger.error('host', '页面上下文提取抛出异常', { url: location.href, err: e })
  }
  if (!ctx) {
    logger.error('host', '页面上下文提取结果为空', { url: location.href })
  } else {
    logger.info('host', '页面上下文提取成功', {
      title: ctx.title,
      textLen: ctx.text.length,
      wordCount: ctx.wordCount,
      outline: ctx.outline.length,
      codeBlocks: ctx.codeBlocks.length,
      truncated: ctx.truncated,
    })
  }
  // 写入 storage.session（保留为兜底，供页面直接读取）
  try {
    await chrome.storage.session.set({
      [CTX_KEY_PREFIX + nonce]: { ts: Date.now(), ctx },
    })
  } catch (e) {
    logger.warn('host', 'storage.session 写入失败（改用直接消息投递）', e)
  }
  // 上下文随消息直接投递给对话窗（不依赖跨上下文存储）
  sendToChat({ type: PM.ContextReady, nonce, ctx })
}

function getCtx(): PageContext {
  if (ctxCache && Date.now() - ctxCache.ts < 5000) {
    logger.debug('host', '页面上下文命中缓存')
    return ctxCache.ctx
  }
  const start = Date.now()
  const ctx = extractPage()
  ctxCache = { ts: Date.now(), ctx }
  logger.debug('host', `页面上下文提取耗时 ${Date.now() - start}ms`, {
    title: ctx.title,
    textLen: ctx.text.length,
  })
  return ctx
}

/* ---------------- 划词翻译 ---------------- */

function isEnglishSelection(text: string): boolean {
  if (!/[A-Za-z]{2,}/.test(text)) return false
  // 含中文等非英文内容不触发（PRD：仅识别英文）
  if (/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(text)) return false
  // 纯数字/符号不触发
  if (/^[\d\s\W_]+$/.test(text)) return false
  return true
}

function getMode(text: string): TranslateMode {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  if (words === 1 && /^[A-Za-z][A-Za-z'-]*$/.test(text.trim())) return 'word'
  if (words <= 12) return 'phrase'
  return 'long'
}

function getContainingParagraph(range: Range): string {
  let node: Node | null = range.startContainer
  let el: Element | null =
    node?.nodeType === Node.ELEMENT_NODE ? (node as Element) : node?.parentElement || null
  while (el && !/^(P|LI|H1|H2|H3|H4|H5|H6|PRE|BLOCKQUOTE|ARTICLE|SECTION|TD|DIV)$/i.test(el.tagName)) {
    el = el.parentElement
  }
  if (!el) el = (range.startContainer as Element)?.parentElement || document.body
  return (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 600)
}

function onMouseUp(e: MouseEvent) {
  if (!settings.globalEnabled || !settings.translateEnabled) return
  if (siteDisabled()) return
  // 点击我们的宿主元素（shadow DOM 事件会重定向到 hostEl）
  if (hostEl && (e.target === hostEl || hostEl.contains(e.target as Node))) return
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed) {
    hideTranslate()
    return
  }
  const text = sel.toString().trim()
  if (!isEnglishSelection(text)) {
    hideTranslate()
    return
  }
  const range = sel.getRangeAt(0)
  const rect = range.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) {
    hideTranslate()
    return
  }
  const mode = getMode(text)
  const snippet = getContainingParagraph(range)
  translatePayload = { text, mode, snippet, pageTitle: document.title, pageUrl: location.href }
  showTranslate(rect, mode)
  void doTranslate(translatePayload)
}

function showTranslate(rect: DOMRect, mode: TranslateMode) {
  ensureHost()
  if (!translateBox || !translateFrame) return
  const W = 340
  const MARGIN = 10
  let left = rect.left
  let top = rect.bottom + 8
  if (left + W > window.innerWidth - MARGIN) left = Math.max(MARGIN, window.innerWidth - W - MARGIN)
  // 下方放不下则放上方；高度按内容自适应（不写死）
  const estH = Math.min(480, window.innerHeight - 24)
  if (top + estH > window.innerHeight - MARGIN && rect.top - estH > MARGIN) {
    top = rect.top - estH - 8
  }
  translateBox.style.display = 'block'
  translateBox.style.left = `${left}px`
  translateBox.style.top = `${top}px`
  translateBox.style.width = `${W}px`
  translateBox.style.height = 'auto'
  translateVisible = true
  translateState = { mode, loading: true }
  sendToTranslate({
    type: PM.TranslateInit,
    nonce,
    mode,
    text: translatePayload?.text || '',
    loading: true,
  })
}

async function doTranslate(payload: TranslatePayload) {
  try {
    const res = await chrome.runtime.sendMessage({ type: RT.Translate, payload })
    if (translateState) {
      translateState.loading = false
      translateState.ok = !!res?.ok
      translateState.data = res?.data
      translateState.error = res?.error
    }
    if (!translateVisible) return
    if (res?.ok) {
      sendToTranslate({ type: PM.TranslateResult, nonce, ok: true, data: res.data })
    } else {
      sendToTranslate({ type: PM.TranslateResult, nonce, ok: false, error: res?.error || '翻译失败' })
    }
  } catch (err: any) {
    if (translateState) {
      translateState.loading = false
      translateState.ok = false
      translateState.error = err?.message || '翻译请求失败'
    }
    sendToTranslate({
      type: PM.TranslateResult,
      nonce,
      ok: false,
      error: err?.message || '翻译请求失败',
    })
  }
}

function hideTranslate() {
  if (!translateVisible) return
  translateVisible = false
  if (translateBox) translateBox.style.display = 'none'
}

function onDocMouseDown() {
  hideTranslate()
}
function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') hideTranslate()
}

/* ---------------- SPA 页面变化监听 ---------------- */

function startUrlWatch() {
  const check = () => {
    if (chatState === 'closed') {
      lastUrl = location.href
      return
    }
    if (location.href !== lastUrl) {
      lastUrl = location.href
      ctxCache = null
      sendChatInit()
      sendToChat({
        type: PM.PageChanged,
        nonce,
        domain: location.hostname,
        pageTitle: document.title,
        url: location.href,
      })
    }
  }
  window.addEventListener('popstate', check)
  window.addEventListener('hashchange', check)
  setInterval(check, 2000)
}

/* ---------------- 启动 ---------------- */

// 幂等保护：同一页面可能被声明式注入 + 按需注入两次（executeScript 兜底），避免重复注册
const world = self as unknown as { __dshAiReaderHostInjected?: boolean }
if (!world.__dshAiReaderHostInjected) {
  world.__dshAiReaderHostInjected = true
  void init()
}
