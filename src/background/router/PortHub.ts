/**
 * 端口中枢（PortHub）：chat-port / popup-port 的流式请求处理
 * 把端口的 llm-chat / summarize / abort 消息转为 AgentRequest，
 * 订阅 AgentRuntime 事件流并转发回端口（消息名与历史协议完全一致）。
 */
import { AgentRequest } from '../agent/types'
import { AgentRuntime } from '../agent/AgentRuntime'
import { logger } from '../../shared/logger'

interface EventNames {
  chunk: string
  done: string
  error: string
}

const CHAT_EVENTS: EventNames = { chunk: 'llm-chunk', done: 'llm-done', error: 'llm-error' }
const SUMMARIZE_EVENTS: EventNames = {
  chunk: 'summarize-chunk',
  done: 'summarize-done',
  error: 'summarize-error',
}

export class PortHub {
  constructor(private readonly runtime: AgentRuntime) {}

  attach(port: chrome.runtime.Port): void {
    if (port.name !== 'chat-port' && port.name !== 'popup-port') return
    port.onMessage.addListener((msg: any) => this.handle(port, msg))
    port.onDisconnect.addListener(() => {
      // 页面关闭时终止其全部请求
      this.runtime.abortAll()
    })
  }

  private handle(port: chrome.runtime.Port, msg: any): void {
    if (msg?.type === 'llm-chat') {
      const payload = msg.payload || {}
      const list = payload.messages || []
      const last = list[list.length - 1]
      const req: AgentRequest = {
        id: payload.id,
        kind: 'chat',
        input: last?.content || '',
        history: list.slice(0, -1),
        pageContext: payload.pageContext,
      }
      void this.forward(port, req, CHAT_EVENTS)
    } else if (msg?.type === 'summarize') {
      const payload = msg.payload || {}
      const req: AgentRequest = {
        id: payload.id,
        kind: 'summarize',
        input: '',
        history: payload.messages || [],
        meta: payload.pageMeta,
      }
      void this.forward(port, req, SUMMARIZE_EVENTS)
    } else if (msg?.type === 'abort') {
      this.runtime.abort(msg.id)
    }
  }

  private async forward(port: chrome.runtime.Port, req: AgentRequest, names: EventNames): Promise<void> {
    try {
      for await (const ev of this.runtime.handle(req)) {
        if (ev.type === 'chunk') {
          port.postMessage({ type: names.chunk, id: req.id, delta: ev.delta })
        } else if (ev.type === 'done') {
          port.postMessage({ type: names.done, id: req.id, content: ev.content })
        } else if (ev.type === 'error') {
          logger.error('bg', 'Agent 请求失败', ev.message)
          port.postMessage({ type: names.error, id: req.id, message: ev.message })
        }
      }
    } catch (e: any) {
      try {
        port.postMessage({ type: names.error, id: req.id, message: e?.message || String(e) })
      } catch {
        /* port closed */
      }
    }
  }
}
