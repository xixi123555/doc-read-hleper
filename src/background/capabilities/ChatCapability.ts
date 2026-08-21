/**
 * 对话能力（Chat）—— 对应历史协议的 llm-chat
 */
import { AgentContext } from '../agent/AgentContext'
import { AgentEvent, AgentRequest } from '../agent/types'
import { Capability } from './Capability'
import { PromptAssembler } from '../agent/PromptAssembler'

export class ChatCapability implements Capability {
  id = 'chat'

  async *run(ctx: AgentContext, req: AgentRequest): AsyncGenerator<AgentEvent> {
    const sysPrompt = ctx.assembleSystem(req.skillIds)
    const pageBlock = PromptAssembler.pageBlock(req.pageContext, ctx.budgetChars)
    const messages = ctx.buildMessages({
      sysPrompt,
      pageBlock,
      history: req.history,
      input: req.input,
    })
    yield* ctx.stream(req, messages)
  }
}
