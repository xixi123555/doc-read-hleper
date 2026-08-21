/**
 * 技能接口（Skills）
 * 技能 = 一组注入系统提示词的指令片段 + 推荐的快捷指令。
 * 支持运行时加载/卸载（SkillRegistry.load / unload / loadFromPack）。
 */
import { QuickCommandDef } from '../../shared/prompts'

export interface Skill {
  id: string
  name: string
  description: string
  /** 注入系统提示词的片段（技能的核心） */
  systemPrompt: string
  /** 技能推荐的快捷指令 */
  suggestedCommands?: QuickCommandDef[]
  /** 默认启用（未在设置中显式开关时） */
  enabledByDefault?: boolean
}
