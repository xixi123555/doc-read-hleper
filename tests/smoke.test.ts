/**
 * 运行时冒烟测试：核心纯逻辑（不依赖浏览器环境）。
 * 运行：npx tsx tests/smoke.test.ts
 */
import assert from 'node:assert'
import {
  buildChatUrl,
  estimateTokens,
  parseLooseJson,
  truncateContextText,
} from '../src/background/llm'
import { encryptText, decryptText } from '../src/shared/crypto'
import {
  buildChatMessages,
  buildPageBlock,
  buildSummarizePrompt,
  buildTranslationPrompt,
  QUICK_COMMANDS,
  SYSTEM_PROMPT,
} from '../src/shared/prompts'
import { PRESETS, createConfigFromPreset, presetById } from '../src/shared/presets'
import { isConfigComplete } from '../src/shared/storage'
import { buildExportDoc, buildFilename, EXPORT_TARGETS } from '../src/chat/exporters'
import { renderMarkdown } from '../src/chat/markdown'

let passed = 0
function ok(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ✅ ${name}`)
}

console.log('== llm.ts ==')
ok('buildChatUrl: DeepSeek 官方 base_url（无 /v1）→ /chat/completions', () => {
  assert.equal(buildChatUrl('https://api.deepseek.com'), 'https://api.deepseek.com/chat/completions')
})
ok('buildChatUrl: DeepSeek 带 /v1 亦兼容', () => {
  assert.equal(buildChatUrl('https://api.deepseek.com/v1'), 'https://api.deepseek.com/v1/chat/completions')
})
ok('buildChatUrl: qwen compatible-mode/v1', () => {
  assert.equal(buildChatUrl('https://dashscope.aliyuncs.com/compatible-mode/v1'), 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions')
})
ok('buildChatUrl: zhipu v4（版本段原样保留）', () => {
  assert.equal(buildChatUrl('https://open.bigmodel.cn/api/paas/v4'), 'https://open.bigmodel.cn/api/paas/v4/chat/completions')
})
ok('buildChatUrl: 裸域名不再自动补 /v1', () => {
  assert.equal(buildChatUrl('https://api.example.com/'), 'https://api.example.com/chat/completions')
})
ok('buildChatUrl: 已是完整 URL', () => {
  assert.equal(buildChatUrl('https://x.com/v1/chat/completions'), 'https://x.com/v1/chat/completions')
})
ok('buildChatUrl: 空地址抛出明确错误', () => {
  assert.throws(() => buildChatUrl(''), /接口地址未配置/)
})
ok('estimateTokens 混合文本', () => {
  const t = 'hello world ' + '中文技术文档'.repeat(10)
  assert.ok(estimateTokens(t) > 0)
})
ok('truncateContextText 超长截断', () => {
  const { text, truncated } = truncateContextText('a'.repeat(100000), 4096)
  assert.equal(truncated, true)
  assert.ok(text.length < 100000)
})
ok('truncateContextText 短文不截断', () => {
  const { truncated } = truncateContextText('short', 4096)
  assert.equal(truncated, false)
})
ok('parseLooseJson: 裸 JSON', () => {
  const r = parseLooseJson('{"mode":"word","literal":"x"}')
  assert.equal(r.mode, 'word')
})
ok('parseLooseJson: markdown 围栏', () => {
  const r = parseLooseJson('```json\n{"mode":"phrase","literal":"直译"}\n```')
  assert.equal(r.mode, 'phrase')
})
ok('parseLooseJson: 前后杂文', () => {
  const r = parseLooseJson('好的，结果如下：\n{"a":1}\n完毕')
  assert.equal(r.a, 1)
})
ok('parseLooseJson: 非法输入返回 null', () => {
  assert.equal(parseLooseJson('not json at all'), null)
})

console.log('== crypto.ts ==')
ok('AES-GCM 加解密回环', async () => {
  const secret = 'sk-very-secret-key-123'
  const enc = await encryptText(secret)
  assert.notEqual(enc, secret)
  assert.ok(enc.includes('.'))
  const dec = await decryptText(enc)
  assert.equal(dec, secret)
})
ok('空串往返', async () => {
  assert.equal(await decryptText(''), '')
  assert.equal(await encryptText(''), '')
})
ok('错误密文解密为空串', async () => {
  assert.equal(await decryptText('bad.payload'), '')
})

console.log('== prompts.ts ==')
ok('SYSTEM_PROMPT 非空', () => {
  assert.ok(SYSTEM_PROMPT.length > 100)
})
ok('buildPageBlock 包含标题与正文', () => {
  const block = buildPageBlock({
    title: 'T', url: 'https://a.com', lang: 'en', wordCount: 10,
    outline: [{ level: 2, text: 'Section' }],
    codeBlocks: [{ lang: 'js', code: 'const a=1' }],
    text: 'body text', truncated: false,
  })
  assert.ok(block.includes('T'))
  assert.ok(block.includes('body text'))
  assert.ok(block.includes('const a=1'))
})
ok('buildChatMessages 组装正确', () => {
  const msgs = buildChatMessages({
    pageBlock: 'PAGE',
    history: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }],
    question: '再问一次',
  })
  assert.equal(msgs[0].role, 'system')
  assert.equal(msgs.length, 4)
  assert.ok(msgs[3].content.includes('PAGE'))
  assert.ok(msgs[3].content.includes('再问一次'))
})
ok('QUICK_COMMANDS 有 5 项', () => {
  assert.equal(QUICK_COMMANDS.length, 5)
})
ok('buildTranslationPrompt 含 JSON 要求', () => {
  const p = buildTranslationPrompt({ text: 'deploy', mode: 'word', snippet: 'deploy the app', pageTitle: 'Docs' })
  assert.ok(p.includes('phonetics'))
})
ok('buildSummarizePrompt 含对话来源', () => {
  const p = buildSummarizePrompt({ pageTitle: 'T', pageUrl: 'https://a.com', domain: 'a.com', conversation: 'Q&A' })
  assert.ok(p.includes('a.com'))
})

console.log('== isConfigComplete ==')
ok('配置完整：接口+模型+密钥', () => {
  assert.equal(isConfigComplete({ id: 'a', name: 'n', baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm', temperature: 0.2, maxTokens: 1, timeout: 1, createdAt: 0 }), true)
})
ok('配置完整：接口+模型+本地免密', () => {
  assert.equal(isConfigComplete({ id: 'a', name: 'n', baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'llama3', noKey: true, temperature: 0.2, maxTokens: 1, timeout: 1, createdAt: 0 }), true)
})
ok('配置不完整：缺接口地址', () => {
  assert.equal(isConfigComplete({ id: 'a', name: 'n', baseUrl: '', apiKey: 'sk', model: 'm', temperature: 0.2, maxTokens: 1, timeout: 1, createdAt: 0 }), false)
})
ok('配置不完整：无密钥且未勾选免密', () => {
  assert.equal(isConfigComplete({ id: 'a', name: 'n', baseUrl: 'https://x/v1', apiKey: '', model: 'm', temperature: 0.2, maxTokens: 1, timeout: 1, createdAt: 0 }), false)
})
ok('配置不完整：null/空', () => {
  assert.equal(isConfigComplete(null), false)
  assert.equal(isConfigComplete(undefined), false)
})

console.log('== presets.ts ==')
ok('预设齐全（含本地 Ollama）', () => {
  assert.ok(PRESETS.length >= 5)
  assert.ok(presetById('ollama'))
  const c = createConfigFromPreset('deepseek')
  // DeepSeek 官方 OpenAI 兼容接入：base_url 无需 /v1，模型为 v4 系列
  assert.equal(c.baseUrl, 'https://api.deepseek.com')
  assert.equal(c.model, 'deepseek-v4-flash')
  assert.equal(c.temperature, 0.2)
})

console.log('== exporters.ts ==')
ok('导出渠道可插拔注册表', () => {
  assert.equal(EXPORT_TARGETS.length, 3)
  assert.ok(EXPORT_TARGETS.find((t) => t.id === 'download')?.available)
  assert.ok(!EXPORT_TARGETS.find((t) => t.id === 'server')?.available)
})
ok('完整对话模式生成 MD 含来源与问答', () => {
  const doc = buildExportDoc({
    mode: 'full',
    title: 'React 文档',
    url: 'https://react.dev',
    domain: 'react.dev',
    messages: [
      { role: 'user', content: '什么是 Hook？', ts: 1 },
      { role: 'assistant', content: 'Hook 是函数…`useState`', ts: 2 },
    ],
  })
  assert.ok(doc.includes('React 文档'))
  assert.ok(doc.includes('https://react.dev'))
  assert.ok(doc.includes('什么是 Hook？'))
  assert.ok(doc.includes('useState'))
})
ok('AI 模式生成 MD 含总结区', () => {
  const doc = buildExportDoc({
    mode: 'ai', title: 'T', url: 'u', domain: 'd',
    messages: [], aiSummary: '## 核心问题\n- q1',
  })
  assert.ok(doc.includes('## 核心问题'))
})
ok('文件名含时间戳', () => {
  const f = buildFilename('我的 文档:教程')
  assert.ok(/\.md$/.test(f))
  assert.ok(!/[:]/.test(f))
})

console.log('== markdown.ts ==')
ok('markdown 渲染（代码块高亮）', () => {
  const html = renderMarkdown('```js\nconst x = 1\n```\n\n**bold** `inline`')
  assert.ok(html.includes('<pre'))
  assert.ok(html.includes('<strong>bold</strong>'))
  assert.ok(html.includes('<code>inline</code>'))
})
ok('markdown 转义原始 HTML（XSS 安全）', () => {
  const html = renderMarkdown('<script>alert(1)</script>')
  assert.ok(!html.includes('<script>alert(1)</script>'))
  assert.ok(html.includes('&lt;script&gt;'))
})

console.log(`\n全部通过：${passed} 项 ✅`)
