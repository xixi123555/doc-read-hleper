/**
 * Agent 运行时单元测试（mock Provider，不依赖网络/浏览器）
 * 覆盖：对话流式 / 总结流式 / 工具调用循环 / 未配置报错 / 未知能力 / 中止
 * 运行：npx tsx tests/agent.test.ts
 */
import assert from 'node:assert'
import { AgentRuntime } from '../src/background/agent/AgentRuntime'
import { AgentEvent, AgentRequest } from '../src/background/agent/types'
import { CapabilityRegistry } from '../src/background/capabilities/Capability'
import { ChatCapability } from '../src/background/capabilities/ChatCapability'
import { SummarizeCapability } from '../src/background/capabilities/SummarizeCapability'
import { TranslateCapability } from '../src/background/capabilities/TranslateCapability'
import { ValidateCapability } from '../src/background/capabilities/ValidateCapability'
import { SkillRegistry } from '../src/background/skills/SkillRegistry'
import { loadBuiltinSkills } from '../src/background/skills/skills/builtin'
import { ToolRegistry } from '../src/background/tools/ToolRegistry'
import { createGetPageContextTool } from '../src/background/tools/tools/getPageContextTool'
import { ChatProvider, ProviderEvent } from '../src/background/providers/ChatProvider'
import { ModelConfig } from '../src/shared/types'

const CFG: ModelConfig = {
  id: 't', name: 'test', baseUrl: 'https://x/v1', apiKey: '', model: 'm',
  temperature: 0.2, maxTokens: 4096, timeout: 5, createdAt: 0,
}

/** Mock Provider：按计划序列返回事件 */
class MockProvider implements ChatProvider {
  id = 'mock' as const
  constructor(private plan: (ProviderEvent[] | 'tool-loop')[]) {}

  async *stream(_m: any, _c: any, signal?: AbortSignal): AsyncGenerator<ProviderEvent> {
    const round = this.plan.shift()
    if (round === 'tool-loop') {
      yield { kind: 'tool-calls', calls: [{ id: 'c1', name: 'get_page_context', arguments: {} }] }
      return
    }
    for (const ev of round ?? []) {
      if (signal?.aborted) throw new Error('请求已取消')
      yield ev
    }
  }

  async complete(): Promise<string> {
    return '{"mode":"word","phonetics":{"uk":"/wɜːd/","us":"/wɜːrd/"},"literal":[{"pos":"n.","meaning":"单词"}],"contextual":"结合上下文的翻译"}'
  }

  validate() {
    return { ok: true, message: 'ok', latencyMs: 1 }
  }
}

/** 阻塞型 Provider：产出首块后挂起，直到收到 abort 信号再抛「取消」 */
class BlockingProvider implements ChatProvider {
  id = 'block' as const

  async *stream(_m: any, _c: any, signal?: AbortSignal): AsyncGenerator<ProviderEvent> {
    yield { kind: 'delta', text: 'start' }
    await new Promise<void>((resolve) => {
      if (signal?.aborted) return resolve()
      signal?.addEventListener('abort', () => resolve(), { once: true })
    })
    if (signal?.aborted) throw new Error('请求已取消')
    yield { kind: 'delta', text: 'never' }
  }

  complete(): Promise<string> {
    return Promise.resolve('')
  }

  validate() {
    return { ok: true, message: 'ok', latencyMs: 0 }
  }
}

class MockProviderFactory {
  constructor(private provider: ChatProvider) {}
  create(): ChatProvider {
    return this.provider
  }
}

function buildRuntime(provider: ChatProvider, withConfig = true, config = CFG) {
  const caps = new CapabilityRegistry()
  caps.register(new ChatCapability())
  caps.register(new SummarizeCapability())
  caps.register(new TranslateCapability())
  caps.register(new ValidateCapability())
  const skills = new SkillRegistry()
  loadBuiltinSkills(skills)
  const tools = new ToolRegistry()
  tools.register(createGetPageContextTool())
  const runtime = new AgentRuntime({
    providerFactory: new MockProviderFactory(provider) as unknown as any,
    capabilities: caps,
    skillRegistry: skills,
    toolRegistry: tools,
    configStore: { getActiveConfig: async () => (withConfig ? config : null) },
  })
  return runtime
}

async function collect(runtime: AgentRuntime, req: AgentRequest): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  for await (const ev of runtime.handle(req)) events.push(ev)
  return events
}

let passed = 0
function ok(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++
      console.log(`  ✅ ${name}`)
    })
}

console.log('== AgentRuntime ==')

await ok('对话流式：chunk 事件 + done 完整内容', async () => {
  const p = new MockProvider([[{ kind: 'delta', text: 'Hel' }, { kind: 'delta', text: 'lo' }]])
  const runtime = buildRuntime(p)
  const evs = await collect(runtime, { kind: 'chat', input: 'hi' })
  assert.deepEqual(
    evs.map((e) => e.type),
    ['chunk', 'chunk', 'done'],
  )
  assert.equal((evs[0] as any).delta, 'Hel')
  assert.equal((evs[2] as any).content, 'Hello')
})

await ok('未配置模型 → 明确错误事件（文案与历史一致）', async () => {
  const runtime = buildRuntime(new MockProvider([]), false)
  const evs = await collect(runtime, { kind: 'chat', input: 'hi' })
  assert.equal(evs.length, 1)
  assert.equal(evs[0].type, 'error')
  assert.equal((evs[0] as any).message, '尚未配置大模型，请点击插件图标打开配置面板完成设置')
})

await ok('总结能力：流式产出', async () => {
  const p = new MockProvider([[{ kind: 'delta', text: '总结' }]])
  const runtime = buildRuntime(p)
  const evs = await collect(runtime, {
    kind: 'summarize',
    input: '',
    history: [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a' }],
    meta: { title: 'T', url: 'u', domain: 'd' },
  })
  assert.equal((evs[0] as any).delta, '总结')
  assert.equal(evs[1].type, 'done')
})

await ok('工具调用循环：调用 → 执行 → 回填 → 二轮出结果', async () => {
  const p = new MockProvider([
    [
      { kind: 'delta', text: '让我查一下页面' },
      { kind: 'tool-calls', calls: [{ id: 'c1', name: 'get_page_context', arguments: {} }] },
    ],
    [{ kind: 'delta', text: '答案是 X' }],
  ])
  const runtime = buildRuntime(p)
  const evs = await collect(runtime, {
    kind: 'chat',
    input: '这个页面讲了什么',
    allowTools: true,
    pageContext: {
      title: 'Demo', url: 'https://demo', lang: 'en', wordCount: 10,
      outline: [{ level: 2, text: '章节' }], codeBlocks: [], text: '正文内容', truncated: false,
    },
  })
  const types = evs.map((e) => e.type)
  assert.deepEqual(types, ['chunk', 'tool-call', 'tool-result', 'chunk', 'done'])
  assert.equal((evs[1] as any).tool, 'get_page_context')
  assert.equal((evs[2] as any).ok, true)
  assert.equal((evs[4] as any).content, '让我查一下页面答案是 X')
})

await ok('默认不启用工具：模型发工具调用被忽略，直接 done', async () => {
  const p = new MockProvider([
    [
      { kind: 'delta', text: 'd1' },
      { kind: 'tool-calls', calls: [{ id: 'c1', name: 'get_page_context', arguments: {} }] },
    ],
  ])
  const runtime = buildRuntime(p)
  const evs = await collect(runtime, { kind: 'chat', input: 'hi' })
  assert.equal((evs[0] as any).delta, 'd1')
  assert.equal(evs[1].type, 'done')
})

await ok('未知能力 → 错误事件', async () => {
  const runtime = buildRuntime(new MockProvider([]))
  const evs = await collect(runtime, { kind: 'unknown' as any, input: '' })
  assert.equal(evs[0].type, 'error')
})

await ok('翻译能力：complete 一次返回结构化 JSON', async () => {
  const runtime = buildRuntime(new MockProvider([]))
  const evs = await collect(runtime, {
    kind: 'translate',
    input: 'word',
    data: { text: 'word', mode: 'word', snippet: 'a word', pageTitle: 'T' },
  })
  assert.equal(evs.length, 1)
  assert.equal(evs[0].type, 'done')
  const out = (evs[0] as any).toolOutput
  assert.equal(out.ok, true)
  assert.equal(out.data.mode, 'word')
})

await ok('校验能力：无已保存配置也可校验请求自带配置（无回归）', async () => {
  const runtime = buildRuntime(new MockProvider([]), false)
  const evs = await collect(runtime, {
    kind: 'validate',
    input: '',
    data: { ...CFG, apiKey: '' },
  })
  assert.equal(evs.length, 1)
  assert.equal(evs[0].type, 'done')
  const out = (evs[0] as any).toolOutput
  assert.equal(out.ok, true)
})

await ok('中止：abort(id) 后流以取消错误中断', async () => {
  const p = new BlockingProvider()
  const runtime = buildRuntime(p)
  const req: AgentRequest = { id: 'req-1', kind: 'chat', input: 'hi' }
  let rejected = false
  const consumer = (async () => {
    for await (const _ of runtime.handle(req)) {
      /* consume */
    }
  })().catch((e) => {
    rejected = true
    assert.ok(String(e?.message || e).includes('取消'), `错误信息应含「取消」，实际：${e?.message}`)
  })
  await new Promise((r) => setTimeout(r, 20))
  runtime.abort('req-1')
  await consumer
  assert.ok(rejected, '应当以取消错误结束')
})

await ok('内置技能注册表：默认启用集含 tech-doc-reading，其余可插拔注册', () => {
  const skills = new SkillRegistry()
  loadBuiltinSkills(skills)
  assert.ok(skills.get('tech-doc-reading'), '技术文档阅读技能应存在')
  assert.ok(skills.get('summarizer'), '总结技能应存在')
  assert.ok(!skills.get('release-notes'), 'release-notes 技能已移除')
  assert.ok(skills.get('code-analyst'), '代码解析技能应存在')
})

console.log(`\n全部通过：${passed} 项 ✅`)
