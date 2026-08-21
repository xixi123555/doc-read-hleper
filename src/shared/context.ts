/**
 * 上下文预算工具（P0-2 防崩溃加固）
 * 宿主 / 对话窗 / 后台共用同一份截断逻辑：
 * 宿主提取后立即按预算裁剪，避免整页全量上下文在
 * storage.session / postMessage / 端口消息中被复制多份。
 */
import { PageContext } from './types'

/** 粗略 token 估算：ASCII 每 4 字符 1 token，CJK 每 1.5 字符 1 token */
export function estimateTokens(text: string): number {
  let ascii = 0
  let cjk = 0
  for (const ch of text) {
    const code = ch.codePointAt(0)!
    if (code < 128) ascii++
    else cjk++
  }
  return Math.ceil(ascii / 4) + Math.ceil(cjk / 1.5)
}

/** 依据模型 maxTokens 预算计算可用字符数（预留回复 800 token） */
export function resolveContextChars(maxTokens: number): number {
  return Math.max(1500, (maxTokens - 800) * 3 * 0.8)
}

/** 依据 maxTokens 预算裁剪页面正文 */
export function truncateContextText(
  text: string,
  maxTokens: number,
): { text: string; truncated: boolean } {
  const budgetChars = resolveContextChars(maxTokens)
  if (text.length <= budgetChars) return { text, truncated: false }
  return { text: text.slice(0, Math.floor(budgetChars)), truncated: true }
}

/** 宿主侧提前截断：避免全量上下文跨进程传输 */
export function applyContextBudget(ctx: PageContext, maxTokens: number): PageContext {
  const t = truncateContextText(ctx.text, maxTokens)
  if (!t.truncated) return ctx
  return { ...ctx, text: t.text, truncated: true }
}

/** 默认上下文预算（读不到模型配置时使用，约 8192 token 档位） */
export const DEFAULT_CONTEXT_MAX_TOKENS = 8192
