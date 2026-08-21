/**
 * 内置工具：get_page_context
 * 读取当前请求携带的页面上下文（现在由 UI/宿主注入；未来可改为工具主动向内容脚本拉取）。
 */
import { AgentTool } from '../AgentTool'
import { AgentRequest } from '../../agent/types'

export function createGetPageContextTool(): AgentTool {
  return {
    name: 'get_page_context',
    description:
      '获取当前网页的解析内容（标题、正文、代码块、大纲）。当用户问题涉及当前页面内容且上下文中缺少正文时使用。',
    parameters: {
      type: 'object',
      properties: {},
    },
    enabled: false, // 默认不启用；后续按需开启 function calling
    execute: (_args: unknown, ctx: AgentRequest) => {
      const pc = ctx.pageContext
      if (!pc) return Promise.resolve({ content: '当前无可用页面上下文' })
      const outline =
        pc.outline.length > 0
          ? '\n大纲：\n' + pc.outline.map((o) => `- ${o.text}`).join('\n')
          : ''
      return Promise.resolve({
        content:
          `标题：${pc.title}\n地址：${pc.url}\n字数：约 ${pc.wordCount} 词${outline}\n\n正文：\n${pc.text.slice(0, 12000)}`,
      })
    },
  }
}
