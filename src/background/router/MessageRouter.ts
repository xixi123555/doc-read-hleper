/**
 * 运行时消息路由（MessageRouter）
 * 把 chrome.runtime.onMessage 的 switch-case 收敛为「type → handler」注册表。
 */
export interface SenderCtx {
  tabId?: number
  url?: string
}

export class MessageRouter {
  private readonly handlers = new Map<
    string,
    (msg: any, sender: SenderCtx) => unknown | Promise<unknown>
  >()

  register(type: string, handler: (msg: any, sender: SenderCtx) => unknown | Promise<unknown>): void {
    this.handlers.set(type, handler)
  }

  /** 分发：无 handler 返回 undefined（调用方据此同步返回 false） */
  dispatch(msg: any, sender: SenderCtx): unknown | Promise<unknown> {
    const handler = this.handlers.get(msg?.type)
    if (!handler) return undefined
    return handler(msg, sender)
  }
}
