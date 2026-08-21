/**
 * 全局主题：CSS 变量 + Naive UI 主题覆写（现代简约风，低饱和科技蓝）
 */
import { GlobalThemeOverrides } from 'naive-ui'
import { ThemeMode } from './types'

export function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'auto') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return mode
}

export function applyTheme(mode: ThemeMode): 'light' | 'dark' {
  const resolved = resolveTheme(mode)
  document.documentElement.setAttribute('data-theme', resolved)
  return resolved
}

export const lightOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#4A7DFF',
    primaryColorHover: '#6A93FF',
    primaryColorPressed: '#3D6BF0',
    primaryColorSuppl: '#4A7DFF',
    infoColor: '#4A7DFF',
    successColor: '#34C77B',
    warningColor: '#F0A63B',
    errorColor: '#F2715C',
    borderRadius: '8px',
    bodyColor: '#F6F8FB',
    cardColor: '#FFFFFF',
    modalColor: '#FFFFFF',
    popoverColor: '#FFFFFF',
    textColorBase: '#1F2937',
    textColor1: '#1F2937',
    textColor2: '#4B5563',
    textColor3: '#9CA3AF',
    borderColor: '#E5E9F2',
    dividerColor: '#EBEEF5',
    boxShadow1: '0 4px 16px rgba(15, 23, 42, 0.08)',
  },
}

export const darkOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#6E9BFF',
    primaryColorHover: '#8AB0FF',
    primaryColorPressed: '#5B8BFF',
    primaryColorSuppl: '#6E9BFF',
    infoColor: '#6E9BFF',
    successColor: '#3ED98B',
    warningColor: '#F5B453',
    errorColor: '#F57E6B',
    borderRadius: '8px',
    bodyColor: '#161A22',
    cardColor: '#1D222D',
    modalColor: '#1D222D',
    popoverColor: '#1D222D',
    textColorBase: '#E7EBF3',
    textColor1: '#E7EBF3',
    textColor2: '#A9B2C3',
    textColor3: '#6B7488',
    borderColor: '#2A313F',
    dividerColor: '#262D3A',
    boxShadow1: '0 4px 16px rgba(0, 0, 0, 0.35)',
  },
}
