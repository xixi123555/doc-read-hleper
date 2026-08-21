/**
 * chrome.storage.local 封装：设置、模型配置、会话记录的统一读写。
 * 所有数据仅存本地，重启浏览器/电脑不丢失（PRD 6.3 可用性需求）。
 */
import {
  AppSettings,
  ChatSession,
  DEFAULT_SETTINGS,
  ModelConfig,
  STORAGE_KEYS,
} from './types'

function uid(): string {
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export { uid }

/* ---------------- 设置 ---------------- */

export async function getSettings(): Promise<AppSettings> {
  const r = await chrome.storage.local.get(STORAGE_KEYS.settings)
  return { ...DEFAULT_SETTINGS, ...(r[STORAGE_KEYS.settings] || {}) }
}

export async function setSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const next = { ...(await getSettings()), ...patch }
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: next })
  return next
}

export function isSiteDisabled(sites: string[], hostname: string): boolean {
  return sites.includes(hostname)
}

/* ---------------- 模型配置 ---------------- */

export async function getConfigs(): Promise<ModelConfig[]> {
  const r = await chrome.storage.local.get(STORAGE_KEYS.configs)
  return r[STORAGE_KEYS.configs] || []
}

export async function getActiveConfigId(): Promise<string | null> {
  const r = await chrome.storage.local.get(STORAGE_KEYS.activeConfig)
  return r[STORAGE_KEYS.activeConfig] || null
}

export async function setActiveConfigId(id: string): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.activeConfig]: id })
}

/** 当前生效的模型配置；无配置时返回 null */
export async function getActiveConfig(): Promise<ModelConfig | null> {
  const [configs, activeId] = await Promise.all([getConfigs(), getActiveConfigId()])
  if (!configs.length) return null
  const found = configs.find((c) => c.id === activeId)
  return found || configs[0]
}

export async function saveConfig(cfg: ModelConfig): Promise<ModelConfig[]> {
  const configs = await getConfigs()
  const idx = configs.findIndex((c) => c.id === cfg.id)
  if (idx >= 0) configs[idx] = cfg
  else configs.push(cfg)
  await chrome.storage.local.set({ [STORAGE_KEYS.configs]: configs })
  // 第一条配置自动设为生效配置
  const activeId = await getActiveConfigId()
  if (!activeId || idx < 0) await setActiveConfigId(cfg.id)
  return configs
}

export async function deleteConfig(id: string): Promise<ModelConfig[]> {
  const configs = (await getConfigs()).filter((c) => c.id !== id)
  await chrome.storage.local.set({ [STORAGE_KEYS.configs]: configs })
  const activeId = await getActiveConfigId()
  if (activeId === id) {
    await setActiveConfigId(configs.length ? configs[0].id : '')
  }
  return configs
}

/* ---------------- 对话会话（按域名分类） ---------------- */

type SessionsMap = Record<string, ChatSession[]>

export async function getSessions(): Promise<SessionsMap> {
  const r = await chrome.storage.local.get(STORAGE_KEYS.sessions)
  return r[STORAGE_KEYS.sessions] || {}
}

export async function getSessionsByDomain(domain: string): Promise<ChatSession[]> {
  const all = await getSessions()
  return (all[domain] || []).slice().sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function saveSession(session: ChatSession): Promise<void> {
  const all = await getSessions()
  const list = all[session.domain] || []
  const idx = list.findIndex((s) => s.id === session.id)
  if (idx >= 0) list[idx] = session
  else list.push(session)
  all[session.domain] = list
  await chrome.storage.local.set({ [STORAGE_KEYS.sessions]: all })
}

export async function deleteSession(domain: string, sessionId: string): Promise<void> {
  const all = await getSessions()
  all[domain] = (all[domain] || []).filter((s) => s.id !== sessionId)
  if (!all[domain].length) delete all[domain]
  await chrome.storage.local.set({ [STORAGE_KEYS.sessions]: all })
}

export async function clearDomainSessions(domain: string): Promise<void> {
  const all = await getSessions()
  delete all[domain]
  await chrome.storage.local.set({ [STORAGE_KEYS.sessions]: all })
}

/* ---------------- 弹窗快捷对话会话（与悬浮窗隔离） ---------------- */

const POPUP_SESSIONS_KEY = 'popupChatSessions'

/** 模型配置是否完整（已配置完成：接口+模型名，且密钥或本地免密） */
export function isConfigComplete(cfg: ModelConfig | null | undefined): boolean {
  if (!cfg) return false
  if (!cfg.baseUrl?.trim() || !cfg.model?.trim()) return false
  if (cfg.apiKey?.trim()) return true
  return !!cfg.noKey
}

/** 弹窗快捷对话：读取指定域名的会话（无则返回 null） */
export async function getPopupSession(domain: string): Promise<ChatSession | null> {
  const r = await chrome.storage.local.get(POPUP_SESSIONS_KEY)
  const map = r[POPUP_SESSIONS_KEY] || {}
  return map[domain] || null
}

/** 弹窗快捷对话：保存指定域名的会话 */
export async function savePopupSession(session: ChatSession): Promise<void> {
  const r = await chrome.storage.local.get(POPUP_SESSIONS_KEY)
  const map = r[POPUP_SESSIONS_KEY] || {}
  map[session.domain] = session
  await chrome.storage.local.set({ [POPUP_SESSIONS_KEY]: map })
}

/** 弹窗快捷对话：清空指定域名的会话 */
export async function clearPopupSession(domain: string): Promise<void> {
  const r = await chrome.storage.local.get(POPUP_SESSIONS_KEY)
  const map = r[POPUP_SESSIONS_KEY] || {}
  delete map[domain]
  await chrome.storage.local.set({ [POPUP_SESSIONS_KEY]: map })
}
