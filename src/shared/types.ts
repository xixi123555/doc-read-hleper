/** 全局共享类型定义 */

export type Role = 'user' | 'assistant'

export interface ChatMessage {
  role: Role
  content: string
  ts: number
}

export interface ChatSession {
  id: string
  title: string
  url: string
  domain: string
  createdAt: number
  updatedAt: number
  messages: ChatMessage[]
}

export type ThemeMode = 'light' | 'dark' | 'auto'

export interface ModelConfig {
  id: string
  name: string
  /** OpenAI 兼容接口地址，例如 https://api.deepseek.com/v1 */
  baseUrl: string
  /** API 密钥（本地 AES-GCM 加密存储，可为空以支持本地免密模型） */
  apiKey: string
  /** 模型名称，如 deepseek-chat / gpt-4o / qwen-plus / llama3 */
  model: string
  /** 温度 0-1，技术文档阅读默认 0.2（严谨模式） */
  temperature: number
  /** 单次对话 token 上限（上下文 + 回复预算） */
  maxTokens: number
  /** 请求超时（秒），默认 15 */
  timeout: number
  /** 本地免密模型标记（apiKey 为空且勾选此项视为配置完成） */
  noKey?: boolean
  /** 协议类型（默认 OpenAI 兼容；Anthropic 为预留） */
  protocol?: 'openai' | 'anthropic'
  createdAt: number
}

export interface PageOutlineItem {
  level: number
  text: string
}

export interface CodeBlockInfo {
  lang: string
  code: string
}

/** 网页解析 Agent 产出的页面上下文 */
export interface PageContext {
  title: string
  url: string
  lang: string
  wordCount: number
  outline: PageOutlineItem[]
  codeBlocks: CodeBlockInfo[]
  text: string
  truncated: boolean
}

export type ChatWindowState = 'closed' | 'open' | 'collapsed'

export interface WindowRect {
  left: number
  top: number
  width: number
  height: number
}

export type TranslateMode = 'word' | 'phrase' | 'long'

export interface TranslateResult {
  mode: TranslateMode
  /** 原文 */
  source: string
  /** 单词模式：英式/美式音标 */
  phonetics?: { uk?: string; us?: string }
  /** 直译（单词模式为多义项列表，其余为一句直译） */
  literal: string[] | string
  /** 结合网页上下文的意译/语境翻译 */
  contextual: string
  /** 该词/句在上下文中的释义（单词模式） */
  usage?: string
}

export const STORAGE_KEYS = {
  settings: 'settings',
  configs: 'modelConfigs',
  activeConfig: 'activeConfigId',
  sessions: 'chatSessions',
} as const

export interface AppSettings {
  /** 全局总开关 */
  globalEnabled: boolean
  /** 单独禁用的网站（hostname 列表） */
  disabledSites: string[]
  /** 划词翻译功能开关（默认关闭） */
  translateEnabled: boolean
  /** 主题模式 */
  theme: ThemeMode
}

export interface LLMChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  /** OpenAI 工具调用（assistant 消息携带） */
  tool_calls?: Array<{ id: string; name: string; arguments: unknown }>
  /** 工具结果消息关联的调用 id */
  tool_call_id?: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  globalEnabled: true,
  disabledSites: [],
  translateEnabled: false,
  theme: 'light',
}

/** 划词翻译中需要带上的“网页上下文片段” */
export interface TranslatePayload {
  text: string
  mode: TranslateMode
  /** 选中内容所在段落的文本（用于语境翻译） */
  snippet: string
  pageTitle: string
  pageUrl: string
}
