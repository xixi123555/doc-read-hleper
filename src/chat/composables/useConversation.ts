/**
 * 会话管理：当前对话消息、会话持久化、历史记录抽屉数据、超长消息折叠。
 * 依赖宿主的 domain / pageTitle / pageUrl 用于落盘元数据。
 */
import { computed, ref } from 'vue'
import type { Ref } from 'vue'
import type { ChatMessage, ChatSession } from '../../shared/types'
import {
  clearDomainSessions,
  deleteSession,
  getSessionsByDomain,
  saveSession,
  uid,
} from '../../shared/storage'

export function useConversation(deps: {
  domain: Ref<string>
  pageTitle: Ref<string>
  pageUrl: Ref<string>
}) {
  const messages = ref<ChatMessage[]>([])
  const sessionId = ref('')
  const sessionDomain = ref('')
  const sessionCreatedAt = ref(Date.now())
  let saveTimer: number | undefined

  function startNewSession(domain: string) {
    sessionId.value = uid()
    sessionDomain.value = domain || location.hostname
    sessionCreatedAt.value = Date.now()
    messages.value = []
  }

  /* ---------------- 持久化 ---------------- */

  function saveSoon() {
    window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => void persistSession(), 800)
  }

  async function persistSession() {
    if (!sessionId.value || !deps.domain.value) return
    const sess: ChatSession = {
      id: sessionId.value,
      title: deps.pageTitle.value || deps.domain.value,
      url: deps.pageUrl.value,
      domain: deps.domain.value,
      createdAt: sessionCreatedAt.value,
      updatedAt: Date.now(),
      messages: messages.value.map((m) => ({ ...m })),
    }
    await saveSession(sess)
  }

  function clearConversation() {
    if (!messages.value.length) return
    messages.value = []
    saveSoon()
  }

  /* ---------------- 历史记录 ---------------- */

  const historyOpen = ref(false)
  const historyLoading = ref(false)
  const sessions = ref<ChatSession[]>([])

  async function openHistory() {
    historyOpen.value = true
    historyLoading.value = true
    try {
      sessions.value = await getSessionsByDomain(deps.domain.value)
    } finally {
      historyLoading.value = false
    }
  }

  function loadSession(s: ChatSession) {
    sessionId.value = s.id
    sessionDomain.value = s.domain
    sessionCreatedAt.value = s.createdAt
    messages.value = s.messages.map((m) => ({ ...m }))
    historyOpen.value = false
  }

  function removeSession(s: ChatSession) {
    void deleteSession(s.domain, s.id).then(() => {
      sessions.value = sessions.value.filter((x) => x.id !== s.id)
    })
  }

  function clearHistory() {
    void clearDomainSessions(deps.domain.value).then(() => {
      sessions.value = []
    })
  }

  /* ---------------- 长对话折叠（防内存/渲染无界增长） ---------------- */

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

  function dispose() {
    window.clearTimeout(saveTimer)
  }

  return {
    messages,
    sessionId,
    sessionDomain,
    startNewSession,
    saveSoon,
    clearConversation,
    historyOpen,
    historyLoading,
    sessions,
    openHistory,
    loadSession,
    removeSession,
    clearHistory,
    displayMessages,
    foldedCount,
    expandMessages,
    dispose,
  }
}
