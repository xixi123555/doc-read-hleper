/**
 * 后台长连接与流式渲染：管理 runtime port（断线重连）、LLM 流式 chunk 节流批量刷新。
 * 非 LLM 类消息（如总结导出）通过 registerMessageHandler 分流给外部模块。
 */
import { ref } from 'vue'
import type { Ref } from 'vue'
import type { ChatMessage } from '../../shared/types'

export function useBackground(deps: {
  messages: Ref<ChatMessage[]>
  scrollBottom: () => void
  saveSoon: () => void
}) {
  const streaming = ref<{ id: number; buffer: string } | null>(null)
  const reqSeq = ref(0)

  let port: chrome.runtime.Port | null = null
  let chunkTimer: number | undefined
  let pendingDelta = ''
  const extraHandlers: Array<(msg: any) => void> = []

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

  function lastMessage(): ChatMessage | undefined {
    return deps.messages.value[deps.messages.value.length - 1]
  }

  /** 流式渲染节流：40ms 批量刷新一次（约 25fps），避免每 token 全量重渲染 */
  function flushPendingDelta() {
    if (chunkTimer) {
      window.clearTimeout(chunkTimer)
      chunkTimer = undefined
    }
    if (pendingDelta && streaming.value) {
      streaming.value.buffer += pendingDelta
      pendingDelta = ''
      const last = lastMessage()
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
      const last = lastMessage()
      if (last) last.content = streaming.value.buffer
      deps.scrollBottom()
    }, 40)
  }

  function onPortMessage(msg: any) {
    if (msg.type === 'llm-chunk' && streaming.value?.id === msg.id) {
      pendingDelta += msg.delta || ''
      scheduleChunkFlush()
    } else if (msg.type === 'llm-done' && streaming.value?.id === msg.id) {
      flushPendingDelta()
      const last = lastMessage()
      if (last) {
        if (msg.content) last.content = msg.content
        else if (!last.content) {
          last.content =
            '> ⚠️ 模型未返回内容：接口可能不支持流式输出或模型名/配置有误，请在插件面板「校验接口」后重试'
        }
      }
      streaming.value = null
      deps.saveSoon()
    } else if (msg.type === 'llm-error' && streaming.value?.id === msg.id) {
      flushPendingDelta()
      const last = lastMessage()
      if (last) {
        last.content =
          last.content + (last.content ? '\n\n' : '') + `> ⚠️ ${msg.message || '请求失败'}`
      }
      streaming.value = null
      deps.saveSoon()
    } else {
      for (const h of extraHandlers) h(msg)
    }
  }

  /** 注册非 LLM 消息处理器（如总结导出流式消息） */
  function registerMessageHandler(h: (msg: any) => void) {
    extraHandlers.push(h)
  }

  function dispose() {
    window.clearTimeout(chunkTimer)
    try {
      port?.disconnect()
    } catch {
      /* ignore */
    }
    port = null
  }

  return { streaming, reqSeq, ensurePort, postToBackground, flushPendingDelta, registerMessageHandler, dispose }
}
