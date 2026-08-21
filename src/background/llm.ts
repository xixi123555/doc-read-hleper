/**
 * OpenAI 兼容 LLM 客户端：流式 / 非流式 / 连通性校验。
 * 统一兼容主流国内外大模型与本地私有化部署（PRD 5.3 接口适配规范）。
 */
import { LLMChatMessage, ModelConfig } from '../shared/types'

export class LLMError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'LLMError'
    this.status = status
  }
}

/**
 * 规范化接口地址 → 完整 chat/completions URL。
 * 与 OpenAI SDK 语义一致：base_url 原样拼接 /chat/completions，不自动补 /v1。
 * 版本段由用户按服务商文档填写（OpenAI 填 /v1、智谱填 /api/paas/v4、
 * DeepSeek 填 https://api.deepseek.com 即可）。
 */
export function buildChatUrl(baseUrl: string): string {
  let u = (baseUrl || '').trim().replace(/\/+$/, '')
  if (!u) throw new LLMError('模型接口地址未配置，请在插件设置中填写')
  if (/\/chat\/completions$/i.test(u)) return u
  return `${u}/chat/completions`
}

function headers(cfg: ModelConfig): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (cfg.apiKey) h['Authorization'] = `Bearer ${cfg.apiKey}`
  return h
}

function body(cfg: ModelConfig, messages: LLMChatMessage[], stream: boolean): string {
  return JSON.stringify({
    model: cfg.model,
    messages,
    temperature: cfg.temperature,
    max_tokens: cfg.maxTokens,
    stream,
  })
}

/** 带超时的 fetch（外部 signal 与内部超时合并） */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  external?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort()
  external?.addEventListener('abort', onAbort)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (e: any) {
    if (external?.aborted) throw new LLMError('请求已取消')
    if (e?.name === 'AbortError') throw new LLMError(`请求超时（超过 ${Math.round(timeoutMs / 1000)}s）`)
    throw new LLMError(e?.message || '网络请求失败')
  } finally {
    clearTimeout(timer)
    external?.removeEventListener('abort', onAbort)
  }
}

async function readError(res: Response): Promise<string> {
  try {
    const j = await res.json()
    return j?.error?.message || j?.message || `HTTP ${res.status}`
  } catch {
    return `HTTP ${res.status} ${res.statusText || ''}`.trim()
  }
}

/** 流式对话：逐 token 产出内容（自动兼容“忽略 stream:true 的非流式响应”） */
export async function* streamChatLLM(
  cfg: ModelConfig,
  messages: LLMChatMessage[],
  opts?: { signal?: AbortSignal },
): AsyncGenerator<string> {
  const url = buildChatUrl(cfg.baseUrl)
  const res = await fetchWithTimeout(
    url,
    { method: 'POST', headers: headers(cfg), body: body(cfg, messages, true) },
    cfg.timeout * 1000,
    opts?.signal,
  )
  if (!res.ok || !res.body) {
    throw new LLMError(await readError(res), res.status)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  const first = await reader.read()
  const firstText = first.done ? '' : decoder.decode(first.value, { stream: true })

  // 部分 OpenAI 兼容网关/本地模型忽略 stream:true，返回普通 JSON —— 自动兼容
  if (!first.done && !firstText.includes('data:')) {
    let text = firstText
    for (;;) {
      const r = await reader.read()
      if (r.done) break
      text += decoder.decode(r.value, { stream: true })
    }
    const json = parseJsonBody(text)
    if (json?.error) throw new LLMError(json.error.message || '接口返回错误')
    if (!json) throw new LLMError('接口响应无法解析（请确认接口地址为 OpenAI 兼容格式）')
    const content = json.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content) {
      throw new LLMError('接口未返回内容（请检查模型名称是否正确，或接口是否支持当前请求）')
    }
    yield content
    return
  }

  // 标准 SSE 流式解析
  let buf = firstText
  let yielded = false
  let messageContent: string | null = null
  function* processPart(part: string): Generator<string> {
    for (const line of part.split('\n')) {
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data || data === '[DONE]') continue
      let json: any
      try {
        json = JSON.parse(data)
      } catch {
        continue
      }
      if (json.error) throw new LLMError(json.error.message || '接口返回错误')
      const delta = json.choices?.[0]?.delta?.content
      if (delta) {
        yielded = true
        messageContent = null
        yield delta
        continue
      }
      // 某些实现把完整内容放在 message.content（流式末块）
      const mc = json.choices?.[0]?.message?.content
      if (typeof mc === 'string' && mc) messageContent = mc
    }
  }
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const parts = buf.split('\n\n')
    buf = parts.pop() || ''
    for (const part of parts) yield* processPart(part)
  }
  if (buf) yield* processPart(buf)
  // 流式解析未产出任何 delta 但存在 message.content（异常流式实现）→ 兜底输出
  if (!yielded) {
    if (messageContent) yield messageContent
    else throw new LLMError('接口未返回任何内容（请检查模型名称是否正确，或接口是否支持当前请求）')
  }
}

/** 从响应文本中提取 JSON 对象（容忍围栏/前后杂文） */
export function parseJsonBody(text: string): any {
  const t = text.trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(t.slice(start, end + 1))
    } catch {
      /* fallthrough */
    }
  }
  try {
    return JSON.parse(t)
  } catch {
    return null
  }
}

/** 非流式对话：一次性返回完整文本 */
export async function chatLLM(
  cfg: ModelConfig,
  messages: LLMChatMessage[],
  opts?: { signal?: AbortSignal },
): Promise<string> {
  const url = buildChatUrl(cfg.baseUrl)
  const res = await fetchWithTimeout(
    url,
    { method: 'POST', headers: headers(cfg), body: body(cfg, messages, false) },
    cfg.timeout * 1000,
    opts?.signal,
  )
  if (!res.ok) throw new LLMError(await readError(res), res.status)
  const json: any = await res.json()
  if (json.error) throw new LLMError(json.error.message || '接口返回错误')
  const text = json.choices?.[0]?.message?.content
  if (typeof text !== 'string') throw new LLMError('接口返回格式异常')
  return text
}

/** 连通性校验：发送最小请求，返回成功/失败原因 */
export async function validateConfig(
  cfg: ModelConfig,
): Promise<{ ok: boolean; message: string; latencyMs: number }> {
  const start = Date.now()
  try {
    const msg: LLMChatMessage[] = [
      { role: 'system', content: '你是连通性测试助手。' },
      { role: 'user', content: 'ping' },
    ]
    await chatLLM({ ...cfg, maxTokens: 16, temperature: 0 }, msg)
    return { ok: true, message: '接口连通正常', latencyMs: Date.now() - start }
  } catch (e: any) {
    return {
      ok: false,
      message: e?.message || '未知错误',
      latencyMs: Date.now() - start,
    }
  }
}

/** 兼容导出：token 估算与上下文截断已迁移至 shared/context（多端共用） */
export { estimateTokens, truncateContextText } from '../shared/context'

/** 兼容模型输出中包裹 markdown 代码块的 JSON 解析 */
export function parseLooseJson(raw: string): any {
  const text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fence ? fence[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(candidate.slice(start, end + 1))
    } catch {
      /* fallthrough */
    }
  }
  try {
    return JSON.parse(candidate)
  } catch {
    return null
  }
}
