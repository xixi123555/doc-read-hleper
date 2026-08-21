/**
 * Agent 提示词与快捷指令模板。
 */
import { LLMChatMessage, PageContext } from './types'

export const SYSTEM_PROMPT = `你是「AI 网页阅读助手」，一名专业的网页内容解读与辅助阅读 Agent。
你的职责：
1. 基于用户提供的【网页内容】回答技术文档、开源文档、技术博客、教程类网页中的问题；
2. 回答必须紧扣网页上下文，不脱离页面内容编造；网页未提及的内容请明确说明；
3. 支持代码解读、纠错、举例改写、专业术语解析、长文档分段总结、英文翻译；
4. 涉及代码时使用 Markdown 代码块并标注语言，给出清晰注释；
5. 回答语言：默认跟随用户提问语言；用户用中文提问则用中文回答，英文提问用英文回答；
6. 优先引用网页中的章节标题定位答案出处（形如：见「标题」章节）；
7. 输出使用简洁的 Markdown 格式，结构清晰、重点突出，避免冗长客套。`

/** 把解析后的页面上下文组装为发给模型的网页内容块 */
export function buildPageBlock(ctx: PageContext): string {
  const parts: string[] = []
  parts.push(`【网页标题】${ctx.title}`)
  parts.push(`【网页地址】${ctx.url}`)
  if (ctx.lang) parts.push(`【网页语言】${ctx.lang}`)
  parts.push(`【字数统计】约 ${ctx.wordCount} 词`)
  if (ctx.outline.length) {
    parts.push(
      '【页面大纲】\n' +
        ctx.outline
          .map((o) => `${'  '.repeat(Math.max(0, o.level - 1))}- ${o.text}`)
          .join('\n'),
    )
  }
  parts.push(`【正文内容】\n${ctx.text}`)
  if (ctx.codeBlocks.length) {
    parts.push(
      '【代码块清单】\n' +
        ctx.codeBlocks
          .map((c, i) => `代码块 ${i + 1}（${c.lang || '未知语言'}）：\n${c.code}`)
          .join('\n\n'),
    )
  }
  if (ctx.truncated) {
    parts.push('（注：页面过长，正文已截断，仅保留关键内容）')
  }
  return parts.join('\n\n')
}

export interface QuickCommandDef {
  id: string
  label: string
  icon: string
  /** 直接发送给模型的指令文本 */
  prompt: string
}

export const QUICK_COMMANDS: QuickCommandDef[] = [
  {
    id: 'summarize',
    label: '总结全文',
    icon: '📝',
    prompt:
      '请对当前网页内容做一次高质量总结：先用一句话概括主题，再按章节梳理核心知识点、关键结论、使用场景与注意事项，最后列出最重要的 3-5 个要点。使用 Markdown 分节输出。',
  },
  {
    id: 'explain',
    label: '解读核心知识点',
    icon: '🧠',
    prompt:
      '请解读当前网页的核心知识点：识别关键技术概念、API 用法、语法规则，逐条用通俗语言解释，并给出与网页内容对应的例子。使用 Markdown 输出。',
  },
  {
    id: 'translate',
    label: '翻译全文',
    icon: '🌐',
    prompt:
      '请将当前网页的正文内容完整翻译为中文（保留代码块、专有名词与技术术语不译），按段落输出原文与译文对照，并标注关键术语的译法。使用 Markdown 输出。',
  },
  {
    id: 'code',
    label: '代码解析',
    icon: '💻',
    prompt:
      '请解析当前网页中的代码块：说明每段代码的功能、关键实现思路、易错点，必要时给出改进示例或运行说明。使用 Markdown 输出，代码块标注语言。',
  },
  {
    id: 'qa',
    label: '疑难答疑',
    icon: '❓',
    prompt:
      '请针对当前网页内容，模拟一位初学者最可能提出的 3-5 个疑难问题并给出解答；随后请我继续提问，你将基于网页上下文精准作答。使用 Markdown 输出。',
  },
]

export function quickCommandById(id: string): QuickCommandDef | undefined {
  return QUICK_COMMANDS.find((c) => c.id === id)
}

/** 组装一次对话请求的 messages（页面上下文 + 历史 + 最新提问） */
export function buildChatMessages(opts: {
  pageBlock: string
  history: LLMChatMessage[]
  question: string
}): LLMChatMessage[] {
  const messages: LLMChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }]
  // 历史中已包含上下文块的 user 消息会被替换掉：这里把页面块挂在最新提问里
  const cleanHistory = opts.history.filter(
    (m) => m.role !== 'system' && !m.content.startsWith('【网页内容】'),
  )
  messages.push(...cleanHistory.slice(-12))
  messages.push({
    role: 'user',
    content: `【网页内容】\n${opts.pageBlock}\n\n【用户提问】\n${opts.question}`,
  })
  return messages
}

/* ---------------- 划词翻译 ---------------- */

export const TRANSLATION_SYSTEM = `你是专业的英文技术文档翻译助手。请根据【网页上下文】理解所选英文的准确含义，并按 JSON 输出翻译结果。
规则：
1. 只输出 JSON，不要输出任何其他文字；
2. 单词模式：给出英美音标（uk/us，使用 IPA）、多义项直译列表（meanings，每项含词性与释义）、结合上下文的释义（usage）、上下文语境翻译（contextual，一句中文）；
3. 短语/短句模式：给出直译（literal，一句中文）、贴合技术场景的意译（contextual）；
4. 长段模式：给出精简直译（literal，一句中文概括核心含义）、通顺的上下文翻译（contextual，完整通顺中文翻译）；
5. 技术术语优先采用行业通用译法。`

export function buildTranslationPrompt(payload: {
  text: string
  mode: 'word' | 'phrase' | 'long'
  snippet: string
  pageTitle: string
}): string {
  return `【网页上下文】
页面标题：${payload.pageTitle}
选中文字所在段落：${payload.snippet || '（无）'}

【所选英文】（${payload.mode === 'word' ? '单词' : payload.mode === 'phrase' ? '短语/短句' : '长段文本'}）：
${payload.text}

请输出 JSON：${
    payload.mode === 'word'
      ? '{"mode":"word","phonetics":{"uk":"","us":""},"literal":[{"pos":"词性","meaning":"释义"}],"usage":"结合上下文的释义","contextual":"上下文语境翻译"}'
      : payload.mode === 'phrase'
        ? '{"mode":"phrase","literal":"直译","contextual":"上下文意译"}'
        : '{"mode":"long","literal":"精简直译","contextual":"通顺的上下文翻译"}'
  }`
}

/* ---------------- 对话总结导出 ---------------- */

export const SUMMARIZE_SYSTEM = `你是对话总结专家。请阅读用户提供的一段「AI 网页阅读助手」对话记录，提炼生成结构化 Markdown 总结文档。
输出结构（Markdown）：
## 核心问题
- 列出对话中用户提出的核心问题

## 关键结论
- 逐条列出 AI 给出的关键结论

## 技术知识点
- 对话中涉及的技术概念、API、术语，每条一句话说明

## 解决方案 / 实践建议
- 对话中讨论的问题解决方案、代码要点、注意事项

要求：忠实于对话内容，不编造；语言与对话语言一致；使用简洁的列表与代码块。`

export function buildSummarizePrompt(opts: {
  pageTitle: string
  pageUrl: string
  domain: string
  conversation: string
}): string {
  return `【对话来源】
页面标题：${opts.pageTitle}
页面地址：${opts.pageUrl}
域名：${opts.domain}

【完整对话记录】
${opts.conversation}

请输出结构化 Markdown 总结文档。`
}
