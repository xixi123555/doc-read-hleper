/**
 * 常用模型配置预设（PRD 3.2.3 一键填充）。
 * 全部为 OpenAI 兼容协议接口。
 */
import { ModelConfig } from './types'

export interface ModelPreset {
  id: string
  name: string
  baseUrl: string
  model: string
  temperature: number
  maxTokens: number
  timeout: number
  apiKey: string
  hint?: string
}

export const PRESETS: ModelPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    temperature: 0.2,
    maxTokens: 4096,
    timeout: 15,
    apiKey: '',
    hint: '官方 OpenAI 兼容接入：base_url 无需 /v1；模型 deepseek-v4-flash / deepseek-v4-pro',
  },
  {
    id: 'openai',
    name: 'OpenAI GPT 系列',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    temperature: 0.2,
    maxTokens: 4096,
    timeout: 15,
    apiKey: '',
  },
  {
    id: 'qwen',
    name: '通义千问 Qwen',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    temperature: 0.2,
    maxTokens: 4096,
    timeout: 15,
    apiKey: '',
  },
  {
    id: 'moonshot',
    name: 'Kimi (Moonshot)',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    temperature: 0.2,
    maxTokens: 4096,
    timeout: 15,
    apiKey: '',
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    temperature: 0.2,
    maxTokens: 4096,
    timeout: 15,
    apiKey: '',
  },
  {
    id: 'ollama',
    name: '本地 Ollama',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3',
    temperature: 0.2,
    maxTokens: 2048,
    timeout: 30,
    apiKey: '',
    hint: '本地免密，需先启动 ollama serve',
  },
]

export function presetById(id: string): ModelPreset | undefined {
  return PRESETS.find((p) => p.id === id)
}

export function createConfigFromPreset(presetId: string): ModelConfig {
  const p = presetById(presetId) || PRESETS[0]
  return {
    id: '',
    name: p.name,
    baseUrl: p.baseUrl,
    apiKey: p.apiKey,
    model: p.model,
    temperature: p.temperature,
    maxTokens: p.maxTokens,
    timeout: p.timeout,
    createdAt: Date.now(),
  }
}
