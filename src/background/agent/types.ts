/**
 * 智能体核心类型（Agent Core）
 * 请求 / 事件模型：UI 与后台通过稳定的 AgentRequest + AgentEvent 交互，
 * 未来 Tools / Skills / MCP 都在这套模型上扩展。
 */
import {
  LLMChatMessage,
  ModelConfig,
  PageContext,
} from '../../shared/types'

/** 能力标识：与现状协议中的请求类型一一对应 */
export type AgentRequestKind =
  | 'chat'
  | 'summarize'
  | 'translate'
  | 'validate'
  | 'command'

export interface AgentRequest {
  /** 流式请求的会话 id（用于 abort）；一次性请求可省略 */
  id?: string
  kind: AgentRequestKind
  /** 用户输入（chat/command）或待处理内容 */
  input: string
  /** 会话历史（已裁剪的最近 N 条） */
  history?: LLMChatMessage[]
  /** 当前页面上下文（由 UI/宿主注入） */
  pageContext?: PageContext | null
  /** 本次启用的技能（缺省 = 全局默认启用的技能） */
  skillIds?: string[]
  /** 本次允许使用的工具（缺省 = 不启用工具调用） */
  toolNames?: string[]
  /** 是否允许模型主动发起工具调用（function calling） */
  allowTools?: boolean
  /** 能力专属载荷（如翻译原文、校验配置） */
  data?: unknown
  /** 页面/来源元信息（如总结导出的标题/URL/域名） */
  meta?: Record<string, unknown>
  /** 取消信号（端口断开/用户停止时置为 aborted） */
  signal?: AbortSignal
}

/** OpenAI 风格工具调用 */
export interface ToolCall {
  id: string
  name: string
  arguments: unknown
}

/** 工具执行结果（OpenAI/MCP 对齐） */
export interface AgentToolResult {
  content: string
  isError?: boolean
}

/** Agent 事件流：UI 通过订阅这些事件渲染输出 */
export type AgentEvent =
  | { type: 'chunk'; delta: string }
  | { type: 'tool-call'; tool: string; args: unknown }
  | { type: 'tool-result'; tool: string; ok: boolean }
  | { type: 'done'; content: string; toolOutput?: unknown }
  | { type: 'error'; message: string }

/** 工具调用循环最大迭代数（防死循环） */
export const MAX_TOOL_ITERATIONS = 8

/** 未配置模型时的提示文案（按能力区分，与历史协议文案保持一致） */
export const NO_CONFIG_MESSAGES: Partial<Record<AgentRequestKind, string>> = {
  chat: '尚未配置大模型，请点击插件图标打开配置面板完成设置',
  summarize: '尚未配置大模型，请先在插件配置面板完成设置',
  translate: '尚未配置大模型，请点击插件图标完成配置',
  validate: '尚未配置大模型，请点击插件图标完成配置',
  command: '尚未配置大模型，请点击插件图标打开配置面板完成设置',
}

export const DEFAULT_NO_CONFIG_MESSAGE = '尚未配置大模型，请点击插件图标打开配置面板完成设置'
