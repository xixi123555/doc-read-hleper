/**
 * MCP 管理器（预留骨架）
 * 目标：连接 MCP 服务器 → listTools 发现工具 → 注入 ToolRegistry（Adapter → Registry 桥接）。
 * 本期只定义标准接口与生命周期骨架，不引入具体传输实现；
 * 后续落地 stdio / SSE / HTTP 传输时各自实现 MCPAdapter，Agent 核心与 UI 零改动。
 */
import { AgentTool } from '../tools/AgentTool'

export interface MCPServerConfig {
  id: string
  name: string
  transport: 'stdio' | 'sse' | 'http'
  url?: string
  command?: string
  enabled: boolean
}

export interface MCPServerTool {
  name: string
  description: string
  parameters: AgentTool['parameters']
}

export interface MCPAdapter {
  connect(): Promise<void>
  disconnect(): Promise<void>
  listTools(): Promise<MCPServerTool[]>
  callTool(name: string, args: unknown): Promise<{ content: string; isError?: boolean }>
}

export class MCPManager {
  private readonly adapters = new Map<string, MCPAdapter>()
  private readonly configs = new Map<string, MCPServerConfig>()

  configure(cfg: MCPServerConfig): void {
    this.configs.set(cfg.id, cfg)
  }

  /** 连接服务器并把其工具注入 ToolRegistry（每个工具包装为 AgentTool 代理） */
  async connectServer(id: string, toolRegistry: { syncFromMcp(serverId: string, tools: AgentTool[]): void }): Promise<void> {
    const cfg = this.configs.get(id)
    if (!cfg) throw new Error(`未知 MCP 服务器：${id}`)
    const adapter = await this.createAdapter(cfg)
    await adapter.connect()
    const tools = await adapter.listTools()
    const wrapped: AgentTool[] = tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      execute: (args: unknown) => adapter.callTool(t.name, args),
    }))
    toolRegistry.syncFromMcp(id, wrapped)
    this.adapters.set(id, adapter)
  }

  async disconnectServer(id: string, toolRegistry: { unsyncFromMcp(serverId: string): void }): Promise<void> {
    const adapter = this.adapters.get(id)
    if (adapter) {
      await adapter.disconnect()
      this.adapters.delete(id)
    }
    toolRegistry.unsyncFromMcp(id)
  }

  listConfigs(): MCPServerConfig[] {
    return [...this.configs.values()]
  }

  /** 预留：按传输类型创建适配器（stdio/SSE/HTTP 各自实现） */
  private async createAdapter(_cfg: MCPServerConfig): Promise<MCPAdapter> {
    throw new Error('MCP 传输适配器为预留能力，尚未接入具体实现')
  }
}
