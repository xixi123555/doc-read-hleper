/**
 * 工具注册表（ToolRegistry）
 * 可插拔：register / unregister / execute；MCP 工具通过 syncFromMcp 动态注入。
 */
import { AgentTool, ToolParameterSchema } from './AgentTool'
import { AgentRequest, AgentToolResult } from '../agent/types'

export interface ToolSchema {
  name: string
  description: string
  parameters: ToolParameterSchema
}

export class ToolRegistry {
  private tools = new Map<string, AgentTool>()

  register(tool: AgentTool): void {
    this.tools.set(tool.name, tool)
  }

  unregister(name: string): void {
    this.tools.delete(name)
  }

  get(name: string): AgentTool | undefined {
    return this.tools.get(name)
  }

  all(): AgentTool[] {
    return [...this.tools.values()]
  }

  /** 组装给模型的工具 schema（仅返回本次允许/默认启用的工具） */
  schemasFor(names?: string[]): ToolSchema[] {
    let list: AgentTool[]
    if (names?.length) {
      list = names.map((n) => this.tools.get(n)).filter((t): t is AgentTool => !!t)
    } else {
      list = this.all().filter((t) => t.enabled !== false)
    }
    return list.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }))
  }

  async execute(
    name: string,
    args: unknown,
    ctx: AgentRequest,
  ): Promise<AgentToolResult> {
    const tool = this.tools.get(name)
    if (!tool) return { content: `工具不存在：${name}`, isError: true }
    try {
      return await tool.execute(args, ctx)
    } catch (e: any) {
      return { content: `工具执行失败：${e?.message || String(e)}`, isError: true }
    }
  }

  /** MCP 预留入口：将某 MCP 服务器的工具同步进注册表 */
  syncFromMcp(serverId: string, tools: AgentTool[]): void {
    for (const t of tools) this.register({ ...t, name: `${serverId}__${t.name}` })
  }

  /** MCP 预留入口：移除某服务器的全部工具 */
  unsyncFromMcp(serverId: string): void {
    for (const name of [...this.tools.keys()]) {
      if (name.startsWith(`${serverId}__`)) this.tools.delete(name)
    }
  }
}
