/**
 * PortHub 协议集成测试：验证 UI 端收到的消息名与历史协议完全一致
 * （llm-chunk / llm-done / llm-error / summarize-chunk / summarize-done / abort）
 * 运行：npx tsx tests/port.test.ts
 */
import assert from 'node:assert'
import { AgentRuntime } from '../src/background/agent/AgentRuntime'
import { CapabilityRegistry } from '../src/background/capabilities/Capability'
import { ChatCapability } from '../src/background/capabilities/ChatCapability'
import { SummarizeCapability } from '../src/background/capabilities/SummarizeCapability'
import { SkillRegistry } from '../src/background/skills/SkillRegistry'
import { loadBuiltinSkills } from '../src/background/skills/skills/builtin'
import { ToolRegistry } from '../src/background/tools/ToolRegistry'
import { ChatProvider, ProviderEvent } from '../src/background/providers/ChatProvider'
import { PortHub } from '../src/background/router/PortHub'
import { ModelConfig } from '../src/shared/types'

const CFG: ModelConfig = {
  id: 't', name: 'test', baseUrl: 'https://x/v1', apiKey: '', model: 'm',
  temperature: 0.2, maxTokens: 4096, timeout: 5, createdAt: 0,
}

class FakeProvider implements ChatProvider {
  id = 'fake' as const
  plan: ProviderEvent[] = [{ kind: 'delta', text: '答' }, { kind: 'delta', text: '案' }]
  async *stream(): AsyncGenerator<ProviderEvent> {
    for (const ev of this.plan) yield ev
  }
  complete(): Promise<string> {
    return Promise.resolve('ok')
  }
  validate() {
    return { ok: true, message: 'ok', latencyMs: 1 }
  }
}

class FakePort {
  name: string
  messages: any[] = []
  private handler?: (msg: any) => void
  onMessage = { addListener: (fn: (msg: any) => void) => (this.handler = fn) }
  onDisconnect = { addListener: () => undefined }
  postMessage = (msg: any) => this.messages.push(msg)
  constructor(name: string) {
    this.name = name
  }
  emit(msg: any) {
    this.handler?.(msg)
  }
}

function buildHub() {
  const caps = new CapabilityRegistry()
  caps.register(new ChatCapability())
  caps.register(new SummarizeCapability())
  const skills = new SkillRegistry()
  loadBuiltinSkills(skills)
  const runtime = new AgentRuntime({
    providerFactory: { create: () => new FakeProvider() } as any,
    capabilities: caps,
    skillRegistry: skills,
    toolRegistry: new ToolRegistry(),
    configStore: { getActiveConfig: async () => CFG },
  })
  return new PortHub(runtime)
}

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms))
let passed = 0
function ok(name: string, fn: () => Promise<void>) {
  return fn().then(() => {
    passed++
    console.log(`  ✅ ${name}`)
  })
}

console.log('== PortHub 协议兼容 ==')

await ok('llm-chat → llm-chunk / llm-done（消息名与历史一致）', async () => {
  const hub = buildHub()
  const port = new FakePort('chat-port')
  hub.attach(port)
  port.emit({
    type: 'llm-chat',
    payload: { id: 'm1', messages: [{ role: 'user', content: 'hi' }], pageContext: null },
  })
  await tick()
  const types = port.messages.map((m) => m.type)
  assert.deepEqual(types, ['llm-chunk', 'llm-chunk', 'llm-done'])
  assert.equal(port.messages[0].id, 'm1')
  assert.equal(port.messages[0].delta, '答')
  assert.equal(port.messages[2].content, '答案')
})

await ok('summarize → summarize-chunk / summarize-done', async () => {
  const hub = buildHub()
  const port = new FakePort('chat-port')
  hub.attach(port)
  port.emit({
    type: 'summarize',
    payload: {
      id: 's1',
      messages: [{ role: 'user', content: 'q' }],
      pageMeta: { title: 'T', url: 'u', domain: 'd' },
    },
  })
  await tick()
  const types = port.messages.map((m) => m.type)
  assert.deepEqual(types, ['summarize-chunk', 'summarize-chunk', 'summarize-done'])
  assert.equal(port.messages[2].id, 's1')
})

await ok('popup-port 同样被接受', async () => {
  const hub = buildHub()
  const port = new FakePort('popup-port')
  hub.attach(port)
  port.emit({ type: 'llm-chat', payload: { id: 'p1', messages: [{ role: 'user', content: 'x' }] } })
  await tick()
  assert.equal(port.messages.at(-1)?.type, 'llm-done')
})

await ok('非 chat/summarize 端口被忽略', async () => {
  const hub = buildHub()
  const port = new FakePort('other-port')
  hub.attach(port)
  port.emit({ type: 'llm-chat', payload: { id: 'x', messages: [{ role: 'user', content: 'x' }] } })
  await tick()
  assert.equal(port.messages.length, 0)
})

console.log(`\n全部通过：${passed} 项 ✅`)
