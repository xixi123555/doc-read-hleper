/**
 * 内置技能包（把现有的提示词工程沉淀为可插拔技能）
 * 默认启用 tech-doc-reading，组装结果与历史行为保持一致。
 */
import { Skill } from '../Skill'
import { SYSTEM_PROMPT } from '../../../shared/prompts'

export const BUILTIN_SKILLS: Skill[] = [
  {
    id: 'tech-doc-reading',
    name: '技术文档阅读',
    description: '章节定位作答、代码解读/纠错/改写、术语解析、Markdown 输出规范',
    systemPrompt: SYSTEM_PROMPT,
    enabledByDefault: true,
  },
  {
    id: 'summarizer',
    name: '长文档总结',
    description: '分层总结模板：主题 → 章节核心 → 关键结论 → 使用场景与注意事项',
    systemPrompt:
      '当需要总结时，请按以下结构输出：\n' +
      '1. **一句话主题概括**\n' +
      '2. **按章节梳理核心知识点**（引用网页章节标题）\n' +
      '3. **关键结论与使用场景**\n' +
      '4. **注意事项**\n' +
      '5. **最重要的 3-5 个要点**\n' +
      '使用 Markdown 分节输出，保持简洁。',
    enabledByDefault: true,
  },
  {
    id: 'translator',
    name: '英文翻译',
    description: '术语译法、直译/意译双轨、单词音标、JSON 结构化输出',
    systemPrompt:
      '翻译时遵循：技术术语优先采用行业通用译法；区分直译与贴合网页上下文的意译；' +
      '涉及单词时给出英美音标；输出结构化结果时严格遵循要求，不要添加多余文字。',
    enabledByDefault: true,
  },
  {
    id: 'code-analyst',
    name: '代码解析',
    description: '代码功能/关键思路/易错点/改进示例',
    systemPrompt:
      '解析代码时：说明代码功能、关键实现思路、易错点；' +
      '必要时给出改进示例或运行说明；使用 Markdown 输出并标注代码语言。',
    enabledByDefault: false,
  },
]

export function loadBuiltinSkills(registry: { load(skill: Skill): void }): void {
  for (const s of BUILTIN_SKILLS) registry.load(s)
}
