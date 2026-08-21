/**
 * 配置校验能力（Validate）—— 对应历史协议的 validate
 */
import { AgentContext } from '../agent/AgentContext'
import { AgentEvent, AgentRequest } from '../agent/types'
import { Capability } from './Capability'
import { ModelConfig } from '../../shared/types'
import { decryptText } from '../../shared/crypto'

export class ValidateCapability implements Capability {
  id = 'validate'

  async *run(ctx: AgentContext, req: AgentRequest): AsyncGenerator<AgentEvent> {
    const cfg = (req.data || {}) as ModelConfig
    try {
      const decrypted: ModelConfig = { ...cfg, apiKey: await decryptText(cfg.apiKey || '') }
      const r = await ctx.provider.validate(decrypted)
      yield { type: 'done', content: '', toolOutput: r }
    } catch (e: any) {
      yield { type: 'error', message: e?.message || '校验失败' }
    }
  }
}
