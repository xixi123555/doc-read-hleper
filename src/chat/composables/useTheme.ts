/**
 * 主题管理：light / dark / auto 三种模式，同步 naive-ui theme 与 <html data-theme>。
 */
import { computed, ref } from 'vue'
import { darkTheme } from 'naive-ui'
import type { GlobalTheme } from 'naive-ui'
import { getSettings, setSettings } from '../../shared/storage'
import { darkOverrides, lightOverrides, resolveTheme } from '../../shared/theme'
import type { ThemeMode } from '../../shared/types'

export function useTheme() {
  const themeMode = ref<ThemeMode>('light')
  const naiveTheme = ref<GlobalTheme | null>(null)
  const themeOverrides = computed(() =>
    naiveTheme.value === darkTheme ? darkOverrides : lightOverrides,
  )

  function applyThemeMode(mode: ThemeMode) {
    themeMode.value = mode
    const resolved = resolveTheme(mode)
    naiveTheme.value = resolved === 'dark' ? darkTheme : null
    document.documentElement.setAttribute('data-theme', resolved)
  }

  async function refreshTheme() {
    const s = await getSettings()
    applyThemeMode(s.theme)
  }

  async function cycleTheme() {
    const order: ThemeMode[] = ['light', 'dark', 'auto']
    const next = order[(order.indexOf(themeMode.value) + 1) % 3]
    await setSettings({ theme: next })
    applyThemeMode(next)
  }

  function themeIcon(): string {
    return themeMode.value === 'dark' ? '☀️' : themeMode.value === 'auto' ? '🖥️' : '🌙'
  }

  return { themeMode, naiveTheme, themeOverrides, applyThemeMode, refreshTheme, cycleTheme, themeIcon }
}
