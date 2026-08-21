/**
 * 能力（Capability）接口
 * 能力 = 一类用户用例（对话/总结/翻译/校验…）。
 * 新增能力 = 实现本接口并注册到 CapabilityRegistry，核心与 UI 无需改动。
 */
import { AgentContext } from '../agent/AgentContext'
import { AgentEvent, AgentRequest } from '../agent/types'

export interface Capability {
  id: string
  run(ctx: AgentContext, req: AgentRequest): AsyncGenerator<AgentEvent>
}

export class CapabilityRegistry {
  private caps = new Map<string, Capability>()

  register(cap: Capability): void {
    this.caps.set(cap.id, cap)
  }

  get(id: string): Capability | undefined {
    return this.caps.get(id)
  }
}
