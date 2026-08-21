/**
 * 流式 LLM 客户端测试：SSE 流式 / 非流式 JSON 回退 / 错误处理（mock fetch）
 * 运行：npx tsx tests/llm-stream.test.ts
 */
import assert from 'node:assert'
import { LLMError, parseJsonBody, streamChatLLM } from '../src/background/llm'
import { LLMChatMessage, ModelConfig } from '../src/shared/types'

const cfg: ModelConfig = {
  id: 't',
  name: 'test',
  baseUrl: 'https://api.test.example/v1',
  apiKey: 'sk-test',
  model: 'test-model',
  temperature: 0.2,
  maxTokens: 100,
  timeout: 5,
  createdAt: 0,
}
const msgs: LLMChatMessage[] = [{ role: 'user', content: 'hi' }]

function sseBody(lines: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(c) {
      for (const l of lines) c.enqueue(enc.encode(l))
      c.close()
    },
  })
}

function stubFetch(res: Response): () => void {
  const orig = globalThis.fetch
  ;(globalThis as any).fetch = async () => res
  return () => {
    ;(globalThis as any).fetch = orig
  }
}

async function collect(gen: AsyncGenerator<string>): Promise<string[]> {
  const out: string[] = []
  for await (const d of gen) out.push(d)
  return out
}

async function expectThrow(gen: AsyncGenerator<string>, contains: string) {
  let threw: Error | null = null
  try {
    for await (const _ of gen) {
      /* drain */
    }
  } catch (e) {
    threw = e as Error
  }
  assert.ok(threw, `应当抛出异常（期望包含: ${contains}）`)
  assert.ok(threw.message.includes(contains), `异常信息「${threw.message}」应包含「${contains}」`)
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

console.log('== streamChatLLM ==')

await ok('标准 SSE 流式：逐 token 产出', async () => {
  const restore = stubFetch(
    new Response(
      sseBody([
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
      { status: 200 },
    ),
  )
  try {
    const out = await collect(streamChatLLM(cfg, msgs))
    assert.deepEqual(out, ['Hel', 'lo'])
  } finally {
    restore()
  }
})

await ok('SSE 全部数据在首块内也能解析', async () => {
  const restore = stubFetch(
    new Response(
      sseBody(['data: {"choices":[{"delta":{"content":"one"}}]}\n\ndata: {"choices":[{"delta":{"content":"two"}}]}\n\ndata: [DONE]\n\n']),
      { status: 200 },
    ),
  )
  try {
    const out = await collect(streamChatLLM(cfg, msgs))
    assert.deepEqual(out, ['one', 'two'])
  } finally {
    restore()
  }
})

await ok('流式末块 message.content 兜底输出', async () => {
  const restore = stubFetch(
    new Response(
      sseBody(['data: {"choices":[{"message":{"content":"complete answer"}}]}\n\n', 'data: [DONE]\n\n']),
      { status: 200 },
    ),
  )
  try {
    const out = await collect(streamChatLLM(cfg, msgs))
    assert.deepEqual(out, ['complete answer'])
  } finally {
    restore()
  }
})

await ok('非流式 JSON 回退：网关忽略 stream:true', async () => {
  const body = JSON.stringify({ choices: [{ message: { content: 'full answer in json' } }] })
  const restore = stubFetch(new Response(body, { status: 200 }))
  try {
    const out = await collect(streamChatLLM(cfg, msgs))
    assert.deepEqual(out, ['full answer in json'])
  } finally {
    restore()
  }
})

await ok('非流式 JSON 空内容 → 明确报错（不再静默为空）', async () => {
  const body = JSON.stringify({ choices: [{ message: { content: '' } }] })
  const restore = stubFetch(new Response(body, { status: 200 }))
  try {
    await expectThrow(streamChatLLM(cfg, msgs), '接口未返回内容')
  } finally {
    restore()
  }
})

await ok('HTTP 错误 → LLMError 携带接口原因', async () => {
  const body = JSON.stringify({ error: { message: 'Invalid API key' } })
  const restore = stubFetch(new Response(body, { status: 401 }))
  try {
    await expectThrow(streamChatLLM(cfg, msgs), 'Invalid API key')
  } finally {
    restore()
  }
})

await ok('流中间错误事件 → 抛出', async () => {
  const restore = stubFetch(
    new Response(
      sseBody(['data: {"choices":[{"delta":{"content":"partial"}}]}\n\n', 'data: {"error":{"message":"mid-stream failure"}}\n\n']),
      { status: 200 },
    ),
  )
  try {
    await expectThrow(streamChatLLM(cfg, msgs), 'mid-stream failure')
  } finally {
    restore()
  }
})

await ok('SSE 响应无任何内容 → 明确报错', async () => {
  const restore = stubFetch(new Response(sseBody(['data: [DONE]\n\n']), { status: 200 }))
  try {
    await expectThrow(streamChatLLM(cfg, msgs), '接口未返回任何内容')
  } finally {
    restore()
  }
})

console.log('== parseJsonBody ==')
await ok('裸 JSON', () => {
  assert.equal(parseJsonBody('{"a":1}').a, 1)
})
await ok('围栏 + 前后杂文', () => {
  const r = parseJsonBody('```json\n{"mode":"word"}\n``` 说明文字')
  assert.equal(r.mode, 'word')
})
await ok('非法输入 → null', () => {
  assert.equal(parseJsonBody('<html>error</html>'), null)
})

console.log(`\n全部通过：${passed} 项 ✅`)
