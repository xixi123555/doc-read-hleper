/**
 * 技能注册表（SkillRegistry）
 * 可插拔：load / unload / loadFromPack；按启用列表返回技能片段。
 * 未来可从文件/URL 导入技能包（Skill Pack），与 MCP 服务器动态发现呼应。
 */
import { Skill } from './Skill'

export class SkillRegistry {
  private skills = new Map<string, Skill>()

  load(skill: Skill): void {
    this.skills.set(skill.id, skill)
  }

  unload(id: string): void {
    this.skills.delete(id)
  }

  get(id: string): Skill | undefined {
    return this.skills.get(id)
  }

  all(): Skill[] {
    return [...this.skills.values()]
  }

  /** 返回启用技能：显式指定则用之，否则取默认启用集 */
  enabledFor(skillIds?: string[]): Skill[] {
    if (skillIds?.length) {
      return skillIds
        .map((id) => this.skills.get(id))
        .filter((s): s is Skill => !!s)
    }
    return this.all().filter((s) => s.enabledByDefault !== false)
  }

  /** 预留：从技能包（JSON）批量加载 */
  loadFromPack(pack: { skills: Skill[] }): void {
    for (const s of pack.skills) this.load(s)
  }
}
