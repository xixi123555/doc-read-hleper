/**
 * 可插拔日志模块（PRD 3.5.3 同款可插拔架构思想）
 *
 * 输出渠道采用注册表模式：新增渠道只需实现 LogSink 接口并追加到 LOG_SINKS，
 * 开启/关闭某个渠道不影响其他渠道，核心业务代码无需改动。
 *
 * 已落地：
 *  - console：控制台打印（现阶段默认启用，用于问题定位）
 * 预留拓展（可插拔，未启用不影响现有输出）：
 *  - page：插件面板/对话窗内的调试浮层展示
 *  - server：上报服务器（需用户显式开启并配置，涉及隐私需谨慎）
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogSink {
  id: string
  label: string
  /** 渠道开关（可插拔）：关闭不影响其他渠道 */
  enabled: boolean
  /** 渠道能力说明（预留渠道用） */
  capability?: string
  log(level: LogLevel, scope: string, message: string, data?: unknown): void
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }
let minLevel: LogLevel = 'debug'

/** 输出渠道注册表 —— 新增输出渠道在此追加实现即可 */
export const LOG_SINKS: LogSink[] = [
  {
    id: 'console',
    label: '控制台打印',
    enabled: true,
    log(level, scope, message, data) {
      const line = `[AI阅读助手][${scope}] ${message}`
      const args: unknown[] = [line]
      if (data !== undefined) args.push(data)
      if (level === 'error') console.error(...args)
      else if (level === 'warn') console.warn(...args)
      else if (level === 'debug') console.debug(...args)
      else console.info(...args)
    },
  },
  // ---- 预留拓展渠道 ----
  {
    id: 'page',
    label: '页面内调试浮层',
    enabled: false,
    capability: '预留：将日志渲染到插件面板/对话窗内的调试浮层展示',
    log() {
      /* 预留实现 */
    },
  },
  {
    id: 'server',
    label: '上报服务器',
    enabled: false,
    capability: '预留：对接后台日志收集接口（需用户显式开启并配置）',
    log() {
      /* 预留实现 */
    },
  },
]

/** 设置最小输出级别（debug < info < warn < error） */
export function setLogLevel(level: LogLevel): void {
  minLevel = level
}

/** 按 id 开关某个输出渠道（可插拔） */
export function setSinkEnabled(id: string, enabled: boolean): void {
  const sink = LOG_SINKS.find((s) => s.id === id)
  if (sink) sink.enabled = enabled
}

export function log(level: LogLevel, scope: string, message: string, data?: unknown): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return
  for (const sink of LOG_SINKS) {
    if (!sink.enabled) continue
    try {
      sink.log(level, scope, message, data)
    } catch {
      /* 日志渠道自身失败不影响业务 */
    }
  }
}

export const logger = {
  debug: (scope: string, message: string, data?: unknown) => log('debug', scope, message, data),
  info: (scope: string, message: string, data?: unknown) => log('info', scope, message, data),
  warn: (scope: string, message: string, data?: unknown) => log('warn', scope, message, data),
  error: (scope: string, message: string, data?: unknown) => log('error', scope, message, data),
}
