/**
 * 日志接口（供 Agent 依赖注入，避免耦合具体实现）
 */
export interface LoggerLike {
  debug(scope: string, message: string, data?: unknown): void
  info(scope: string, message: string, data?: unknown): void
  warn(scope: string, message: string, data?: unknown): void
  error(scope: string, message: string, data?: unknown): void
}
