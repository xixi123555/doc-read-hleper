/**
 * Provider 工厂：按 ModelConfig.protocol 路由到对应实现。
 * 新增服务商 = 实现 ChatProvider + 在此注册，Agent 核心与 UI 无需改动。
 */
import { ModelConfig } from '../../shared/types'
import { ChatProvider } from './ChatProvider'
import { OpenAIChatProvider } from './OpenAIChatProvider'

export class ProviderFactory {
  private readonly openai = new OpenAIChatProvider()

  create(cfg: ModelConfig): ChatProvider {
    const protocol = cfg.protocol || 'openai'
    if (protocol === 'anthropic') {
      // 预留：Anthropic 协议（含 DeepSeek /anthropic 端点）
      throw new Error('Anthropic 协议尚未接入，请使用 OpenAI 兼容接口（base_url 填 OpenAI 列）')
    }
    return this.openai
  }
}
