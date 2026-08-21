/**
 * 对话总结能力（Summarize）—— 对应历史协议的 summarize（导出 AI 精简总结）
 */
import { AgentContext } from '../agent/AgentContext'
import { AgentEvent, AgentRequest } from '../agent/types'
import { Capability } from './Capability'
import { buildSummarizePrompt, SUMMARIZE_SYSTEM } from '../../shared/prompts'

export class SummarizeCapability implements Capability {
  id = 'summarize'

  async *run(ctx: AgentContext, req: AgentRequest): AsyncGenerator<AgentEvent> {
    const history = req.history || []
    const conversation = history
      .map((m) => `【${m.role === 'user' ? '用户' : 'AI'}】\n${m.content}`)
      .join('\n\n')
    const meta = (req.meta || {}) as { title?: string; url?: string; domain?: string }
    const messages = [
      { role: 'system' as const, content: SUMMARIZE_SYSTEM },
      {
        role: 'user' as const,
        content: buildSummarizePrompt({
          pageTitle: meta.title || '',
          pageUrl: meta.url || '',
          domain: meta.domain || '',
          conversation,
        }),
      },
    ]
    yield* ctx.stream(req, messages)
  }
}
