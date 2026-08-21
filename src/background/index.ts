/**
 * 后台 Service Worker（Manifest V3, ESM）
 * 职责：
 *  - 对话/总结流式请求（与 chat 页面建立长连接端口，逐 token 推送）
 *  - 划词翻译、配置连通性校验
 *  - 全局快捷键命令
 *  - 首次安装初始化默认配置
 */
import {
  LLMChatMessage,
  ModelConfig,
  TranslatePayload,
} from '../shared/types'
import { STORAGE } from './state'
import { decryptText } from '../shared/crypto'
import {
  buildChatMessages,
  buildPageBlock,
  buildSummarizePrompt,
  buildTranslationPrompt,
  SUMMARIZE_SYSTEM,
  TRANSLATION_SYSTEM,
} from '../shared/prompts'
import { RT } from '../shared/msg'
import { logger } from '../shared/logger'
import {
  chatLLM,
  LLMError,
  parseLooseJson,
  streamChatLLM,
  truncateContextText,
  validateConfig,
} from './llm'

/* ---------------- 初始化 ---------------- */

chrome.runtime.onInstalled.addListener(() => {
  // 首次安装：写入默认设置（全局开关默认开启、划词翻译默认关闭）
  void STORAGE.getSettings().then(async (s) => {
    if (!s) await STORAGE.setSettings({ globalEnabled: true, disabledSites: [], translateEnabled: false, theme: 'light' })
  })
})

/** 取当前生效配置并解密密钥 */
async function resolveConfig(): Promise<ModelConfig | null> {
  const cfg = await STORAGE.getActiveConfig()
  if (!cfg) return null
  return { ...cfg, apiKey: await decryptText(cfg.apiKey || '') }
}

/* ---------------- 长连接端口：对话 / 总结流式 ---------------- */

interface ActiveStream {
  controller: AbortController
}

const streams = new Map<string, ActiveStream>()

chrome.runtime.onConnect.addListener((port) => {
  // chat-port：悬浮对话窗；popup-port：弹窗快捷对话。协议一致
  if (port.name !== 'chat-port' && port.name !== 'popup-port') return
  port.onMessage.addListener(async (msg: any) => {
    try {
      if (msg?.type === 'llm-chat') {
        await handleChat(port, msg)
      } else if (msg?.type === 'summarize') {
        await handleSummarize(port, msg)
      } else if (msg?.type === 'abort') {
        streams.get(msg.id)?.controller.abort()
        streams.delete(msg.id)
      }
    } catch (e) {
      logger.error('bg', 'LLM 请求失败', e instanceof Error ? e.message : e)
      try {
        port.postMessage({
          type: msg?.type === 'summarize' ? 'summarize-error' : 'llm-error',
          id: msg?.id,
          message: e instanceof Error ? e.message : String(e),
        })
      } catch {
        /* port closed */
      }
    }
  })
  port.onDisconnect.addListener(() => {
    // 页面关闭时终止其所有请求
    streams.forEach((s, id) => {
      if (s.controller.signal.aborted === false) s.controller.abort()
      streams.delete(id)
    })
  })
})

async function handleChat(port: chrome.runtime.Port, msg: any) {
  const cfg = await resolveConfig()
  if (!cfg) {
    port.postMessage({ type: 'llm-error', id: msg.id, message: '尚未配置大模型，请点击插件图标打开配置面板完成设置' })
    return
  }
  const { id, messages, pageContext } = msg.payload || {}
  if (!id || !messages?.length) {
    port.postMessage({ type: 'llm-error', id: msg?.id, message: '请求参数无效，请重试' })
    return
  }
  logger.info('bg', '收到对话请求', {
    question: messages[messages.length - 1]?.content?.slice(0, 30),
    hasContext: !!pageContext,
    ctxTitle: pageContext?.title || '',
    ctxTextLen: pageContext?.text?.length || 0,
    ctxWords: pageContext?.wordCount || 0,
  })

  const history: LLMChatMessage[] = messages.slice(0, -1)
  const question: string = messages[messages.length - 1]?.content || ''
  const truncated = truncateContextText(pageContext?.text || '', cfg.maxTokens)
  const pageBlock = buildPageBlock({
    ...(pageContext || { title: '', url: '', lang: '', outline: [], codeBlocks: [] }),
    text: truncated.text,
    truncated: truncated.truncated,
  })
  logger.debug('bg', '组装完成，网页上下文块长度', {
    pageBlockLen: pageBlock.length,
    truncated: truncated.truncated,
  })
  const llmMessages = buildChatMessages({ pageBlock, history, question })

  const controller = new AbortController()
  streams.set(id, { controller })
  let full = ''
  try {
    for await (const delta of streamChatLLM(cfg, llmMessages, { signal: controller.signal })) {
      full += delta
      port.postMessage({ type: 'llm-chunk', id, delta })
    }
    port.postMessage({ type: 'llm-done', id, content: full })
  } finally {
    streams.delete(id)
  }
}

async function handleSummarize(port: chrome.runtime.Port, msg: any) {
  const cfg = await resolveConfig()
  if (!cfg) {
    port.postMessage({ type: 'summarize-error', id: msg.id, message: '尚未配置大模型，请先在插件配置面板完成设置' })
    return
  }
  const { id, messages, pageMeta } = msg.payload || {}
  if (!id || !messages?.length) return

  const conversation = messages
    .map((m: any) => `【${m.role === 'user' ? '用户' : 'AI'}】\n${m.content}`)
    .join('\n\n')
  const llmMessages: LLMChatMessage[] = [
    { role: 'system', content: SUMMARIZE_SYSTEM },
    {
      role: 'user',
      content: buildSummarizePrompt({
        pageTitle: pageMeta?.title || '',
        pageUrl: pageMeta?.url || '',
        domain: pageMeta?.domain || '',
        conversation,
      }),
    },
  ]
  const controller = new AbortController()
  streams.set(id, { controller })
  let full = ''
  try {
    for await (const delta of streamChatLLM(cfg, llmMessages, { signal: controller.signal })) {
      full += delta
      port.postMessage({ type: 'summarize-chunk', id, delta })
    }
    port.postMessage({ type: 'summarize-done', id, content: full })
  } finally {
    streams.delete(id)
  }
}

/* ---------------- 一次性消息：翻译 / 校验 / tabId ---------------- */

chrome.runtime.onMessage.addListener((msg: any, sender, sendResponse) => {
  switch (msg?.type) {
    case RT.Translate:
      void runTranslate(msg.payload).then(sendResponse)
      return true
    case RT.Validate:
      void runValidate(msg.config).then(sendResponse)
      return true
    case RT.GetTabId:
      sendResponse({ tabId: sender.tab?.id ?? 0 })
      return false
    default:
      return false
  }
})

async function runTranslate(payload: TranslatePayload) {
  const cfg = await resolveConfig()
  if (!cfg) {
    return { ok: false, error: '尚未配置大模型，请点击插件图标完成配置' }
  }
  try {
    const llmMessages: LLMChatMessage[] = [
      { role: 'system', content: TRANSLATION_SYSTEM },
      {
        role: 'user',
        content: buildTranslationPrompt({
          text: payload.text,
          mode: payload.mode,
          snippet: payload.snippet,
          pageTitle: payload.pageTitle,
        }),
      },
    ]
    const raw = await chatLLM(cfg, llmMessages)
    const json = parseLooseJson(raw)
    if (!json || typeof json !== 'object') throw new LLMError('翻译结果解析失败')
    return { ok: true, data: json }
  } catch (e: any) {
    return { ok: false, error: e?.message || '翻译失败' }
  }
}

async function runValidate(config: ModelConfig) {
  const cfg = { ...config, apiKey: await decryptText(config.apiKey || '') }
  return validateConfig(cfg)
}

/* ---------------- 快捷键命令（可自定义） ---------------- */

chrome.commands.onCommand.addListener((command) => {
  switch (command) {
    case 'toggle-chat': {
      void sendToActiveTab({ type: RT.ToggleChat })
      break
    }
    case 'summarize-page': {
      void sendToActiveTab({ type: RT.QuickCommand, command: 'summarize' })
      break
    }
    case 'toggle-extension': {
      void STORAGE.getSettings().then((s) =>
        STORAGE.setSettings({ globalEnabled: !s.globalEnabled }),
      )
      break
    }
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
