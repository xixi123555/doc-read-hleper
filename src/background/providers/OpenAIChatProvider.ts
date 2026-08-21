/**
 * OpenAI 兼容协议 Provider（现行默认）
 * 包装 src/background/llm.ts 传输层：SSE 流式 / 非流式 JSON 回退 / 超时 / 错误容错。
 */
import { LLMChatMessage, ModelConfig } from '../../shared/types'
import { ChatProvider, ProviderEvent } from './ChatProvider'
import { chatLLM, streamChatLLM, validateConfig } from '../llm'

export class OpenAIChatProvider implements ChatProvider {
  readonly id = 'openai-compatible' as const

  async *stream(
    messages: LLMChatMessage[],
    cfg: ModelConfig,
    signal?: AbortSignal,
  ): AsyncGenerator<ProviderEvent> {
    for await (const delta of streamChatLLM(cfg, messages, { signal })) {
      yield { kind: 'delta', text: delta }
    }
  }

  complete(messages: LLMChatMessage[], cfg: ModelConfig, signal?: AbortSignal): Promise<string> {
    return chatLLM(cfg, messages, { signal })
  }

  validate(cfg: ModelConfig) {
    return validateConfig(cfg)
  }
}
