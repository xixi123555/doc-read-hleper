/**
 * 后台状态访问封装（复用 shared/storage，统一命名空间 STORAGE）
 */
import {
  clearDomainSessions,
  deleteConfig,
  deleteSession,
  getActiveConfig,
  getActiveConfigId,
  getConfigs,
  getSessions,
  getSessionsByDomain,
  getSettings,
  saveConfig,
  saveSession,
  setActiveConfigId,
  setSettings,
} from '../shared/storage'

export const STORAGE = {
  getSettings,
  setSettings,
  getConfigs,
  saveConfig,
  deleteConfig,
  getActiveConfig,
  getActiveConfigId,
  setActiveConfigId,
  getSessions,
  getSessionsByDomain,
  saveSession,
  deleteSession,
  clearDomainSessions,
}
