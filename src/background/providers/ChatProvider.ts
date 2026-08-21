/**
 * 模型服务商抽象（ChatProvider）
 * 适配器模式：OpenAI 兼容 / Anthropic / 未来任意服务商实现同一接口。
 */
import { LLMChatMessage, ModelConfig } from '../../shared/types'
import { ToolCall } from '../agent/types'

export type ProviderEvent =
  | { kind: 'delta'; text: string }
  | { kind: 'tool-calls'; calls: ToolCall[] }

export interface ChatProvider {
  readonly id: 'openai-compatible' | 'anthropic' | string
  /** 流式对话：产出 delta / tool-calls 事件 */
  stream(
    messages: LLMChatMessage[],
    cfg: ModelConfig,
    signal?: AbortSignal,
  ): AsyncGenerator<ProviderEvent>
  /** 非流式对话：一次返回完整文本 */
  complete(
    messages: LLMChatMessage[],
    cfg: ModelConfig,
    signal?: AbortSignal,
  ): Promise<string>
  /** 连通性校验 */
  validate(cfg: ModelConfig): Promise<{ ok: boolean; message: string; latencyMs: number }>
}
