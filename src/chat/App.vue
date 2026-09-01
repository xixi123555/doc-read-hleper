<script setup lang="ts">
/**
 * 右侧悬浮对话窗（iframe 内独立渲染，不污染原生网页 DOM）
 * 功能：流式对话 / 快捷指令 / 历史记录 / 总结导出 / 深色模式 / 拖拽缩放收起全屏
 *
 * 本文件为组合根：仅保留模块编排，UI 与领域逻辑分别下沉到 components/ 与 composables/。
 */
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { NConfigProvider, NGlobalStyle } from 'naive-ui'
import { PM } from '../shared/msg'
import { quickCommandById } from '../shared/prompts'
import { logger } from '../shared/logger'
import { getActiveConfig } from '../shared/storage'
import { useHostBridge } from './composables/useHostBridge'
import { useTheme } from './composables/useTheme'
import { useConversation } from './composables/useConversation'
import { useContext } from './composables/useContext'
import { useBackground } from './composables/useBackground'
import { useExport } from './composables/useExport'
import ChatHeader from './components/ChatHeader.vue'
import QuickCommandBar from './components/QuickCommandBar.vue'
import MessageList from './components/MessageList.vue'
import ChatInput from './components/ChatInput.vue'
import HistoryDrawer from './components/HistoryDrawer.vue'
import ExportModal from './components/ExportModal.vue'

/* ---------------- 组合式模块 ---------------- */

const {
  nonce, domain, pageTitle, pageUrl, isCollapsed,
  postToHost, expand, collapse, toggleFullscreen, closeWindow, onHeadDragDown, onResizeDown,
  applyInit, applyPageChanged,
} = useHostBridge()

const { naiveTheme, themeOverrides, themeIcon, cycleTheme, applyThemeMode, refreshTheme } = useTheme()

const toast = ref('')
let toastTimer: number | undefined
function showToast(text: string) {
  toast.value = text
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = ''), 2000)
}

const {
  messages,
  sessionId, sessionDomain,
  startNewSession, saveSoon, clearConversation: clearConv,
  historyOpen, historyLoading, sessions,
  openHistory, loadSession, removeSession, clearHistory,
  displayMessages, foldedCount, expandMessages,
  dispose: disposeConv,
} = useConversation({ domain, pageTitle, pageUrl })

const listRef = ref<InstanceType<typeof MessageList> | null>(null)
function scrollBottom() {
  void nextTick(() => listRef.value?.scrollToBottom())
}

const { pageContext, ensureContext, applyContextReady } = useContext({ nonce, postToHost })

const {
  streaming, reqSeq, ensurePort, postToBackground, flushPendingDelta, registerMessageHandler,
  dispose: disposeBg,
} = useBackground({ messages, scrollBottom, saveSoon })

const {
  exportOpen, exportBusy, exportMsg, exportMode, exportTarget, exportSummary,
  openExport, doExport, copyExportDoc,
  handleSummarizeChunk, handleSummarizeDone, handleSummarizeError,
} = useExport({ pageTitle, pageUrl, domain, messages, reqSeq, postToBackground })

// 总结导出流式消息由 useBackground 统一接收后分流
registerMessageHandler((msg) => {
  if (msg.type === 'summarize-chunk') handleSummarizeChunk(msg.id, msg.delta)
  else if (msg.type === 'summarize-done') handleSummarizeDone(msg.id, msg.content)
  else if (msg.type === 'summarize-error') handleSummarizeError(msg.id, msg.message)
})

/* ---------------- 模型 ---------------- */

const modelName = ref('')
async function refreshModel() {
  const cfg = await getActiveConfig()
  modelName.value = cfg ? `${cfg.name} · ${cfg.model}` : '未配置模型'
}

/* ---------------- 发送 / 停止 ---------------- */

const inputText = ref('')

async function send(text?: string) {
  const content = (text ?? inputText.value).trim()
  if (!content || streaming.value) return
  inputText.value = ''
  messages.value.push({ role: 'user', content, ts: Date.now() })
  messages.value.push({ role: 'assistant', content: '', ts: Date.now() })
  const id = ++reqSeq.value
  streaming.value = { id, buffer: '' }
  scrollBottom()
  const pageCtx = await ensureContext()
  if (!pageCtx) logger.warn('chat', '发送消息时无页面上下文', { question: content.slice(0, 30) })
  // 只带最近 12 条历史，避免长对话请求体无界增长
  const history = messages.value
    .slice(0, -2)
    .map((m) => ({ role: m.role, content: m.content }))
    .slice(-12)
  const ok = await postToBackground({
    type: 'llm-chat',
    payload: { id, messages: [...history, { role: 'user', content }], pageContext: pageCtx },
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

function runQuickCommand(id: string) {
  const def = quickCommandById(id)
  if (def) void send(def.prompt)
}

function clearConversation() {
  clearConv()
  showToast('已清空当前对话')
}

function refreshContext() {
  void ensureContext().then(() => showToast('页面上下文已刷新'))
}

/* ---------------- 宿主消息 ---------------- */

function onWindowMessage(e: MessageEvent) {
  const msg = e.data || {}
  // Init 消息用于建立信任（携带宿主 nonce），必须在 nonce 校验之前处理
  if (msg.type === PM.Init) {
    applyInit(msg)
    if (msg.domain !== sessionDomain.value || !sessionId.value) {
      startNewSession(msg.domain)
    }
    void ensureContext().then(() => undefined)
    return
  }
  if (msg.nonce && msg.nonce !== nonce.value) return
  switch (msg.type) {
    case PM.ContextReady:
      applyContextReady(msg)
      break
    case PM.QuickCommand:
      runQuickCommand(msg.command)
      break
    case PM.PageChanged:
      if (applyPageChanged(msg)) startNewSession(domain.value)
      void ensureContext().then(() => undefined)
      break
    default:
      break
  }
}

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
  disposeBg()
  disposeConv()
})
</script>

<template>
  <n-config-provider :theme="naiveTheme" :theme-overrides="themeOverrides">
    <n-global-style />
    <div class="h-screen w-full flex flex-col bg-bg relative overflow-hidden">
      <ChatHeader v-if="isCollapsed" collapsed @expand="expand" />
      <template v-else>
        <ChatHeader
          :page-title="pageTitle"
          :model-name="modelName"
          :domain="domain"
          :theme-icon="themeIcon()"
          @history="openHistory"
          @export="openExport"
          @theme="cycleTheme"
          @fullscreen="toggleFullscreen"
          @collapse="collapse"
          @close="closeWindow"
          @drag-down="onHeadDragDown"
        />
        <QuickCommandBar :disabled="!!streaming" @run="runQuickCommand" />
        <MessageList
          ref="listRef"
          :messages="displayMessages"
          :streaming="!!streaming"
          :folded-count="foldedCount"
          @expand="expandMessages"
          @run-quick="runQuickCommand"
        />
        <ChatInput
          v-model="inputText"
          :streaming="!!streaming"
          :page-context="pageContext"
          @send="send()"
          @stop="stop"
          @clear="clearConversation"
          @refresh-ctx="refreshContext"
          @resize-down="onResizeDown"
        />
      </template>

      <HistoryDrawer
        v-model:show="historyOpen"
        :sessions="sessions"
        :loading="historyLoading"
        @new="startNewSession(domain)"
        @clear="clearHistory"
        @use="loadSession"
        @remove="removeSession"
      />
      <ExportModal
        v-model:show="exportOpen"
        v-model:mode="exportMode"
        v-model:target="exportTarget"
        :busy="exportBusy"
        :msg="exportMsg"
        :summary="exportSummary"
        @export="doExport"
        @copy="copyExportDoc"
      />

      <div
        v-if="toast"
        class="absolute left-1/2 bottom-[88px] -translate-x-1/2 bg-card border border-border shadow-lg rounded-lg px-3 py-1.5 text-[11px] text-text-2 z-10 animate-fade-in"
      >
        {{ toast }}
      </div>
    </div>
  </n-config-provider>
</template>
