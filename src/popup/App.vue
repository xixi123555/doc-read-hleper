<script setup lang="ts">
/**
 * Popup 主面板（Tailwind CSS 现代简约风）
 * 路由：模型已配置 → 默认进入「快捷对话」页（点 ⚙ 进设置）；未配置 → 直接进入「设置」页
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import {
  NAlert,
  NButton,
  NConfigProvider,
  NDivider,
  NEmpty,
  NGlobalStyle,
  NInput,
  NInputNumber,
  NModal,
  NSelect,
  NSlider,
  NSpace,
  NSwitch,
  NTag,
  darkTheme,
} from 'naive-ui'
import type { GlobalTheme } from 'naive-ui'
import {
  AppSettings,
  ChatMessage,
  ChatSession,
  ModelConfig,
  PageContext,
  ThemeMode,
} from '../shared/types'
import {
  clearPopupSession,
  deleteConfig,
  getActiveConfig,
  getActiveConfigId,
  getConfigs,
  getPopupSession,
  getSettings,
  isConfigComplete,
  isSiteDisabled,
  saveConfig,
  savePopupSession,
  setActiveConfigId,
  setSettings,
  uid,
} from '../shared/storage'
import { decryptText, encryptText } from '../shared/crypto'
import { PRESETS, createConfigFromPreset } from '../shared/presets'
import { darkOverrides, lightOverrides, resolveTheme } from '../shared/theme'
import { RT } from '../shared/msg'
import { QUICK_COMMANDS, quickCommandById } from '../shared/prompts'
import { logger } from '../shared/logger'
import { renderMarkdown } from '../chat/markdown'
import { copyText } from '../chat/clipboard'

/* ---------------- 主题 ---------------- */

const naiveTheme = ref<GlobalTheme | null>(null)
const themeOverrides = computed(() => (naiveTheme.value === darkTheme ? darkOverrides : lightOverrides))

/* ---------------- 路由 ---------------- */

const view = ref<'chat' | 'settings'>('settings')
const configured = ref(false)
const checking = ref(true)

/* ---------------- 设置与状态 ---------------- */

const settings = reactive<AppSettings>({
  globalEnabled: true,
  disabledSites: [],
  translateEnabled: false,
  theme: 'light',
})

const configs = ref<ModelConfig[]>([])
const activeId = ref<string | null>(null)
const activeModelName = ref('')

const tabHost = ref('')
const tabTitle = ref('')
const tabId = ref<number | null>(null)

/* 编辑表单 */
const presetId = ref('deepseek')
const editId = ref<string | null>(null)
const form = reactive({
  name: '',
  baseUrl: '',
  apiKey: '',
  model: '',
  temperature: 0.2,
  maxTokens: 4096,
  timeout: 15,
  noKey: false,
})

const validating = ref(false)
const validateResult = ref<{ ok: boolean; message: string } | null>(null)
const saving = ref(false)
const toast = ref<{ type: 'success' | 'error' | 'info'; text: string } | null>(null)
let toastTimer: number | undefined

/* 快捷键 */
const commands = ref<chrome.commands.Command[]>([])
const shortcutModal = ref(false)
const shortcutTarget = ref('')
const shortcutInput = ref('')
const shortcutError = ref('')
const canEditShortcut = typeof chrome.commands.update === 'function'

function showToast(type: 'success' | 'error' | 'info', text: string) {
  toast.value = { type, text }
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = null), 2600)
}

/* ---------------- 快捷对话状态 ---------------- */

const messages = ref<ChatMessage[]>([])
const inputText = ref('')
const streaming = ref<{ id: number; buffer: string } | null>(null)
const pageContext = ref<PageContext | null>(null)
const ctxLoading = ref(false)
const listRef = ref<HTMLElement | null>(null)
const popupSessionDomain = ref('')
const copiedId = ref<number | null>(null)

let reqSeq = 0
let saveTimer: number | undefined
let port: chrome.runtime.Port | null = null

/* ---------------- 生命周期 ---------------- */

onMounted(async () => {
  const s = await getSettings()
  Object.assign(settings, s)
  naiveTheme.value = resolveTheme(s.theme) === 'dark' ? darkTheme : null
  await refreshConfigs()
  await refreshTab()
  await refreshCommands()
  // 路由：模型配置完成 → 对话；未完成 → 设置
  const active = await getActiveConfig()
  configured.value = isConfigComplete(active)
  view.value = configured.value ? 'chat' : 'settings'
  checking.value = false
  if (configured.value) {
    ensurePort()
    await loadPopupSession()
  }
  window.addEventListener('message', onWindowMessage)
})

onBeforeUnmount(() => {
  window.clearTimeout(toastTimer)
  window.clearTimeout(saveTimer)
  window.clearTimeout(chunkTimer)
  try {
    port?.disconnect()
  } catch {
    /* ignore */
  }
})

async function refreshConfigs() {
  configs.value = await getConfigs()
  activeId.value = await getActiveConfigId()
  const active = configs.value.find((c) => c.id === activeId.value) || configs.value[0]
  activeModelName.value = active ? `${active.name} / ${active.model}` : '未配置'
  return active || null
}

async function refreshTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab) return
  tabId.value = tab.id ?? null
  tabHost.value = tab.url ? new URL(tab.url).hostname : ''
  tabTitle.value = tab.title || ''
}

async function refreshCommands() {
  try {
    commands.value = await chrome.commands.getAll()
  } catch {
    commands.value = []
  }
}

/* ---------------- 全局开关 / 网页禁用 ---------------- */

async function onGlobalSwitch(v: boolean) {
  settings.globalEnabled = v
  await setSettings({ globalEnabled: v })
  showToast('info', v ? '插件已开启' : '插件已关闭，所有功能静默失效')
}

const tabDisabled = computed(() => isSiteDisabled(settings.disabledSites, tabHost.value))

async function onTabDisable(v: boolean) {
  if (!tabHost.value) return
  const set = new Set(settings.disabledSites)
  if (v) set.add(tabHost.value)
  else set.delete(tabHost.value)
  settings.disabledSites = [...set]
  await setSettings({ disabledSites: settings.disabledSites })
  showToast('info', v ? `已在 ${tabHost.value} 上禁用` : `已恢复 ${tabHost.value}`)
}

/* ---------------- 模型配置 ---------------- */

const presetOptions = computed(() => [
  ...PRESETS.map((p) => ({ label: p.name, value: p.id })),
  { label: '自定义配置', value: '__custom__' },
])

function applyPreset(id: string) {
  presetId.value = id
  if (id === '__custom__') return
  const cfg = createConfigFromPreset(id)
  form.name = cfg.name
  form.baseUrl = cfg.baseUrl
  form.apiKey = ''
  form.model = cfg.model
  form.temperature = cfg.temperature
  form.maxTokens = cfg.maxTokens
  form.timeout = cfg.timeout
  form.noKey = id === 'ollama'
}

async function editConfig(cfg: ModelConfig) {
  editId.value = cfg.id
  presetId.value = '__custom__'
  form.name = cfg.name
  form.baseUrl = cfg.baseUrl
  form.apiKey = await decryptText(cfg.apiKey || '')
  form.model = cfg.model
  form.temperature = cfg.temperature
  form.maxTokens = cfg.maxTokens
  form.timeout = cfg.timeout
  form.noKey = !!cfg.noKey
}

async function removeConfig(id: string) {
  await deleteConfig(id)
  const active = await refreshConfigs()
  configured.value = isConfigComplete(active)
  if (!configured.value && view.value === 'chat') view.value = 'settings'
  showToast('info', '配置已删除')
}

async function setActive(id: string) {
  await setActiveConfigId(id)
  const active = await refreshConfigs()
  configured.value = isConfigComplete(active)
  showToast('success', '已切换生效模型')
}

async function validateNow() {
  if (!form.baseUrl || !form.model) {
    showToast('error', '请先填写接口地址与模型名称')
    return
  }
  validating.value = true
  validateResult.value = null
  try {
    const encrypted = await encryptText(form.apiKey || '')
    const res = await chrome.runtime.sendMessage({
      type: RT.Validate,
      config: {
        id: '',
        name: form.name,
        baseUrl: form.baseUrl,
        apiKey: encrypted,
        model: form.model,
        temperature: form.temperature,
        maxTokens: form.maxTokens,
        timeout: form.timeout,
        createdAt: 0,
      },
    })
    validateResult.value = { ok: !!res?.ok, message: res?.message || '校验失败' }
  } catch (e: any) {
    validateResult.value = { ok: false, message: e?.message || '校验失败' }
  } finally {
    validating.value = false
  }
}

async function saveAsNew() {
  if (!form.baseUrl || !form.model) {
    showToast('error', '请先填写接口地址与模型名称')
    return
  }
  saving.value = true
  try {
    const encrypted = await encryptText(form.apiKey || '')
    const cfg: ModelConfig = {
      id: uid(),
      name: form.name || form.model,
      baseUrl: form.baseUrl,
      apiKey: encrypted,
      model: form.model,
      temperature: form.temperature,
      maxTokens: form.maxTokens,
      timeout: form.timeout,
      noKey: form.noKey,
      createdAt: Date.now(),
    }
    await saveConfig(cfg)
    await refreshConfigs()
    configured.value = isConfigComplete(cfg)
    if (configured.value) {
      showToast('success', '配置完成，进入对话')
      view.value = 'chat'
      ensurePort()
      void loadPopupSession()
    } else {
      showToast('info', '配置已保存，请补充模型名称/密钥或勾选本地免密')
    }
  } finally {
    saving.value = false
  }
}

async function saveUpdate() {
  if (!editId.value) return
  saving.value = true
  try {
    const encrypted = await encryptText(form.apiKey || '')
    const cfg: ModelConfig = {
      id: editId.value,
      name: form.name || form.model,
      baseUrl: form.baseUrl,
      apiKey: encrypted,
      model: form.model,
      temperature: form.temperature,
      maxTokens: form.maxTokens,
      timeout: form.timeout,
      noKey: form.noKey,
      createdAt: 0,
    }
    await saveConfig(cfg)
    await refreshConfigs()
    configured.value = isConfigComplete(cfg)
    if (configured.value) showToast('success', '配置已更新')
  } finally {
    saving.value = false
  }
}

/* ---------------- 划词翻译 / 主题 ---------------- */

async function onTranslateSwitch(v: boolean) {
  settings.translateEnabled = v
  await setSettings({ translateEnabled: v })
  showToast('info', v ? '划词翻译已开启' : '划词翻译已关闭')
}

async function onThemeChange(v: ThemeMode) {
  settings.theme = v
  await setSettings({ theme: v })
  naiveTheme.value = resolveTheme(v) === 'dark' ? darkTheme : null
  document.documentElement.setAttribute('data-theme', resolveTheme(v))
}

/* ---------------- 快捷键编辑 ---------------- */

function openShortcutEditor(name: string, current: string) {
  shortcutTarget.value = name
  shortcutInput.value = current || ''
  shortcutError.value = ''
  shortcutModal.value = true
}

async function saveShortcut() {
  const value = shortcutInput.value.trim()
  if (!/^([A-Za-z0-9]|(Ctrl|Alt|Shift|MacCtrl|Command)\+){1,4}[A-Za-z0-9]$/.test(value)) {
    shortcutError.value = '格式示例：Ctrl+Shift+Y、Alt+Shift+R'
    return
  }
  try {
    await chrome.commands.update({ name: shortcutTarget.value, shortcut: value })
    shortcutModal.value = false
    await refreshCommands()
    showToast('success', '快捷键已更新')
  } catch (e: any) {
    shortcutError.value = e?.message || '快捷键冲突或格式不正确'
  }
}

function shortcutLabel(cmd: chrome.commands.Command): string {
  return cmd.shortcut || '未设置'
}

/* ---------------- 快捷对话：端口与收发 ---------------- */

function ensurePort(): chrome.runtime.Port {
  if (port) return port
  port = chrome.runtime.connect({ name: 'popup-port' })
  port.onMessage.addListener(onPortMessage)
  port.onDisconnect.addListener(() => {
    port = null
  })
  return port
}

async function postToBackground(msg: any): Promise<boolean> {
  try {
    ensurePort().postMessage(msg)
    return true
  } catch {
    /* reconnect once */
  }
  await new Promise((r) => setTimeout(r, 300))
  try {
    ensurePort().postMessage(msg)
    return true
  } catch {
    return false
  }
}

/** 流式渲染节流：合并 chunk，40ms 批量刷新 */
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
      else if (!last.content) last.content = '> ⚠️ 模型未返回内容，请在设置页「校验接口」后重试'
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
  }
}

/* ---------------- 快捷对话：上下文 ---------------- */

/** 确保当前标签页已注入内容脚本（旧标签页自动补注入） */
async function ensureContentScript(tabId: number): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: RT.Ping })
    return true
  } catch {
    /* 未注入 */
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })
    await new Promise((r) => setTimeout(r, 150))
    await chrome.tabs.sendMessage(tabId, { type: RT.Ping })
    return true
  } catch {
    return false
  }
}

async function fetchContext(): Promise<PageContext | null> {
  if (tabId.value == null) return null
  ctxLoading.value = true
  try {
    await ensureContentScript(tabId.value)
    const res = await chrome.tabs.sendMessage(tabId.value, { type: RT.GetContext })
    if (res?.ok && res.ctx) {
      pageContext.value = res.ctx
      logger.info('popup', '已获取页面上下文', { title: res.ctx.title, textLen: res.ctx.text.length })
      return res.ctx
    }
    logger.warn('popup', '获取页面上下文失败', res?.error || '未知原因')
  } catch (e) {
    logger.warn('popup', '获取页面上下文异常（受限页面无上下文）', e)
  } finally {
    ctxLoading.value = false
  }
  return null
}

/* ---------------- 快捷对话：发送 / 停止 ---------------- */

async function send(text?: string) {
  const content = (text ?? inputText.value).trim()
  if (!content || streaming.value) return
  inputText.value = ''
  messages.value.push({ role: 'user', content, ts: Date.now() })
  messages.value.push({ role: 'assistant', content: '', ts: Date.now() })
  const id = ++reqSeq
  streaming.value = { id, buffer: '' }
  scrollBottom()
  const ctx = pageContext.value || (await fetchContext())
  const history = messages.value.slice(0, -2).map((m) => ({ role: m.role, content: m.content })).slice(-12)
  const ok = await postToBackground({
    type: 'llm-chat',
    payload: { id, messages: [...history, { role: 'user', content }], pageContext: ctx },
  })
  if (!ok) {
    const last = messages.value[messages.value.length - 1]
    if (last) last.content = '> ⚠️ 与后台连接失败，请关闭后重新打开插件'
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
  messages.value = []
  saveSoon()
  showToast('info', '已清空当前对话')
}

/* ---------------- 快捷对话：会话持久化 ---------------- */

async function loadPopupSession() {
  if (!tabHost.value) return
  popupSessionDomain.value = tabHost.value
  const session = await getPopupSession(tabHost.value)
  if (session?.messages?.length) messages.value = session.messages.map((m) => ({ ...m }))
  // 静默预取一次上下文（不阻塞）
  void fetchContext()
}

function saveSoon() {
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => void persistSession(), 600)
}

async function persistSession() {
  if (!popupSessionDomain.value) return
  const session: ChatSession = {
    id: 'popup-' + popupSessionDomain.value,
    title: tabTitle.value || popupSessionDomain.value,
    url: '',
    domain: popupSessionDomain.value,
    createdAt: 0,
    updatedAt: Date.now(),
    messages: messages.value.map((m) => ({ ...m })),
  }
  await savePopupSession(session)
}

/* ---------------- 工具 ---------------- */

function scrollBottom() {
  requestAnimationFrame(() => {
    const el = listRef.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

async function copyMsg(m: ChatMessage, i: number) {
  const ok = await copyText(m.content)
  if (ok) {
    copiedId.value = i
    setTimeout(() => (copiedId.value = null), 1200)
  }
}

function openFloatingWindow() {
  if (tabId.value == null) return
  void ensureContentScript(tabId.value).then((ok) => {
    if (!ok) {
      showToast('error', '无法在受限页面唤起悬浮窗')
      return
    }
    void chrome.tabs
      .sendMessage(tabId.value!, { type: RT.OpenChat })
      .then(() => window.close())
      .catch(() => showToast('error', '唤起悬浮窗失败，请刷新网页重试'))
  })
}

function onWindowMessage() {
  /* 预留：弹窗内嵌页面的消息处理 */
}

const ctxStatus = computed(() => {
  const ctx = pageContext.value
  if (!ctx) return { text: '未加载页面上下文', cls: 'text-danger', icon: '⚠️' }
  return { text: `已基于当前页面（${ctx.wordCount} 词）`, cls: 'text-success', icon: '📄' }
})
</script>

<template>
  <n-config-provider :theme="naiveTheme" :theme-overrides="themeOverrides">
    <n-global-style />
    <div class="w-[380px] h-[600px] relative flex flex-col bg-bg text-text overflow-hidden">
      <!-- 加载中 -->
      <div v-if="checking" class="flex-1 flex items-center justify-center text-sm text-text-3">
        加载中…
      </div>

      <!-- ============ 快捷对话页 ============ -->
      <template v-else-if="view === 'chat' && configured">
        <header class="flex items-center gap-2 px-3 py-2.5 border-b border-border bg-card shrink-0">
          <div
            class="w-7 h-7 rounded-lg bg-gradient-to-br from-primary to-[#3b5bdb] text-white flex items-center justify-center text-[11px] font-bold shrink-0"
          >
            AI
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-[13px] font-semibold leading-tight truncate">AI 网页阅读助手</div>
            <div class="text-[10px] text-text-3 truncate">{{ activeModelName }}</div>
          </div>
          <div class="flex items-center gap-1">
            <button
              class="w-7 h-7 rounded-lg hover:bg-hover text-text-2 text-[13px] flex items-center justify-center transition-colors"
              title="打开悬浮对话窗"
              @click="openFloatingWindow"
            >
              🪟
            </button>
            <button
              class="w-7 h-7 rounded-lg hover:bg-hover text-text-2 text-[13px] flex items-center justify-center transition-colors"
              title="设置"
              @click="view = 'settings'"
            >
              ⚙️
            </button>
          </div>
        </header>

        <!-- 快捷指令 -->
        <div class="flex gap-1.5 px-3 py-2 overflow-x-auto border-b border-border bg-bg shrink-0">
          <button
            v-for="c in QUICK_COMMANDS"
            :key="c.id"
            class="shrink-0 text-[11px] px-2.5 py-1 rounded-full border border-border bg-card text-text-2 hover:border-primary hover:text-primary hover:bg-primary-soft transition-colors active:scale-95"
            :disabled="!!streaming"
            @click="runQuickCommand(c.id)"
          >
            {{ c.icon }} {{ c.label }}
          </button>
        </div>

        <!-- 上下文状态 -->
        <div class="px-3 py-1 flex items-center justify-between text-[10px] text-text-3 border-b border-border">
          <button
            class="flex items-center gap-1 hover:text-primary transition-colors"
            title="点击刷新页面上下文"
            @click="fetchContext().then(() => showToast('页面上下文已刷新'))"
          >
            <span :class="ctxStatus.cls">{{ ctxStatus.icon }} {{ ctxStatus.text }}</span>
            <span v-if="ctxLoading" class="animate-pulse">刷新中…</span>
          </button>
          <button class="hover:text-danger transition-colors" @click="clearConversation">清空对话</button>
        </div>

        <!-- 消息列表 -->
        <div ref="listRef" class="flex-1 overflow-y-auto px-3 py-2 space-y-3">
          <div v-if="!messages.length" class="h-full flex flex-col items-center justify-center text-center gap-1 py-10">
            <div class="text-3xl">💬</div>
            <p class="text-[12px] text-text-2">我是网页阅读助手，试试上方快捷指令或直接提问</p>
            <p class="text-[10px] text-text-3">基于当前页面内容回答 · 数据仅存本地</p>
          </div>
          <div v-for="(m, i) in messages" :key="i" class="flex gap-2" :class="m.role === 'user' ? 'flex-row-reverse' : ''">
            <div
              v-if="m.role === 'assistant'"
              class="w-6 h-6 rounded-md bg-gradient-to-br from-primary to-[#3b5bdb] text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5"
            >
              AI
            </div>
            <div class="max-w-[calc(100%-32px)] min-w-0">
              <div
                class="px-3 py-2 rounded-xl text-[12.5px] leading-relaxed break-words"
                :class="
                  m.role === 'user'
                    ? 'bg-user-bubble rounded-tr-sm'
                    : 'bg-ai-bubble border border-border rounded-tl-sm'
                "
              >
                <div v-if="m.role === 'assistant'" class="md" v-html="renderMarkdown(m.content)"></div>
                <div v-else class="whitespace-pre-wrap">{{ m.content }}</div>
              </div>
              <div v-if="m.role === 'assistant' && m.content" class="mt-0.5 flex justify-end">
                <button
                  class="text-[10px] text-text-3 hover:text-primary transition-colors px-1"
                  @click="copyMsg(m, i)"
                >
                  {{ copiedId === i ? '已复制' : '复制' }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- 输入区 -->
        <footer class="border-t border-border bg-card px-3 py-2 shrink-0">
          <div class="flex items-end gap-2">
            <textarea
              v-model="inputText"
              rows="2"
              class="flex-1 resize-none rounded-xl border border-border bg-bg text-text text-[12.5px] leading-relaxed px-3 py-2 outline-none focus:border-primary focus:ring-2 focus:ring-primary-soft max-h-[96px]"
              placeholder="输入问题，Enter 发送，Shift+Enter 换行…"
              @keydown="onInputKeydown"
            ></textarea>
            <button
              v-if="streaming"
              class="w-8 h-8 rounded-xl bg-danger text-white flex items-center justify-center text-[13px] active:scale-95 transition-transform shrink-0"
              title="停止生成"
              @click="stop"
            >
              ■
            </button>
            <button
              v-else
              class="w-8 h-8 rounded-xl bg-primary text-white flex items-center justify-center text-[13px] hover:bg-primary-hover active:scale-95 transition-all shrink-0"
              title="发送"
              @click="send()"
            >
              ➤
            </button>
          </div>
        </footer>
      </template>

      <!-- ============ 设置页 ============ -->
      <template v-else>
        <div class="flex-1 overflow-y-auto p-3 space-y-2.5">
          <!-- 顶栏 -->
          <header class="flex items-center gap-2">
            <div
              class="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-[#3b5bdb] text-white flex items-center justify-center text-[12px] font-bold shrink-0"
            >
              AI
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-[13px] font-semibold">AI 网页阅读助手</div>
              <div class="text-[10px] text-text-3">设置 · 数据仅存本地</div>
            </div>
            <n-button v-if="configured" size="small" @click="view = 'chat'">← 返回对话</n-button>
          </header>

          <!-- 全局开关 -->
          <section class="bg-card border border-border rounded-[10px] px-3 py-2.5 shadow-[var(--shadow)]">
            <div class="flex items-center justify-between">
              <div>
                <div class="text-[12.5px] font-semibold">插件总开关</div>
                <div class="text-[10px] text-text-3">关闭后所有功能静默失效</div>
              </div>
              <n-switch :value="settings.globalEnabled" @update:value="onGlobalSwitch" />
            </div>
          </section>

          <!-- 当前网页 -->
          <section class="bg-card border border-border rounded-[10px] px-3 py-2.5 shadow-[var(--shadow)]">
            <div class="text-[12.5px] font-semibold mb-2">当前网页</div>
            <div class="flex items-center justify-between">
              <span class="text-[11px] text-text-2 truncate max-w-[220px]" :title="tabTitle">
                {{ tabHost || '—' }}
              </span>
              <div class="flex items-center gap-1.5">
                <span class="text-[10px] text-text-3">单独禁用</span>
                <n-switch :value="tabDisabled" size="small" :disabled="!tabHost" @update:value="onTabDisable" />
              </div>
            </div>
            <n-space class="mt-2">
              <n-button size="small" @click="openFloatingWindow">打开悬浮窗</n-button>
            </n-space>
          </section>

          <!-- 模型配置 -->
          <section class="bg-card border border-border rounded-[10px] px-3 py-2.5 shadow-[var(--shadow)]">
            <div class="flex items-center justify-between mb-2">
              <div class="text-[12.5px] font-semibold">大模型配置</div>
              <n-tag v-if="activeModelName" size="small" type="info" class="max-w-[160px] !truncate">
                {{ activeModelName }}
              </n-tag>
            </div>

            <div class="mb-1.5">
              <label class="block text-[10.5px] text-text-2 mb-0.5">预设模板</label>
              <n-select :value="presetId" :options="presetOptions" size="small" @update:value="applyPreset" />
            </div>
            <div class="mb-1.5">
              <label class="block text-[10.5px] text-text-2 mb-0.5">配置名称</label>
              <n-input v-model:value="form.name" size="small" placeholder="如：DeepSeek 主用" />
            </div>
            <div class="mb-1.5">
              <label class="block text-[10.5px] text-text-2 mb-0.5">模型接口地址 *</label>
              <n-input v-model:value="form.baseUrl" size="small" placeholder="https://api.deepseek.com/v1" />
            </div>
            <div class="mb-1.5">
              <label class="block text-[10.5px] text-text-2 mb-0.5">API 密钥（本地加密存储）</label>
              <n-input
                v-model:value="form.apiKey"
                size="small"
                type="password"
                show-password-on="click"
                placeholder="sk-...（本地免密模型可留空）"
              />
            </div>
            <div class="mb-1.5">
              <label class="block text-[10.5px] text-text-2 mb-0.5">模型名称 *</label>
              <n-input v-model:value="form.model" size="small" placeholder="deepseek-chat / gpt-4o" />
            </div>
            <div class="mb-1.5">
              <label class="block text-[10.5px] text-text-2 mb-0.5">Temperature：{{ form.temperature.toFixed(2) }}</label>
              <n-slider v-model:value="form.temperature" :min="0" :max="1" :step="0.05" />
            </div>
            <div class="flex gap-2">
              <div class="mb-1.5 flex-1">
                <label class="block text-[10.5px] text-text-2 mb-0.5">最大上下文 (token)</label>
                <n-input-number v-model:value="form.maxTokens" size="small" :min="512" :step="512" />
              </div>
              <div class="mb-1.5 flex-1">
                <label class="block text-[10.5px] text-text-2 mb-0.5">超时 (秒)</label>
                <n-input-number v-model:value="form.timeout" size="small" :min="5" :max="300" />
              </div>
            </div>
            <div class="flex items-center gap-2 py-1">
              <n-switch v-model:value="form.noKey" size="small" />
              <span class="text-[11px] text-text-2">本地免密模型（无需密钥，如 Ollama）</span>
            </div>

            <n-alert v-if="validateResult" :type="validateResult.ok ? 'success' : 'error'" class="mt-2">
              {{ validateResult.message }}
            </n-alert>

            <div class="flex items-center justify-between mt-2">
              <n-button size="small" :loading="validating" @click="validateNow">校验接口</n-button>
              <div class="flex gap-2">
                <n-button v-if="editId" size="small" :loading="saving" @click="saveUpdate">更新配置</n-button>
                <n-button v-else type="primary" size="small" :loading="saving" @click="saveAsNew">
                  保存并进入对话
                </n-button>
              </div>
            </div>

            <n-divider style="margin: 10px 0" />
            <div class="flex flex-col gap-1.5 max-h-[150px] overflow-y-auto">
              <div v-if="!configs.length" class="py-2"><n-empty size="small" description="暂无配置" /></div>
              <div v-for="cfg in configs" :key="cfg.id" class="flex items-center gap-1.5 border border-border rounded-lg px-2 py-1.5">
                <div class="flex-1 min-w-0 cursor-pointer" @click="editConfig(cfg)">
                  <div class="text-[11.5px] font-medium">{{ cfg.name }}</div>
                  <div class="text-[10px] text-text-3 truncate">{{ cfg.model }}</div>
                </div>
                <n-tag
                  size="tiny"
                  :type="cfg.id === activeId ? 'success' : 'default'"
                  :bordered="false"
                  class="cursor-pointer shrink-0"
                  @click="setActive(cfg.id)"
                >
                  {{ cfg.id === activeId ? '生效中' : '启用' }}
                </n-tag>
                <n-button size="tiny" quaternary class="shrink-0" @click="removeConfig(cfg.id)">删除</n-button>
              </div>
            </div>
          </section>

          <!-- 划词翻译 -->
          <section class="bg-card border border-border rounded-[10px] px-3 py-2.5 shadow-[var(--shadow)]">
            <div class="flex items-center justify-between">
              <div>
                <div class="text-[12.5px] font-semibold">划词翻译</div>
                <div class="text-[10px] text-text-3">选中英文即时翻译 · 支持音标/直译/上下文意译</div>
              </div>
              <n-switch :value="settings.translateEnabled" @update:value="onTranslateSwitch" />
            </div>
          </section>

          <!-- 快捷键 -->
          <section class="bg-card border border-border rounded-[10px] px-3 py-2.5 shadow-[var(--shadow)]">
            <div class="text-[12.5px] font-semibold mb-1.5">快捷键</div>
            <div v-for="cmd in commands" :key="cmd.name" class="flex items-center gap-2 py-0.5">
              <span class="flex-1 text-[10px] text-text-3">{{ cmd.description }}</span>
              <span class="text-[10px] font-mono bg-bg-soft border border-border rounded-md px-1.5 py-0.5 text-text-2">
                {{ shortcutLabel(cmd) }}
              </span>
              <n-button v-if="canEditShortcut" size="tiny" quaternary @click="openShortcutEditor(cmd.name, cmd.shortcut || '')">
                修改
              </n-button>
            </div>
            <div v-if="!canEditShortcut" class="text-[10px] text-text-3 mt-1">
              当前浏览器不支持面板内修改，请前往 chrome://extensions/shortcuts
            </div>
          </section>

          <!-- 主题 -->
          <section class="bg-card border border-border rounded-[10px] px-3 py-2.5 shadow-[var(--shadow)]">
            <div class="flex items-center justify-between">
              <div class="text-[12.5px] font-semibold">主题模式</div>
              <n-select
                :value="settings.theme"
                :options="[
                  { label: '浅色', value: 'light' },
                  { label: '深色', value: 'dark' },
                  { label: '跟随系统', value: 'auto' },
                ]"
                size="small"
                style="width: 110px"
                @update:value="onThemeChange"
              />
            </div>
          </section>

          <footer class="text-center text-[10px] text-text-3 pb-1">数据仅存本地 · 不上传任何第三方</footer>
        </div>
      </template>

      <!-- Toast -->
      <div
        v-if="toast"
        class="absolute left-1/2 bottom-4 -translate-x-1/2 z-50 px-3.5 py-2 rounded-lg bg-card border border-border shadow-lg text-[11px] animate-[fadeIn_0.15s_ease]"
        :class="toast.type === 'success' ? 'text-success' : toast.type === 'error' ? 'text-danger' : 'text-text'"
      >
        {{ toast.text }}
      </div>

      <!-- 快捷键编辑弹窗 -->
      <n-modal v-model:show="shortcutModal" preset="card" title="修改快捷键" style="width: 300px">
        <n-input v-model:value="shortcutInput" placeholder="如 Ctrl+Shift+Y" size="small" />
        <div v-if="shortcutError" class="text-danger text-[10px] mt-1.5">{{ shortcutError }}</div>
        <template #footer>
          <n-space justify="end">
            <n-button size="small" @click="shortcutModal = false">取消</n-button>
            <n-button size="small" type="primary" @click="saveShortcut">保存</n-button>
          </n-space>
        </template>
      </n-modal>
    </div>
  </n-config-provider>
</template>
