/**
 * 工具调用接口（OpenAI function calling / MCP 对齐的 JSON Schema）
 */
export interface ToolParameterSchema {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
}

export interface AgentTool {
  /** 工具名（模型调用时使用，如 get_page_context） */
  name: string
  /** 工具描述（注入提示词，帮助模型决定何时调用） */
  description: string
  /** 参数 JSON Schema */
  parameters: ToolParameterSchema
  /** 默认启用（未显式指定工具列表时是否可用） */
  enabled?: boolean
  execute(args: unknown, ctx: unknown): Promise<{ content: string; isError?: boolean }>
}
