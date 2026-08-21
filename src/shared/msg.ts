/**
 * 消息类型常量：content script 与后台、窗口间 postMessage 协议。
 */

export const HOST_ID = 'dsh-ai-reader-host'

/** content script 挂载到宿主页面的扩展页面 iframe 地址 */
export const CHAT_IFRAME_URL = chrome.runtime.getURL('chat.html')
export const TRANSLATE_IFRAME_URL = chrome.runtime.getURL('translate.html')

/** runtime 消息（host <-> background / popup <-> background / background -> host） */
export const RT = {
  GetTabId: 'get-tab-id',
  Translate: 'translate',
  Validate: 'validate',
  OpenChat: 'open-chat',
  ToggleChat: 'toggle-chat',
  QuickCommand: 'quick-command',
  GetContext: 'get-context',
  Ping: 'ping',
} as const

/** host <-> chat iframe 的 window.postMessage 协议 */
export const PM = {
  Init: 'init', // host -> chat: 初始化信息（含 nonce）
  ContextReady: 'context-ready', // host -> chat: 上下文已写入 storage.session
  GetContext: 'get-context', // chat -> host: 请求重新提取页面上下文
  PageChanged: 'page-changed', // host -> chat: 页面地址/标题变化
  QuickCommand: 'quick-command', // host -> chat: 快捷指令（来自快捷键/弹窗）
  SetSize: 'set-size', // chat -> host: 请求调整窗口尺寸
  SetHeight: 'set-height', // translate iframe -> host: 内容自适应高度
  DragStart: 'drag-start', // chat -> host
  ResizeStart: 'resize-start', // chat -> host
  Collapse: 'collapse', // chat -> host
  Expand: 'expand', // chat -> host
  Fullscreen: 'fullscreen', // chat -> host: {fullscreen: boolean}
  Close: 'close', // chat -> host
  SetState: 'set-state', // chat -> host: 窗口状态（用于持久化）
  // 划词翻译
  TranslateInit: 'translate-init', // host -> translate iframe
  TranslateResult: 'translate-result', // host -> translate iframe
  TranslateRetry: 'translate-retry', // translate iframe -> host
  TranslateClose: 'translate-close', // host -> translate iframe
} as const

/** storage.session 中的上下文缓存 key 前缀 */
export const CTX_KEY_PREFIX = 'page-ctx-'
export const WINDOW_STATE_KEY = 'chat-window-state'
export const TRANSLATE_NONCE_KEY = 'translate-nonce'
