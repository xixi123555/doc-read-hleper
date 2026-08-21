/**
 * AgentContext：单次运行上下文（依赖注入 + 能力访问门面）
 * 能力通过它访问：技能组装、提示词构建、流式/非流式 Provider 调用、工具循环。
 */
import { LLMChatMessage, ModelConfig } from '../../shared/types'
import { AgentEvent, AgentRequest } from './types'
import { PromptAssembler } from './PromptAssembler'
import { SkillRegistry } from '../skills/SkillRegistry'
import { ToolRegistry } from '../tools/ToolRegistry'
import { AgentRuntime } from './AgentRuntime'

export class AgentContext {
  constructor(
    private readonly runtime: AgentRuntime,
    readonly req: AgentRequest,
    readonly cfg: ModelConfig,
    readonly budgetChars: number,
  ) {}

  get skills(): SkillRegistry {
    return this.runtime.skillRegistry
  }

  get tools(): ToolRegistry {
    return this.runtime.toolRegistry
  }

  /** 当前配置对应的 Provider（按协议路由） */
  get provider(): ReturnType<AgentRuntime['createProvider']> {
    return this.runtime.createProvider(this.cfg)
  }

  /** 组装系统提示词：基础人设 + 启用技能片段 */
  assembleSystem(skillIds?: string[]): string {
    return PromptAssembler.assemble({ skills: this.skills.enabledFor(skillIds) })
  }

  /** 组装对话 messages（含页面上下文块与历史） */
  buildMessages(opts: {
    sysPrompt: string
    pageBlock?: string
    history?: LLMChatMessage[]
    input: string
  }): LLMChatMessage[] {
    return PromptAssembler.build(opts)
  }

  /** 流式 + 工具循环 */
  stream(req: AgentRequest, messages: LLMChatMessage[]): AsyncGenerator<AgentEvent> {
    return this.runtime.streamWithTools(this.cfg, req, messages)
  }

  /** 非流式一次性调用 */
  completeOnce(req: AgentRequest, messages: LLMChatMessage[]): Promise<string> {
    return this.runtime.completeOnce(this.cfg, req, messages)
  }
}
