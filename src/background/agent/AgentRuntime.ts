/**
 * 智能体运行时（AgentRuntime）—— 后台 AI 能力唯一入口（门面）
 *
 * 生命周期状态机：
 *   IDLE → RESOLVE_CONFIG → ASSEMBLING → STREAMING ⇄ TOOL_CALL → DONE / ERROR
 *
 * 职责：
 *  - 解析生效模型配置（含密钥解密）与上下文预算
 *  - 按请求能力（Capability）分派执行
 *  - 统一提供 流式 + 工具调用循环（ToolLoop，为 Tools / MCP 挂载点）
 *  - 维护请求级 AbortController（abort / abortAll）
 */
import { LLMChatMessage, ModelConfig } from '../../shared/types'
import { resolveContextChars } from '../../shared/context'
import { decryptText } from '../../shared/crypto'
import {
  AgentEvent,
  AgentRequest,
  AgentToolResult,
  DEFAULT_NO_CONFIG_MESSAGE,
  MAX_TOOL_ITERATIONS,
  NO_CONFIG_MESSAGES,
  ToolCall,
} from './types'
import { AgentContext } from './AgentContext'
import { CapabilityRegistry } from '../capabilities/Capability'
import { SkillRegistry } from '../skills/SkillRegistry'
import { ToolRegistry } from '../tools/ToolRegistry'
import { ProviderFactory } from '../providers/ProviderFactory'
import { ChatProvider } from '../providers/ChatProvider'
import { LoggerLike } from './types-logger'

/** 配置存储最小接口（由 ConfigStore / STORAGE 满足） */
export interface ConfigStoreLike {
  getActiveConfig(): Promise<ModelConfig | null>
}

export interface AgentDeps {
  providerFactory: ProviderFactory
  capabilities: CapabilityRegistry
  skillRegistry: SkillRegistry
  toolRegistry: ToolRegistry
  configStore: ConfigStoreLike
  logger?: LoggerLike
}

export class AgentRuntime {
  private readonly active = new Map<string, AbortController>()

  constructor(private readonly deps: AgentDeps) {}

  /** 注册表访问（供 AgentContext 使用） */
  get skillRegistry(): SkillRegistry {
    return this.deps.skillRegistry
  }

  get toolRegistry(): ToolRegistry {
    return this.deps.toolRegistry
  }

  /** 创建 Provider（按配置协议路由） */
  createProvider(cfg: ModelConfig): ChatProvider {
    return this.deps.providerFactory.create(cfg)
  }

  /** 唯一入口：按请求能力分派，返回事件流 */
  async *handle(req: AgentRequest): AsyncGenerator<AgentEvent> {
    // validate 校验的是请求自带的配置，不依赖已保存的活跃配置
    let resolved: ModelConfig
    if (req.kind === 'validate') {
      resolved = (req.data || {}) as ModelConfig
    } else {
      const cfg = await this.deps.configStore.getActiveConfig()
      if (!cfg) {
        yield { type: 'error', message: NO_CONFIG_MESSAGES[req.kind] || DEFAULT_NO_CONFIG_MESSAGE }
        return
      }
      resolved = { ...cfg, apiKey: await decryptText(cfg.apiKey || '') }
    }
    const budgetChars = resolveContextChars(resolved.maxTokens || 4096)
    const ctx = new AgentContext(this, req, resolved, budgetChars)
    const cap = this.deps.capabilities.get(req.kind)
    if (!cap) {
      yield { type: 'error', message: `未知能力：${req.kind}` }
      return
    }
    yield* cap.run(ctx, req)
  }

  /** 中止指定请求（用户停止/端口断开） */
  abort(id?: string): void {
    if (!id) return
    this.active.get(id)?.abort()
    this.active.delete(id)
  }

  /** 中止全部请求（端口断开） */
  abortAll(): void {
    for (const c of this.active.values()) c.abort()
    this.active.clear()
  }

  /* ---------------- 供 AgentContext 调用的内部能力 ---------------- */

  private registerCtrl(req: AgentRequest): AbortController {
    const ctrl = new AbortController()
    if (req.id) this.active.set(req.id, ctrl)
    return ctrl
  }

  /** 流式 + 工具调用循环（ToolLoop）：能力统一走这里 */
  async *streamWithTools(
    cfg: ModelConfig,
    req: AgentRequest,
    messages: LLMChatMessage[],
  ): AsyncGenerator<AgentEvent> {
    const ctrl = this.registerCtrl(req)
    const signal = req.signal || ctrl.signal
    const provider = this.createProvider(cfg)
    let iteration = 0
    let full = ''
    for (;;) {
      let calls: ToolCall[] | null = null
      try {
        for await (const ev of provider.stream(messages, cfg, signal)) {
          if (ev.kind === 'delta') {
            full += ev.text
            yield { type: 'chunk', delta: ev.text }
          } else if (ev.kind === 'tool-calls') {
            calls = ev.calls
          }
        }
      } finally {
        if (req.id) this.active.delete(req.id)
      }
      if (calls?.length && (req.toolNames?.length || req.allowTools)) {
        if (++iteration > MAX_TOOL_ITERATIONS) {
          yield { type: 'error', message: '工具调用次数超限，已停止' }
          return
        }
        for (const call of calls) {
          yield { type: 'tool-call', tool: call.name, args: call.arguments }
          const r: AgentToolResult = await this.deps.toolRegistry.execute(call.name, call.arguments, req)
          yield { type: 'tool-result', tool: call.name, ok: !r.isError }
          messages.push({ role: 'assistant', content: '', tool_calls: [call] })
          messages.push({ role: 'tool', tool_call_id: call.id, content: r.content })
        }
        continue // 工具结果回填后再次请求模型
      }
      yield { type: 'done', content: full }
      return
    }
  }

  /** 非流式一次性调用（翻译/校验等） */
  async completeOnce(
    cfg: ModelConfig,
    req: AgentRequest,
    messages: LLMChatMessage[],
  ): Promise<string> {
    const ctrl = this.registerCtrl(req)
    try {
      return await this.createProvider(cfg).complete(messages, cfg, req.signal || ctrl.signal)
    } finally {
      if (req.id) this.active.delete(req.id)
    }
  }
}
