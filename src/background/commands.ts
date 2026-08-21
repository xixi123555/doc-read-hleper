/**
 * 快捷指令注册表（QuickCommandRegistry）
 * 把「总结全文 / 解读知识点 / 翻译全文 / 代码解析 / 疑难答疑」沉淀为命令条目，
 * 每个命令关联推荐技能集；UI 仍使用 shared/prompts 的 QUICK_COMMANDS 渲染，
 * 后台按 commandId 解析技能（未来可在对话/命令能力中叠加技能）。
 */
import { QUICK_COMMANDS, QuickCommandDef } from '../shared/prompts'

export interface QuickCommandEntry extends QuickCommandDef {
  /** 执行该命令推荐叠加的技能 */
  skillIds: string[]
}

/** 命令 → 技能映射 */
export const COMMAND_SKILLS: Record<string, string[]> = {
  summarize: ['summarizer', 'tech-doc-reading'],
  explain: ['tech-doc-reading'],
  translate: ['translator'],
  code: ['code-analyst'],
  qa: ['tech-doc-reading'],
}

export class QuickCommandRegistry {
  private readonly entries = new Map<string, QuickCommandEntry>()

  constructor() {
    for (const c of QUICK_COMMANDS) {
      this.entries.set(c.id, { ...c, skillIds: COMMAND_SKILLS[c.id] || [] })
    }
  }

  resolve(id: string): QuickCommandEntry | undefined {
    return this.entries.get(id)
  }

  all(): QuickCommandEntry[] {
    return [...this.entries.values()]
  }
}
