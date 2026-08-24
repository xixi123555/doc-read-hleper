/**
 * 后台装配根（Manifest V3, ESM）
 * 职责收敛为：创建依赖 → 注册能力 → 挂载路由/端口/快捷键。
 * 所有 AI 能力经由 AgentRuntime（智能体）统一执行。
 */
import { STORAGE } from './state'
import { logger } from '../shared/logger'
import { RT } from '../shared/msg'
import { AgentRuntime } from './agent/AgentRuntime'
import { CapabilityRegistry } from './capabilities/Capability'
import { ChatCapability } from './capabilities/ChatCapability'
import { SummarizeCapability } from './capabilities/SummarizeCapability'
import { TranslateCapability } from './capabilities/TranslateCapability'
import { ValidateCapability } from './capabilities/ValidateCapability'
import { ProviderFactory } from './providers/ProviderFactory'
import { SkillRegistry } from './skills/SkillRegistry'
import { loadBuiltinSkills } from './skills/skills/builtin'
import { ToolRegistry } from './tools/ToolRegistry'
import { createGetPageContextTool } from './tools/tools/getPageContextTool'
import { QuickCommandRegistry } from './commands'
import { MCPManager } from './mcp/MCPManager'
import { MessageRouter } from './router/MessageRouter'
import { PortHub } from './router/PortHub'
import { AgentRequest } from './agent/types'

/* ---------------- 依赖装配 ---------------- */

const providerFactory = new ProviderFactory()

const skillRegistry = new SkillRegistry()
loadBuiltinSkills(skillRegistry)

const toolRegistry = new ToolRegistry()
toolRegistry.register(createGetPageContextTool())

const capabilities = new CapabilityRegistry()
capabilities.register(new ChatCapability())
capabilities.register(new SummarizeCapability())
capabilities.register(new TranslateCapability())
capabilities.register(new ValidateCapability())

const quickCommands = new QuickCommandRegistry()
// MCP 预留：本期仅装配管理器，不连接任何服务器
const mcpManager = new MCPManager()

const runtime = new AgentRuntime({
  providerFactory,
  capabilities,
  skillRegistry,
  toolRegistry,
  configStore: STORAGE,
  logger,
})

/* ---------------- 一次性消息路由（translate / validate / get-tab-id） ---------------- */

const router = new MessageRouter()

/** 消费 Agent 事件流，返回最后一个 done 的 toolOutput 或首个 error */
async function runOnce(req: AgentRequest): Promise<{ ok: boolean; data?: unknown; message?: string }> {
  let result: { ok: boolean; data?: unknown; message?: string } = { ok: false, message: '请求失败' }
  for await (const ev of runtime.handle(req)) {
    if (ev.type === 'done' && ev.toolOutput) result = ev.toolOutput as { ok: boolean; data?: unknown; message?: string }
    if (ev.type === 'error') result = { ok: false, message: ev.message }
  }
  return result
}

router.register(RT.Translate, (msg: any) =>
  runOnce({ kind: 'translate', input: msg.payload?.text || '', data: msg.payload }),
)

router.register(RT.Validate, (msg: any) => runOnce({ kind: 'validate', input: '', data: msg.config }))

router.register(RT.GetTabId, (_msg: any, sender) => ({ tabId: sender.tabId ?? 0 }))

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const result = router.dispatch(msg, { tabId: sender.tab?.id, url: sender.tab?.url })
  if (result === undefined) return false
  void Promise.resolve(result).then((res) => sendResponse(res))
  return true
})

/* ---------------- 长连接端口（chat-port / popup-port） ---------------- */

const portHub = new PortHub(runtime)
chrome.runtime.onConnect.addListener((port) => portHub.attach(port))

/* ---------------- 快捷键命令 ---------------- */

chrome.commands.onCommand.addListener((command) => {
  switch (command) {
    case 'toggle-chat':
      void sendToActiveTab({ type: RT.ToggleChat })
      break
    case 'summarize-page':
      void sendToActiveTab({ type: RT.QuickCommand, command: 'summarize' })
      break
    case 'toggle-extension':
      void STORAGE.getSettings().then((s) =>
        STORAGE.setSettings({ globalEnabled: !s.globalEnabled }),
      )
      break
  }
})

async function sendToActiveTab(message: any) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) return
  // 旧标签页可能未注入内容脚本：先探测，缺失则按需注入（受限页面注入失败则忽略）
  try {
    await chrome.tabs.sendMessage(tab.id, { type: RT.Ping })
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] })
      await new Promise((r) => setTimeout(r, 150))
    } catch {
      return
    }
  }
  try {
    await chrome.tabs.sendMessage(tab.id, message)
  } catch {
    /* 受限页面无法注入，静默忽略 */
  }
}

/* ---------------- 初始化 ---------------- */

chrome.runtime.onInstalled.addListener(() => {
  // 首次安装：写入默认设置（全局开关默认开启、划词翻译默认开启、主题默认跟随系统）
  void STORAGE.getSettings().then(async (s) => {
    if (!s) await STORAGE.setSettings({ globalEnabled: true, disabledSites: [], translateEnabled: true, theme: 'auto' })
  })
})

// 暴露给外部（测试/调试）的装配信息
;(globalThis as any).__AI_READER__ = {
  runtime,
  quickCommands,
  mcpManager,
  skillRegistry,
  toolRegistry,
}
