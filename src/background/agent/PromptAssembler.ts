/**
 * 提示词组装器（PromptAssembler）
 * 职责：
 *  - assembleSystem：基础人设 + 启用的技能片段（Skills）叠加
 *  - buildMessages：系统提示 + 页面上下文块 + 历史 + 最新输入
 */
import { LLMChatMessage, PageContext } from '../../shared/types'
import { buildPageBlock } from '../../shared/prompts'
import { Skill } from '../skills/Skill'

/** 基础系统提示词（极简助手角色；具体能力由技能提供） */
export const BASE_SYSTEM_PROMPT =
  '你是「AI 网页阅读助手」，一名专业的网页内容解读与辅助阅读 Agent。'

export interface AssembleOptions {
  base?: string
  skills: Skill[]
}

export class PromptAssembler {
  /** 组装系统提示词：基础人设 + 各技能片段 */
  static assemble(opts: AssembleOptions): string {
    const parts: string[] = []
    const base = (opts.base ?? BASE_SYSTEM_PROMPT).trim()
    if (base) parts.push(base)
    for (const s of opts.skills) {
      const frag = s.systemPrompt.trim()
      if (frag) parts.push(frag)
    }
    return parts.join('\n\n')
  }

  /** 组装对话 messages：system + 历史（去上下文块）+ 最新输入（挂页面上下文块） */
  static build(opts: {
    sysPrompt: string
    pageBlock?: string
    history?: LLMChatMessage[]
    input: string
  }): LLMChatMessage[] {
    const messages: LLMChatMessage[] = [{ role: 'system', content: opts.sysPrompt }]
    const cleanHistory = (opts.history || []).filter(
      (m) => m.role !== 'system' && !m.content.startsWith('【网页内容】'),
    )
    messages.push(...cleanHistory.slice(-12))
    const block = opts.pageBlock ? `${opts.pageBlock}\n\n` : ''
    messages.push({ role: 'user', content: `${block}【用户提问】\n${opts.input}` })
    return messages
  }

  /** 生成页面上下文块（含预算截断） */
  static pageBlock(ctx: PageContext | null | undefined, budgetChars: number): string {
    if (!ctx) return ''
    const text =
      ctx.text.length > budgetChars ? ctx.text.slice(0, Math.floor(budgetChars)) : ctx.text
    return buildPageBlock({ ...ctx, text, truncated: ctx.truncated || text.length < ctx.text.length })
  }
}
