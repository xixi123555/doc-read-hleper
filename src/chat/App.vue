<script setup lang="ts">
/**
 * 右侧悬浮对话窗（iframe 内独立渲染，不污染原生网页 DOM）
 * 功能：流式对话 / 快捷指令 / 历史记录 / 总结导出 / 深色模式 / 拖拽缩放收起全屏
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  NButton,
  NConfigProvider,
  NDrawer,
  NDrawerContent,
  NEmpty,
  NGlobalStyle,
  NModal,
  NTag,
  NRadioGroup,
  NRadioButton,
  darkTheme,
} from 'naive-ui'
import type { GlobalTheme } from 'naive-ui'
import { ChatMessage, ChatSession, PageContext, ThemeMode } from '../shared/types'
import {
  clearDomainSessions,
  deleteSession,
  getActiveConfig,
  getSessionsByDomain,
  getSettings,
  saveSession,
  setSettings,
  uid,
} from '../shared/storage'
import { CTX_KEY_PREFIX, PM } from '../shared/msg'
import { QUICK_COMMANDS, quickCommandById } from '../shared/prompts'
import { logger } from '../shared/logger'
import { darkOverrides, lightOverrides, resolveTheme } from '../shared/theme'
import { buildExportDoc, buildFilename, EXPORT_TARGETS, ExportMode } from './exporters'
import MessageBubble from './MessageBubble.vue'

/* ---------------- 基础状态 ---------------- */

const nonce = ref('')
const initialized = ref(false)
const isCollapsed = ref(false)
const fullscreenLocal = ref(false)
const pluginActive = ref(true)
const domain = ref('')
const pageTitle = ref('')
const pageUrl = ref('')
const tabId = ref(0)

const messages = ref<ChatMessage[]>([])
const pageContext = ref<PageContext | null>(null)
const streaming = ref<{ id: number; buffer: string } | null>(null)
const inputText = ref('')
const modelName = ref('')
const themeMode = ref<ThemeMode>('light')
const naiveTheme = ref<GlobalTheme | null>(null)
const themeOverrides = computed(() => (naiveTheme.value === darkTheme ? darkOverrides : lightOverrides))

const listRef = ref<HTMLElement | null>(null)

const toast = ref('')
let toastTimer: number | undefined

let reqSeq = ref(0)
let sessionId = ''
let sessionDomain = ''
let sessionCreatedAt = Date.now()
let ctxResolver: (() => void) | null = null
let saveTimer: number | undefined

/* ---------------- 后台长连接端口（断线自动重连） ---------------- */

let port: chrome.runtime.Port | null = null

function ensurePort(): chrome.runtime.Port {
  if (port) return port
  port = chrome.runtime.connect({ name: 'chat-port' })
  port.onMessage.addListener(onPortMessage)
  port.onDisconnect.addListener(() => {
    port = null
  })
  return port
}

/** 发送消息；端口失效时重连后重试一次，仍失败返回 false */
async function postToBackground(msg: any): Promise<boolean> {
  try {
    ensurePort().postMessage(msg)
    return true
  } catch {
    /* 端口可能已断开，重连重试 */
  }
  await new Promise((r) => setTimeout(r, 300))
  try {
    ensurePort().postMessage(msg)
    return true
  } catch {
    return false
  }
}

/* ---------------- 历史记录 ---------------- */

const historyOpen = ref(false)
const historyLoading = ref(false)
const sessions = ref<ChatSession[]>([])

/* ---------------- 总结导出 ---------------- */

const exportOpen = ref(false)
const exportBusy = ref(false)
const exportMsg = ref('')
const exportMode = ref<ExportMode>('full')
const exportTarget = ref('download')
const exportSummary = ref('')
const summarizeState = ref<{ id: number; buffer: string } | null>(null)

/* ---------------- 生命周期 ---------------- */

onMounted(() => {
  window.addEventListener('message', onWindowMessage)
  ensurePort()
  void refreshModel()
  void refreshTheme()
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings?.newValue) {
      const s = changes.settings.newValue
      if (s.theme) void applyThemeMode(s.theme)
    }
    if (area === 'local' && (changes.settings?.newValue || changes.modelConfigs?.newValue || changes.activeConfigId?.newValue)) {
      void refreshModel()
    }
  })
})

onBeforeUnmount(() => {
  window.removeEventListener('message', onWindowMessage)
  window.clearTimeout(toastTimer)
  window.clearTimeout(saveTimer)
  window.clearTimeout(chunkTimer)
  try {
    port?.disconnect()
  } catch {
    /* ignore */
  }
})

/* ---------------- 消息收发 ---------------- */

function postToHost(msg: any) {
  window.parent.postMessage(msg, '*')
}

function onWindowMessage(e: MessageEvent) {
  const msg = e.data || {}
  // Init 消息用于建立信任（携带宿主 nonce），必须在 nonce 校验之前处理
  if (msg.type === PM.Init) {
    onInit(msg)
    return
  }
  if (msg.nonce && msg.nonce !== nonce.value) return
  switch (msg.type) {
    case PM.ContextReady:
      if (msg.ctx) {
        pageContext.value = msg.ctx
        logger.info('chat', '已收到页面上下文（消息直投）', {
          title: msg.ctx.title,
          textLen: msg.ctx.text.length,
          wordCount: msg.ctx.wordCount,
        })
      } else {
        logger.warn('chat', 'ContextReady 未携带上下文，回退读取 storage.session')
        void readCtx().catch(() => undefined)
      }
      if (ctxResolver) {
        const r = ctxResolver
        ctxResolver = null
        r()
      }
      break
    case PM.QuickCommand:
      runQuickCommand(msg.command)
      break
    case PM.PageChanged:
      onPageChanged(msg)
      break
    default:
      break
  }
}

function onInit(msg: any) {
  nonce.value = msg.nonce
  tabId.value = msg.tabId
  pluginActive.value = !!msg.pluginActive
  isCollapsed.value = msg.state === 'collapsed'
  fullscreenLocal.value = !!msg.fullscreen
  logger.info('chat', '已收到宿主初始化', {
    domain: msg.domain,
    pageTitle: msg.pageTitle,
    state: msg.state,
    nonce: (msg.nonce || '').slice(0, 6),
  })
  if (msg.domain !== sessionDomain || !sessionId) {
    startNewSession()
  }
  domain.value = msg.domain
  pageTitle.value = msg.pageTitle
  pageUrl.value = msg.url
  initialized.value = true
  // 主动刷新一次页面上下文
  void ensureContext().then(() => undefined)
}

function onPageChanged(msg: any) {
  const domainChanged = msg.domain !== sessionDomain
  domain.value = msg.domain
  pageTitle.value = msg.pageTitle
  pageUrl.value = msg.url
  if (domainChanged) startNewSession()
  void ensureContext().then(() => undefined)
}

function startNewSession() {
  sessionId = uid()
  sessionDomain = domain.value || location.hostname
  sessionCreatedAt = Date.now()
  messages.value = []
}

/** 流式渲染节流：合并 chunk，40ms 批量刷新一次（约 25fps），避免每 token 全量重渲染 */
let chunkTimer: number | undefined
let pendingDelta = ''

function flushPendingDelta() {
  if (chunkTimer) {
    window.clearTimeout(chunkTimer)
    chunkTimer = undefined
  }
  if (pendingDelta && streaming.value) {
    streaming.value.buffer += pendingDelta
    pendingDelta = ''
    const last = messages.value[messages.value.length - 1]
    if (last) last.content = streaming.value.buffer
  }
}

function scheduleChunkFlush() {
  if (chunkTimer) return
  chunkTimer = window.setTimeout(() => {
    chunkTimer = undefined
    if (!streaming.value) {
      pendingDelta = ''
      return
    }
    streaming.value.buffer += pendingDelta
    pendingDelta = ''
    const last = messages.value[messages.value.length - 1]
    if (last) last.content = streaming.value.buffer
    scrollBottom()
  }, 40)
}

function onPortMessage(msg: any) {
  if (msg.type === 'llm-chunk' && streaming.value?.id === msg.id) {
    pendingDelta += msg.delta || ''
    scheduleChunkFlush()
  } else if (msg.type === 'llm-done' && streaming.value?.id === msg.id) {
    flushPendingDelta()
    const last = messages.value[messages.value.length - 1]
    if (last) {
      if (msg.content) last.content = msg.content
      else if (!last.content) {
        last.content =
          '> ⚠️ 模型未返回内容：接口可能不支持流式输出或模型名/配置有误，请在插件面板「校验接口」后重试'
      }
    }
    streaming.value = null
    saveSoon()
  } else if (msg.type === 'llm-error' && streaming.value?.id === msg.id) {
    flushPendingDelta()
    const last = messages.value[messages.value.length - 1]
    if (last) {
      last.content =
        last.content + (last.content ? '\n\n' : '') + `> ⚠️ ${msg.message || '请求失败'}`
    }
    streaming.value = null
    saveSoon()
  } else if (msg.type === 'summarize-chunk' && summarizeState.value?.id === msg.id) {
    summarizeState.value.buffer += msg.delta || ''
    exportSummary.value = summarizeState.value.buffer
  } else if (msg.type === 'summarize-done' && summarizeState.value?.id === msg.id) {
    exportSummary.value = msg.content || ''
    summarizeState.value = null
    void finishExport()
  } else if (msg.type === 'summarize-error' && summarizeState.value?.id === msg.id) {
    summarizeState.value = null
    exportBusy.value = false
    exportMsg.value = msg.message || 'AI 总结失败'
  }
}

/* ---------------- 页面上下文 ---------------- */

function ensureContext(): Promise<PageContext | null> {
  return new Promise((resolve) => {
    if (!nonce.value) {
      logger.warn('chat', '尚未收到宿主初始化（nonce 为空），跳过上下文请求')
      resolve(pageContext.value || null)
      return
    }
    ctxResolver = () => {
      void readCtx().then(resolve)
    }
    postToHost({ type: PM.GetContext, nonce: nonce.value })
    logger.debug('chat', '已请求刷新页面上下文', { nonce: nonce.value.slice(0, 6) })
    window.setTimeout(() => {
      if (ctxResolver) {
        ctxResolver = null
        logger.warn('chat', '等待上下文超时（3s），使用已有上下文或空')
        void readCtx().then(resolve)
      }
    }, 3000)
  })
}

async function readCtx(): Promise<PageContext | null> {
  try {
    const data = await chrome.storage.session.get(CTX_KEY_PREFIX + nonce.value)
    const v = data[CTX_KEY_PREFIX + nonce.value]
    if (v?.ctx) {
      pageContext.value = v.ctx
      logger.debug('chat', '从 storage.session 读取到上下文', {
        title: v.ctx.title,
        textLen: v.ctx.text.length,
      })
      return v.ctx
    }
    logger.warn('chat', 'storage.session 未读到上下文', { key: CTX_KEY_PREFIX + nonce.value })
  } catch (e) {
    logger.warn('chat', 'storage.session 读取异常', e)
  }
  return pageContext.value || null
}

/* ---------------- 发送 / 停止 ---------------- */

async function send(text?: string) {
  const content = (text ?? inputText.value).trim()
  if (!content || streaming.value) return
  inputText.value = ''
  const userMsg: ChatMessage = { role: 'user', content, ts: Date.now() }
  messages.value.push(userMsg)
  const aiMsg: ChatMessage = { role: 'assistant', content: '', ts: Date.now() }
  messages.value.push(aiMsg)
  const id = ++reqSeq.value
  streaming.value = { id, buffer: '' }
  scrollBottom()
  const ctx = await ensureContext()
  if (!ctx) {
    logger.warn('chat', '发送消息时无页面上下文', { question: content.slice(0, 30) })
  } else {
    logger.debug('chat', '发送消息携带页面上下文', {
      title: ctx.title,
      textLen: ctx.text.length,
    })
  }
  // 只带最近 12 条历史，避免长对话请求体无界增长
  const history = messages.value
    .slice(0, -2)
    .map((m) => ({ role: m.role, content: m.content }))
    .slice(-12)
  const ok = await postToBackground({
    type: 'llm-chat',
    payload: {
      id,
      messages: [...history, { role: 'user', content }],
      pageContext: ctx,
    },
  })
  if (!ok) {
    const last = messages.value[messages.value.length - 1]
    if (last) last.content = '> ⚠️ 与后台连接失败，请关闭对话窗后重新打开再试'
    streaming.value = null
    return
  }
  saveSoon()
}

function stop() {
  if (!streaming.value) return
  flushPendingDelta()
  void postToBackground({ type: 'abort', id: streaming.value.id })
  const last = messages.value[messages.value.length - 1]
  if (last) last.content += '\n\n*（已停止生成）*'
  streaming.value = null
  saveSoon()
}

function onInputKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    void send()
  }
}

function runQuickCommand(id: string) {
  const def = quickCommandById(id)
  if (!def) return
  void send(def.prompt)
}

function clearConversation() {
  if (!messages.value.length) return
  messages.value = []
  saveSoon()
  showToast('已清空当前对话')
}

/* ---------------- 历史记录 ---------------- */

async function openHistory() {
  historyOpen.value = true
  historyLoading.value = true
  try {
    sessions.value = await getSessionsByDomain(domain.value)
  } finally {
    historyLoading.value = false
  }
}

function useSession(s: ChatSession) {
  sessionId = s.id
  sessionDomain = s.domain
  sessionCreatedAt = s.createdAt
  messages.value = s.messages.map((m) => ({ ...m }))
  historyOpen.value = false
}

function removeSession(s: ChatSession) {
  void deleteSession(s.domain, s.id).then(() => {
    sessions.value = sessions.value.filter((x) => x.id !== s.id)
  })
}

function clearHistory() {
  void clearDomainSessions(domain.value).then(() => {
    sessions.value = []
  })
}

/* ---------------- 会话持久化 ---------------- */

function saveSoon() {
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => void persistSession(), 800)
}

async function persistSession() {
  if (!sessionId || !domain.value) return
  const sess: ChatSession = {
    id: sessionId,
    title: pageTitle.value || domain.value,
    url: pageUrl.value,
    domain: domain.value,
    createdAt: sessionCreatedAt,
    updatedAt: Date.now(),
    messages: messages.value.map((m) => ({ ...m })),
  }
  await saveSession(sess)
}

/* ---------------- 总结导出 ---------------- */

function openExport() {
  exportOpen.value = true
  exportMsg.value = ''
  exportSummary.value = ''
}

async function doExport() {
  exportBusy.value = true
  exportMsg.value = ''
  const opts = {
    title: pageTitle.value,
    url: pageUrl.value,
    domain: domain.value,
    messages: messages.value,
  }
  if (exportMode.value === 'full') {
    const doc = buildExportDoc({ mode: 'full', ...opts })
    const a = document.createElement('a')
    const blob = new Blob([doc], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    a.href = url
    a.download = buildFilename(pageTitle.value)
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    exportMsg.value = '已下载到本地'
    exportBusy.value = false
  } else {
    if (!messages.value.length) {
      exportMsg.value = '当前没有可总结的对话内容'
      exportBusy.value = false
      return
    }
    exportSummary.value = ''
    const id = ++reqSeq.value
    summarizeState.value = { id, buffer: '' }
    const ok = await postToBackground({
      type: 'summarize',
      payload: {
        id,
        messages: messages.value.map((m) => ({ role: m.role, content: m.content })),
        pageMeta: { title: pageTitle.value, url: pageUrl.value, domain: domain.value },
      },
    })
    if (!ok) {
      summarizeState.value = null
      exportBusy.value = false
      exportMsg.value = '与后台连接失败，请重试'
    }
  }
}

async function finishExport() {
  const opts = {
    title: pageTitle.value,
    url: pageUrl.value,
    domain: domain.value,
    messages: messages.value,
  }
  const doc = buildExportDoc({ mode: 'ai', aiSummary: exportSummary.value, ...opts })
  const a = document.createElement('a')
  const blob = new Blob([doc], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  a.href = url
  a.download = buildFilename(pageTitle.value)
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  exportMsg.value = '已生成 AI 精简总结并下载'
  exportBusy.value = false
}

async function copyExportDoc() {
  const opts = {
    title: pageTitle.value,
    url: pageUrl.value,
    domain: domain.value,
    messages: messages.value,
    aiSummary: exportSummary.value || undefined,
  }
  const doc = buildExportDoc({ mode: exportMode.value, ...opts })
  try {
    await navigator.clipboard.writeText(doc)
    exportMsg.value = '文档已复制到剪贴板'
  } catch {
    exportMsg.value = '复制失败'
  }
}

/* ---------------- 主题 / 模型 ---------------- */

async function refreshTheme() {
  const s = await getSettings()
  themeMode.value = s.theme
  applyThemeMode(s.theme)
}

function applyThemeMode(mode: ThemeMode) {
  themeMode.value = mode
  const resolved = resolveTheme(mode)
  naiveTheme.value = resolved === 'dark' ? darkTheme : null
  document.documentElement.setAttribute('data-theme', resolved)
}

async function cycleTheme() {
  const order: ThemeMode[] = ['light', 'dark', 'auto']
  const next = order[(order.indexOf(themeMode.value) + 1) % 3]
  await setSettings({ theme: next })
  applyThemeMode(next)
}

async function refreshModel() {
  const cfg = await getActiveConfig()
  modelName.value = cfg ? `${cfg.name} · ${cfg.model}` : '未配置模型'
}

/* ---------------- 窗口控制 ---------------- */

/**
 * 浮窗模式拖拽交互：双击不松开才能拖动（符合大众交互）。
 * 单击顶栏只记录按下位置/时间，不触发拖动；
 * 仅在 500ms 内、6px 容差内的第二次按下（双击的第二下按住不放）才发送 DragStart。
 */
const DRAG_DBLCLICK_MS = 500
const DRAG_DBLCLICK_DIST = 6
let lastHeadPress = { x: -1, y: -1, t: 0 }

function onHeadDragDown(e: MouseEvent) {
  if (isCollapsed.value || fullscreenLocal.value) return
  if ((e.target as HTMLElement).closest('button')) return
  const now = Date.now()
  const prev = lastHeadPress
  lastHeadPress = { x: e.clientX, y: e.clientY, t: now }
  const isSecondPressOfDoubleClick =
    now - prev.t <= DRAG_DBLCLICK_MS &&
    Math.abs(e.clientX - prev.x) <= DRAG_DBLCLICK_DIST &&
    Math.abs(e.clientY - prev.y) <= DRAG_DBLCLICK_DIST
  if (!isSecondPressOfDoubleClick) return
  postToHost({ type: PM.DragStart, nonce: nonce.value })
}

function onResizeDown(e: MouseEvent) {
  e.preventDefault()
  postToHost({ type: PM.ResizeStart, nonce: nonce.value })
}

function collapse() {
  postToHost({ type: PM.Collapse, nonce: nonce.value })
}
function expand() {
  postToHost({ type: PM.Expand, nonce: nonce.value })
}
function toggleFullscreen() {
  fullscreenLocal.value = !fullscreenLocal.value
  postToHost({ type: PM.Fullscreen, nonce: nonce.value, fullscreen: fullscreenLocal.value })
}
function closeWindow() {
  postToHost({ type: PM.Close, nonce: nonce.value })
}

/* ---------------- 工具 ---------------- */

function scrollBottom() {
  void nextTick(() => {
    const el = listRef.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

function showToast(text: string) {
  toast.value = text
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = ''), 2000)
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function themeIcon(): string {
  return themeMode.value === 'dark' ? '☀️' : themeMode.value === 'auto' ? '🖥️' : '🌙'
}

/** 页面上下文状态提示 */
const ctxStatus = computed(() => {
  const ctx = pageContext.value
  if (!ctx) {
    return {
      text: '📄 页面上下文：未加载（点击重试）',
      title: '页面上下文获取失败，点击重试',
      cls: 'text-danger bg-[rgba(242,113,92,0.12)] hover:text-danger',
    }
  }
  return {
    text: `📄 页面上下文已加载（${ctx.wordCount} 词）`,
    title: '已基于当前页面内容回答，点击可刷新',
    cls: 'text-success bg-[rgba(52,199,123,0.12)] hover:text-success',
  }
})

/* ---------------- 消息列表上限（防长对话内存/渲染无界增长） ---------------- */

const MAX_RENDER_MESSAGES = 200
const showAllMessages = ref(false)

const displayMessages = computed(() => {
  if (showAllMessages.value || messages.value.length <= MAX_RENDER_MESSAGES) return messages.value
  return messages.value.slice(-MAX_RENDER_MESSAGES)
})
const foldedCount = computed(() =>
  Math.max(0, messages.value.length - displayMessages.value.length),
)

function expandMessages() {
  showAllMessages.value = true
}
</script>

<template>
  <n-config-provider :theme="naiveTheme" :theme-overrides="themeOverrides">
    <n-global-style />
    <div class="h-screen w-full flex flex-col bg-bg relative overflow-hidden">
      <!-- 收起态：悬浮圆钮 -->
      <button
        v-if="isCollapsed"
        class="absolute inset-0 w-full h-full rounded-full bg-gradient-to-br from-primary to-[#3b5bdb] shadow-lg cursor-pointer border-none flex items-center justify-center hover:brightness-110 transition-all"
        title="展开对话窗"
        @click="expand"
      >
        <span class="text-white font-bold text-[16px] tracking-wide select-none">AI</span>
      </button>

      <template v-else>
        <!-- 顶栏（拖拽区） -->
        <header
          class="flex items-center justify-between gap-2 px-2.5 py-2 cursor-grab select-none border-b border-border bg-card shrink-0"
          @mousedown="onHeadDragDown"
        >
          <div class="min-w-0 flex-1">
            <div class="text-[13px] font-semibold truncate" :title="pageTitle">
              {{ pageTitle || 'AI 网页阅读助手' }}
            </div>
            <div class="flex items-center gap-1.5 mt-0.5">
              <n-tag size="tiny" :bordered="false" type="info" class="max-w-[140px] overflow-hidden">
                {{ modelName }}
              </n-tag>
              <span class="text-[10px] text-text-3 truncate">{{ domain }}</span>
            </div>
          </div>
          <div class="flex items-center gap-0.5 shrink-0">
            <button class="icon-btn" title="历史记录" @click="openHistory">🕘</button>
            <button class="icon-btn" title="总结导出" @click="openExport">📤</button>
            <button class="icon-btn" :title="themeIcon()" @click="cycleTheme">{{ themeIcon() }}</button>
            <button class="icon-btn" title="全屏" @click="toggleFullscreen">⛶</button>
            <button class="icon-btn" title="收起" @click="collapse">—</button>
            <button class="icon-btn" title="关闭" @click="closeWindow">✕</button>
          </div>
        </header>

        <!-- 快捷指令栏 -->
        <div class="flex gap-1.5 px-2.5 py-1.5 overflow-x-auto border-b border-border bg-bg shrink-0">
          <button
            v-for="c in QUICK_COMMANDS"
            :key="c.id"
            class="chip shrink-0"
            :disabled="!!streaming"
            @click="runQuickCommand(c.id)"
          >
            <span>{{ c.icon }}</span>{{ c.label }}
          </button>
        </div>

        <!-- 消息列表 -->
        <div ref="listRef" class="flex-1 overflow-y-auto px-2.5 pt-3 pb-1.5">
          <div v-if="!messages.length && !streaming" class="text-center text-text-2 pt-10 text-[12.5px]">
            <div class="text-[34px] mb-2">💬</div>
            <p class="my-1">我是网页阅读助手，已解析当前页面内容。</p>
            <p class="text-[11px] text-text-3">试试上方快捷指令，或直接提问：</p>
            <div class="flex justify-center gap-2 mt-2.5">
              <button class="chip" @click="runQuickCommand('summarize')">📝 总结全文</button>
              <button class="chip" @click="runQuickCommand('explain')">🧠 解读知识点</button>
            </div>
          </div>
          <div
            v-if="foldedCount > 0"
            class="text-center py-2 mb-2"
          >
            <button
              class="text-[11px] text-text-3 border border-dashed border-border-strong rounded-full px-3 py-1 hover:text-primary hover:border-primary transition-colors cursor-pointer"
              @click="expandMessages"
            >
              🔺 更早的 {{ foldedCount }} 条消息已折叠 · 点击展开
            </button>
          </div>
          <MessageBubble
            v-for="(m, i) in displayMessages"
            :key="i"
            :msg="m"
            :streaming="!!streaming && m.role === 'assistant' && i === displayMessages.length - 1"
          />
        </div>

        <!-- 输入区 -->
        <footer class="border-t border-border bg-card px-2.5 pt-1.5 pb-2 relative shrink-0">
          <div class="flex items-center justify-between mb-1.5">
            <button
              class="text-[10px] rounded-full px-2 py-0.5 cursor-pointer border-none transition-colors"
              :class="ctxStatus.cls"
              :title="ctxStatus.title"
              @click="ensureContext().then(() => showToast('页面上下文已刷新'))"
            >
              {{ ctxStatus.text }}
            </button>
            <button class="ghost-btn" title="清空对话" @click="clearConversation">清空</button>
          </div>
          <div class="flex items-end gap-1.5">
            <textarea
              v-model="inputText"
              rows="2"
              placeholder="问任何关于当前网页的问题，Enter 发送，Shift+Enter 换行…"
              class="flex-1 resize-none rounded-xl border border-border bg-bg text-text text-[12.5px] leading-relaxed px-2.5 py-1.5 outline-none focus:border-primary focus:ring-2 focus:ring-primary-soft max-h-[120px]"
              @keydown="onInputKeydown"
            ></textarea>
            <button v-if="streaming" class="send-btn bg-danger hover:bg-danger" title="停止生成" @click="stop">■</button>
            <button v-else class="send-btn" title="发送" @click="send()">➤</button>
          </div>
          <div class="absolute right-0 bottom-0 w-4 h-4 cursor-nwse-resize" title="拖拽调整大小" @mousedown="onResizeDown"></div>
        </footer>
      </template>

      <!-- 历史记录抽屉 -->
      <n-drawer v-model:show="historyOpen" placement="right" :width="280">
        <n-drawer-content title="历史对话（按域名分类）" closable>
          <div class="flex justify-between mb-2.5">
            <n-button size="tiny" @click="startNewSession">新建会话</n-button>
            <n-button size="tiny" quaternary @click="clearHistory">清空记录</n-button>
          </div>
          <div v-if="!sessions.length && !historyLoading" class="pt-10">
            <n-empty description="暂无历史记录" size="small" />
          </div>
          <div v-else class="flex flex-col gap-2">
            <div v-for="s in sessions" :key="s.id" class="flex items-center gap-1.5 border border-border rounded-lg p-2">
              <div class="flex-1 min-w-0 cursor-pointer" @click="useSession(s)">
                <div class="text-[11.5px] font-medium truncate">{{ s.title }}</div>
                <div class="text-[10px] text-text-3 mt-0.5">{{ formatTime(s.updatedAt) }} · {{ s.messages.length }} 条</div>
              </div>
              <n-button size="tiny" quaternary @click="removeSession(s)">删</n-button>
            </div>
          </div>
        </n-drawer-content>
      </n-drawer>

      <!-- 导出弹窗 -->
      <n-modal v-model:show="exportOpen" preset="card" title="对话总结导出" style="width: 360px">
        <div class="mb-3">
          <div class="text-[10.5px] text-text-2 mb-1.5">导出模式</div>
          <n-radio-group v-model:value="exportMode">
            <n-radio-button value="full">完整对话留存</n-radio-button>
            <n-radio-button value="ai">AI 精简总结</n-radio-button>
          </n-radio-group>
        </div>
        <div class="mb-3">
          <div class="text-[10.5px] text-text-2 mb-1.5">输出渠道（可插拔架构）</div>
          <n-radio-group v-model:value="exportTarget">
            <n-radio-button
              v-for="t in EXPORT_TARGETS"
              :key="t.id"
              :value="t.id"
              :disabled="!t.available"
            >
              {{ t.label }}{{ t.note ? `（${t.note}）` : '' }}
            </n-radio-button>
          </n-radio-group>
        </div>
        <div v-if="exportMode === 'ai' && exportSummary" class="bg-bg-soft rounded-lg p-2 mb-2">
          <div class="text-[10.5px] text-text-2 mb-1">AI 总结预览</div>
          <div class="text-[11px] text-text-2 whitespace-pre-wrap max-h-[120px] overflow-y-auto">
            {{ exportSummary.slice(0, 200) }}{{ exportSummary.length > 200 ? '…' : '' }}
          </div>
        </div>
        <div v-if="exportMsg" class="text-[11px] text-success mt-1.5">{{ exportMsg }}</div>
        <template #footer>
          <div class="flex justify-end gap-2">
            <n-button size="small" @click="copyExportDoc">复制文档</n-button>
            <n-button size="small" type="primary" :loading="exportBusy" @click="doExport">
              {{ exportMode === 'ai' ? 'AI 总结并导出' : '导出 Markdown' }}
            </n-button>
          </div>
        </template>
      </n-modal>

      <div
        v-if="toast"
        class="absolute left-1/2 bottom-[88px] -translate-x-1/2 bg-card border border-border shadow-lg rounded-lg px-3 py-1.5 text-[11px] text-text-2 z-10 animate-fade-in"
      >
        {{ toast }}
      </div>
    </div>
  </n-config-provider>
</template>

<style>
.chip {
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--text-2);
  cursor: pointer;
  white-space: nowrap;
  transition:
    background 0.15s,
    color 0.15s,
    transform 0.08s ease;
}
.chip:hover {
  background: var(--primary-soft);
  border-color: var(--primary);
  color: var(--primary);
}
.chip:active {
  transform: scale(0.96);
}
.chip:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.icon-btn {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-2);
  transition: background 0.15s;
}
.icon-btn:hover {
  background: var(--hover);
}
.send-btn {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 9px;
  background: var(--primary);
  color: #fff;
  font-size: 14px;
  cursor: pointer;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    background 0.15s,
    transform 0.08s ease;
}
.send-btn:hover {
  background: var(--primary-hover);
}
.send-btn:active {
  transform: scale(0.94);
}
.ghost-btn {
  border: none;
  background: transparent;
  color: var(--text-3);
  font-size: 10px;
  cursor: pointer;
  transition: color 0.15s;
}
.ghost-btn:hover {
  color: var(--danger);
}
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}
.animate-fade-in {
  animation: fadeIn 0.15s ease;
}
</style>
