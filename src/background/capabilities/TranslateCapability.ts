/**
 * 划词翻译能力（Translate）—— 对应历史协议的 translate（一次性，JSON 结构化结果）
 */
import { AgentContext } from '../agent/AgentContext'
import { AgentEvent, AgentRequest } from '../agent/types'
import { Capability } from './Capability'
import { buildTranslationPrompt, TRANSLATION_SYSTEM } from '../../shared/prompts'
import { LLMError, parseLooseJson } from '../llm'
import { TranslatePayload } from '../../shared/types'

export class TranslateCapability implements Capability {
  id = 'translate'

  async *run(ctx: AgentContext, req: AgentRequest): AsyncGenerator<AgentEvent> {
    const payload = (req.data || {}) as Partial<TranslatePayload>
    const messages = [
      { role: 'system' as const, content: TRANSLATION_SYSTEM },
      {
        role: 'user' as const,
        content: buildTranslationPrompt({
          text: payload.text || '',
          mode: (payload.mode || 'phrase') as TranslatePayload['mode'],
          snippet: payload.snippet || '',
          pageTitle: payload.pageTitle || '',
        }),
      },
    ]
    try {
      const raw = await ctx.completeOnce(req, messages)
      const json = parseLooseJson(raw)
      if (!json || typeof json !== 'object') throw new LLMError('翻译结果解析失败')
      yield { type: 'done', content: '', toolOutput: { ok: true, data: json } }
    } catch (e: any) {
      yield { type: 'error', message: e?.message || '翻译失败' }
    }
  }
}
