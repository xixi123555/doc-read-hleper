/**
 * 可插拔日志模块测试
 * 运行：npx tsx tests/logger.test.ts
 */
import assert from 'node:assert'
import {
  LOG_SINKS,
  log,
  logger,
  setLogLevel,
  setSinkEnabled,
} from '../src/shared/logger'

let passed = 0
function ok(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++
      console.log(`  ✅ ${name}`)
    })
}

/** 捕获 console 输出 */
function captureConsole() {
  const calls: { level: string; args: unknown[] }[] = []
  const orig = {
    debug: console.debug,
    info: console.info,
    warn: console.warn,
    error: console.error,
    log: console.log,
  }
  ;(console as any).debug = (...a: unknown[]) => calls.push({ level: 'debug', args: a })
  ;(console as any).info = (...a: unknown[]) => calls.push({ level: 'info', args: a })
  ;(console as any).warn = (...a: unknown[]) => calls.push({ level: 'warn', args: a })
  ;(console as any).error = (...a: unknown[]) => calls.push({ level: 'error', args: a })
  return {
    calls,
    restore() {
      Object.assign(console, orig)
    },
  }
}

console.log('== logger.ts ==')

await ok('注册表含 console 渠道与预留渠道', () => {
  const ids = LOG_SINKS.map((s) => s.id)
  assert.ok(ids.includes('console'))
  assert.ok(ids.includes('page'), '预留页面展示渠道')
  assert.ok(ids.includes('server'), '预留服务器上报渠道')
  assert.ok(LOG_SINKS.find((s) => s.id === 'console')?.enabled, 'console 默认启用')
  assert.ok(!LOG_SINKS.find((s) => s.id === 'server')?.enabled, 'server 默认关闭')
})

await ok('info 级别输出到控制台', () => {
  const c = captureConsole()
  try {
    log('info', 'test-scope', 'hello world', { a: 1 })
    assert.ok(c.calls.length >= 1)
    const msg = c.calls[0].args[0] as string
    assert.ok(msg.includes('[test-scope]'))
    assert.ok(msg.includes('hello world'))
  } finally {
    c.restore()
  }
})

await ok('级别过滤：debug 低于最小级别被过滤', () => {
  const c = captureConsole()
  try {
    setLogLevel('warn')
    log('info', 's', 'should-not-appear')
    logger.debug('s', 'also-hidden')
    log('warn', 's', 'visible-warn')
    log('error', 's', 'visible-error')
    assert.equal(c.calls.length, 2)
    assert.ok((c.calls[0].args[0] as string).includes('visible-warn'))
  } finally {
    setLogLevel('debug')
    c.restore()
  }
})

await ok('渠道可插拔：关闭 console 后无输出，恢复后正常', () => {
  const c = captureConsole()
  try {
    setSinkEnabled('console', false)
    log('info', 's', 'hidden-when-off')
    assert.equal(c.calls.length, 0)
    setSinkEnabled('console', true)
    log('info', 's', 'visible-after-on')
    assert.ok(c.calls.length >= 1)
  } finally {
    setSinkEnabled('console', true)
    c.restore()
  }
})

await ok('日志渠道自身抛错不影响业务（server 预留渠道）', () => {
  const c = captureConsole()
  try {
    setSinkEnabled('server', true)
    ;(LOG_SINKS.find((s) => s.id === 'server') as any).log = () => {
      throw new Error('sink broken')
    }
    log('info', 's', 'still-works')
    assert.ok(c.calls.length >= 1, 'console 输出不受 server 渠道异常影响')
  } finally {
    setSinkEnabled('server', false)
    c.restore()
  }
})

await ok('logger.debug / error 快捷方法', () => {
  const c = captureConsole()
  try {
    logger.debug('s', 'd')
    logger.error('s', 'e', { code: 500 })
    assert.ok(c.calls.length === 2)
    assert.ok((c.calls[1].args[0] as string).includes('[s]'))
  } finally {
    c.restore()
  }
})

console.log(`\n全部通过：${passed} 项 ✅`)
