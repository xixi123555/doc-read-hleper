<script setup lang="ts">
/**
 * Popup 主面板（仅配置页，Tailwind CSS 现代简约风）
 *  - popup 只展示设置/配置内容，不再内置快捷对话；
 *  - 点击「返回对话 / 打开悬浮窗」→ 直接唤起右侧悬浮对话窗并关闭 popup，不停留在 popup；
 *  - api-key 已配置（isConfigComplete）时，唤起插件默认直接打开悬浮对话窗，不再显示配置页；
 *    受限页面/插件关闭等无法唤起时留在配置页并给出提示。
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import {
  NAlert,
  NButton,
  NConfigProvider,
  NDivider,
  NEmpty,
  NGlobalStyle,
  NInput,
  NInputNumber,
  NModal,
  NSelect,
  NSlider,
  NSpace,
  NSwitch,
  NTag,
  darkTheme,
} from 'naive-ui'
import type { GlobalTheme } from 'naive-ui'
import type { AppSettings, ModelConfig, ThemeMode } from '../shared/types'
import {
  consumePopupOpenForSettings,
  deleteConfig,
  getActiveConfigId,
  getConfigs,
  getSettings,
  isConfigComplete,
  isSiteDisabled,
  saveConfig,
  setActiveConfigId,
  setSettings,
  uid,
} from '../shared/storage'
import { decryptText, encryptText } from '../shared/crypto'
import { PRESETS, createConfigFromPreset } from '../shared/presets'
import { darkOverrides, lightOverrides, resolveTheme } from '../shared/theme'
import { RT } from '../shared/msg'

/* ---------------- 主题 ---------------- */

const naiveTheme = ref<GlobalTheme | null>(null)
const themeOverrides = computed(() => (naiveTheme.value === darkTheme ? darkOverrides : lightOverrides))

/* ---------------- 设置与状态 ---------------- */

const settings = reactive<AppSettings>({
  globalEnabled: true,
  disabledSites: [],
  translateEnabled: true,
  theme: 'auto',
})

const configs = ref<ModelConfig[]>([])
const activeId = ref<string | null>(null)
const activeModelName = ref('')
const configured = ref(false)
const checking = ref(true)

const tabHost = ref('')
const tabTitle = ref('')
const tabId = ref<number | null>(null)

/* 编辑表单 */
const presetId = ref('deepseek')
const editId = ref<string | null>(null)
const form = reactive({
  name: '',
  baseUrl: 'https://api.deepseek.com',
  apiKey: '',
  model: 'deepseek-v4-flash',
  temperature: 0.2,
  maxTokens: 4096,
  timeout: 15,
  noKey: false,
})

const validating = ref(false)
const validateResult = ref<{ ok: boolean; message: string } | null>(null)
const saving = ref(false)
const toast = ref<{ type: 'success' | 'error' | 'info'; text: string } | null>(null)
let toastTimer: number | undefined

/* 快捷键 */
const commands = ref<chrome.commands.Command[]>([])
const shortcutModal = ref(false)
const shortcutTarget = ref('')
const shortcutInput = ref('')
const shortcutError = ref('')
const canEditShortcut = typeof chrome.commands.update === 'function'

function showToast(type: 'success' | 'error' | 'info', text: string) {
  toast.value = { type, text }
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = null), 2600)
}

/* ---------------- 生命周期 ---------------- */

onMounted(async () => {
  const s = await getSettings()
  Object.assign(settings, s)
  naiveTheme.value = resolveTheme(s.theme) === 'dark' ? darkTheme : null
  const active = await refreshConfigs()
  configured.value = isConfigComplete(active)
  await refreshTab()
  await refreshCommands()
  checking.value = false
  // 悬浮窗「设置」按钮唤起 → 直接展示配置页；否则 api-key 已配置时默认直接打开悬浮对话窗
  const openedForSettings = await consumePopupOpenForSettings()
  if (configured.value && !openedForSettings) {
    void openFloatingWindow()
  }
})

onBeforeUnmount(() => {
  window.clearTimeout(toastTimer)
})

async function refreshConfigs() {
  configs.value = await getConfigs()
  activeId.value = await getActiveConfigId()
  const active = configs.value.find((c) => c.id === activeId.value) || configs.value[0]
  activeModelName.value = active ? `${active.name} / ${active.model}` : '未配置'
  return active || null
}

async function refreshTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab) return
  tabId.value = tab.id ?? null
  tabHost.value = tab.url ? new URL(tab.url).hostname : ''
  tabTitle.value = tab.title || ''
}

async function refreshCommands() {
  try {
    commands.value = await chrome.commands.getAll()
  } catch {
    commands.value = []
  }
}

/* ---------------- 全局开关 / 网页禁用 ---------------- */

async function onGlobalSwitch(v: boolean) {
  settings.globalEnabled = v
  await setSettings({ globalEnabled: v })
  showToast('info', v ? '插件已开启' : '插件已关闭，所有功能静默失效')
}

const tabDisabled = computed(() => isSiteDisabled(settings.disabledSites, tabHost.value))

async function onTabDisable(v: boolean) {
  if (!tabHost.value) return
  const set = new Set(settings.disabledSites)
  if (v) set.add(tabHost.value)
  else set.delete(tabHost.value)
  settings.disabledSites = [...set]
  await setSettings({ disabledSites: settings.disabledSites })
  showToast('info', v ? `已在 ${tabHost.value} 上禁用` : `已恢复 ${tabHost.value}`)
}

/* ---------------- 模型配置 ---------------- */

const presetOptions = computed(() => [
  ...PRESETS.map((p) => ({ label: p.name, value: p.id })),
  { label: '自定义配置', value: '__custom__' },
])

function applyPreset(id: string) {
  presetId.value = id
  if (id === '__custom__') return
  const cfg = createConfigFromPreset(id)
  form.name = cfg.name
  form.baseUrl = cfg.baseUrl
  form.apiKey = ''
  form.model = cfg.model
  form.temperature = cfg.temperature
  form.maxTokens = cfg.maxTokens
  form.timeout = cfg.timeout
  form.noKey = id === 'ollama'
}

async function editConfig(cfg: ModelConfig) {
  editId.value = cfg.id
  presetId.value = '__custom__'
  form.name = cfg.name
  form.baseUrl = cfg.baseUrl
  form.apiKey = await decryptText(cfg.apiKey || '')
  form.model = cfg.model
  form.temperature = cfg.temperature
  form.maxTokens = cfg.maxTokens
  form.timeout = cfg.timeout
  form.noKey = !!cfg.noKey
}

async function removeConfig(id: string) {
  await deleteConfig(id)
  const active = await refreshConfigs()
  configured.value = isConfigComplete(active)
  showToast('info', '配置已删除')
}

async function setActive(id: string) {
  await setActiveConfigId(id)
  const active = await refreshConfigs()
  configured.value = isConfigComplete(active)
  showToast('success', '已切换生效模型')
}

async function validateNow() {
  if (!form.baseUrl || !form.model) {
    showToast('error', '请先填写接口地址与模型名称')
    return
  }
  validating.value = true
  validateResult.value = null
  try {
    const encrypted = await encryptText(form.apiKey || '')
    const res = await chrome.runtime.sendMessage({
      type: RT.Validate,
      config: {
        id: '',
        name: form.name,
        baseUrl: form.baseUrl,
        apiKey: encrypted,
        model: form.model,
        temperature: form.temperature,
        maxTokens: form.maxTokens,
        timeout: form.timeout,
        createdAt: 0,
      },
    })
    validateResult.value = { ok: !!res?.ok, message: res?.message || '校验失败' }
  } catch (e: any) {
    validateResult.value = { ok: false, message: e?.message || '校验失败' }
  } finally {
    validating.value = false
  }
}

async function saveAsNew() {
  if (!form.baseUrl || !form.model) {
    showToast('error', '请先填写接口地址与模型名称')
    return
  }
  saving.value = true
  try {
    const encrypted = await encryptText(form.apiKey || '')
    const cfg: ModelConfig = {
      id: uid(),
      name: form.name || form.model,
      baseUrl: form.baseUrl,
      apiKey: encrypted,
      model: form.model,
      temperature: form.temperature,
      maxTokens: form.maxTokens,
      timeout: form.timeout,
      noKey: form.noKey,
      createdAt: Date.now(),
    }
    await saveConfig(cfg)
    await refreshConfigs()
    configured.value = isConfigComplete(cfg)
    if (configured.value) {
      // 配置完成：直接唤起悬浮对话窗并关闭 popup，不再停留在配置页
      await openFloatingWindow()
    } else {
      showToast('info', '配置已保存，请补充模型名称/密钥或勾选本地免密')
    }
  } finally {
    saving.value = false
  }
}

async function saveUpdate() {
  if (!editId.value) return
  saving.value = true
  try {
    const encrypted = await encryptText(form.apiKey || '')
    const cfg: ModelConfig = {
      id: editId.value,
      name: form.name || form.model,
      baseUrl: form.baseUrl,
      apiKey: encrypted,
      model: form.model,
      temperature: form.temperature,
      maxTokens: form.maxTokens,
      timeout: form.timeout,
      noKey: form.noKey,
      createdAt: 0,
    }
    await saveConfig(cfg)
    await refreshConfigs()
    configured.value = isConfigComplete(cfg)
    if (configured.value) showToast('success', '配置已更新')
  } finally {
    saving.value = false
  }
}

/* ---------------- 划词翻译 / 主题 ---------------- */

async function onTranslateSwitch(v: boolean) {
  settings.translateEnabled = v
  await setSettings({ translateEnabled: v })
  showToast('info', v ? '划词翻译已开启' : '划词翻译已关闭')
}

async function onThemeChange(v: ThemeMode) {
  settings.theme = v
  await setSettings({ theme: v })
  naiveTheme.value = resolveTheme(v) === 'dark' ? darkTheme : null
  document.documentElement.setAttribute('data-theme', resolveTheme(v))
}

/* ---------------- 快捷键编辑 ---------------- */

function openShortcutEditor(name: string, current: string) {
  shortcutTarget.value = name
  shortcutInput.value = current || ''
  shortcutError.value = ''
  shortcutModal.value = true
}

async function saveShortcut() {
  const value = shortcutInput.value.trim()
  if (!/^([A-Za-z0-9]|(Ctrl|Alt|Shift|MacCtrl|Command)\+){1,4}[A-Za-z0-9]$/.test(value)) {
    shortcutError.value = '格式示例：Ctrl+Shift+Y、Alt+Shift+R'
    return
  }
  try {
    await chrome.commands.update({ name: shortcutTarget.value, shortcut: value })
    shortcutModal.value = false
    await refreshCommands()
    showToast('success', '快捷键已更新')
  } catch (e: any) {
    shortcutError.value = e?.message || '快捷键冲突或格式不正确'
  }
}

function shortcutLabel(cmd: chrome.commands.Command): string {
  return cmd.shortcut || '未设置'
}

/* ---------------- 悬浮对话窗唤起 ---------------- */

/** 确保当前标签页已注入内容脚本（旧标签页自动补注入） */
async function ensureContentScript(tabId: number): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: RT.Ping })
    return true
  } catch {
    /* 未注入 */
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })
    await new Promise((r) => setTimeout(r, 150))
    await chrome.tabs.sendMessage(tabId, { type: RT.Ping })
    return true
  } catch {
    return false
  }
}

/** 唤起右侧悬浮对话窗；成功则关闭 popup，受限页面/插件关闭等场景留在配置页并提示 */
async function openFloatingWindow(): Promise<boolean> {
  if (tabId.value == null) return false
  if (!settings.globalEnabled || isSiteDisabled(settings.disabledSites, tabHost.value)) {
    showToast('error', '插件已关闭或当前网页已禁用，请先开启')
    return false
  }
  const ok = await ensureContentScript(tabId.value)
  if (!ok) {
    showToast('error', '无法在受限页面唤起悬浮窗')
    return false
  }
  try {
    await chrome.tabs.sendMessage(tabId.value, { type: RT.OpenChat })
    window.close()
    return true
  } catch {
    showToast('error', '唤起悬浮窗失败，请刷新网页重试')
    return false
  }
}
</script>

<template src="./settings.html" />
