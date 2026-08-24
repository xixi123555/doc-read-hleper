/**
 * 发布版本化逻辑测试（release-lib.mjs）
 * 运行：node tests/release.test.mjs
 */
import assert from 'node:assert'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  computeFingerprints,
  fingerprintsEqual,
  nextVersion,
  parseVersion,
  uniqueVersion,
} from '../scripts/release-lib.mjs'
import {
  appendUpdateFile,
  chatUrl,
  fallbackChangelog,
  localDateString,
  parseBumpJson,
  parseDotEnv,
  parseJsonObject,
  renderTechDoc,
  renderUpdateEntry,
  resolveModelConfig,
} from '../scripts/llm-release.mjs'

let passed = 0
function ok(name, fn) {
  fn()
  passed++
  console.log(`  ✅ ${name}`)
}

console.log('== parseVersion ==')
ok('合法版本', () => {
  assert.deepEqual(parseVersion('1.2.3'), [1, 2, 3])
})
ok('非法版本返回 null', () => {
  assert.equal(parseVersion('1.2'), null)
  assert.equal(parseVersion('a.b.c'), null)
  assert.equal(parseVersion(''), null)
})

console.log('== nextVersion（递增规则） ==')
ok('major：重构/大变动 → 第一位 +1', () => {
  assert.equal(nextVersion('1.2.3', 'major'), '2.0.0')
})
ok('minor：新模块/较大功能 → 第二位 +1', () => {
  assert.equal(nextVersion('1.2.3', 'minor'), '1.3.0')
})
ok('patch：小优化/小 bug → 第三位 +1', () => {
  assert.equal(nextVersion('1.2.3', 'patch'), '1.2.4')
  assert.equal(nextVersion('1.2.3'), '1.2.4')
})

console.log('== uniqueVersion（版本不得重复） ==')
ok('历史无冲突直接使用', () => {
  assert.equal(uniqueVersion('1.0.0', []), '1.0.0')
})
ok('冲突时自动递增直到唯一', () => {
  assert.equal(uniqueVersion('1.0.0', ['1.0.0', '1.0.1']), '1.0.2')
})
ok('连续生成不重复', () => {
  const history = []
  const v1 = uniqueVersion('1.0.0', history)
  history.push(v1)
  const v2 = uniqueVersion('1.0.0', history)
  history.push(v2)
  assert.notEqual(v1, v2)
})

console.log('== computeFingerprints / fingerprintsEqual ==')
ok('相同内容指纹一致', () => {
  const d1 = mkdtempSync(join(tmpdir(), 'fp1-'))
  const d2 = mkdtempSync(join(tmpdir(), 'fp2-'))
  try {
    for (const d of [d1, d2]) {
      mkdirSync(join(d, 'js'), { recursive: true })
      writeFileSync(join(d, 'js', 'a.js'), 'const x=1')
      writeFileSync(join(d, 'index.html'), '<html></html>')
      writeFileSync(join(d, 'manifest.json'), '{"version":"1.0.0"}')
    }
    assert.ok(fingerprintsEqual(computeFingerprints(d1), computeFingerprints(d2)))
  } finally {
    rmSync(d1, { recursive: true, force: true })
    rmSync(d2, { recursive: true, force: true })
  }
})
ok('内容变动 → 指纹不同', () => {
  const d1 = mkdtempSync(join(tmpdir(), 'fp1-'))
  const d2 = mkdtempSync(join(tmpdir(), 'fp2-'))
  try {
    for (const d of [d1, d2]) writeFileSync(join(d, 'a.js'), 'const x=1')
    writeFileSync(join(d2, 'a.js'), 'const x=2')
    assert.ok(!fingerprintsEqual(computeFingerprints(d1), computeFingerprints(d2)))
  } finally {
    rmSync(d1, { recursive: true, force: true })
    rmSync(d2, { recursive: true, force: true })
  }
})
ok('manifest.json 被排除在指纹外（版本号变动不触发重打包）', () => {
  const d1 = mkdtempSync(join(tmpdir(), 'fp1-'))
  const d2 = mkdtempSync(join(tmpdir(), 'fp2-'))
  try {
    for (const d of [d1, d2]) writeFileSync(join(d, 'a.js'), 'const x=1')
    writeFileSync(join(d1, 'manifest.json'), '{"version":"1.0.0"}')
    writeFileSync(join(d2, 'manifest.json'), '{"version":"2.0.0"}')
    assert.ok(fingerprintsEqual(computeFingerprints(d1), computeFingerprints(d2)))
  } finally {
    rmSync(d1, { recursive: true, force: true })
    rmSync(d2, { recursive: true, force: true })
  }
})

console.log('== parseBumpJson（大模型输出解析） ==')
ok('标准 JSON', () => {
  assert.deepEqual(parseBumpJson('{"bump":"minor","reason":"新增划词提问模块"}'), {
    bump: 'minor',
    reason: '新增划词提问模块',
  })
})
ok('容忍 markdown 代码块与多余文本', () => {
  const r = parseBumpJson('好的，结果如下：\n```json\n{"bump": "major", "reason": "整体重构"}\n```\n以上。')
  assert.equal(r.bump, 'major')
  assert.equal(r.reason, '整体重构')
})
ok('bump 大小写归一化', () => {
  assert.equal(parseBumpJson('{"bump":"PATCH","reason":"修 bug"}').bump, 'patch')
})
ok('非法级别抛错', () => {
  assert.throws(() => parseBumpJson('{"bump":"huge","reason":"x"}'))
})
ok('非 JSON 输出抛错', () => {
  assert.throws(() => parseBumpJson('抱歉，我无法判断'))
})

console.log('== parseDotEnv / resolveModelConfig（.env 解析） ==')
ok('解析带空格、引号、注释的 .env', () => {
  const env = parseDotEnv([
    '# 注释行',
    '',
    "MODEL_BASE_URL = 'https://api.deepseek.com'",
    'MODEL_API_KEY="sk-test"',
    'MODEL_NAME=deepseek-v4-flash',
  ].join('\n'))
  assert.equal(env.MODEL_BASE_URL, 'https://api.deepseek.com')
  assert.equal(env.MODEL_API_KEY, 'sk-test')
  assert.equal(env.MODEL_NAME, 'deepseek-v4-flash')
})
ok('配置完整 → 返回模型配置', () => {
  const cfg = resolveModelConfig({
    MODEL_BASE_URL: 'https://api.deepseek.com',
    MODEL_API_KEY: 'sk-1',
    MODEL_NAME: 'deepseek-v4-flash',
  })
  assert.equal(cfg.model, 'deepseek-v4-flash')
})
ok('缺少 baseUrl / model → null', () => {
  assert.equal(resolveModelConfig({ MODEL_API_KEY: 'sk-1' }), null)
  assert.equal(resolveModelConfig({ MODEL_BASE_URL: 'x', MODEL_NAME: '' }), null)
})
ok('chatUrl 规范化（去尾部斜杠、不自动补 /v1）', () => {
  assert.equal(chatUrl('https://api.deepseek.com/'), 'https://api.deepseek.com/chat/completions')
  assert.equal(chatUrl('https://api.deepseek.com/v1'), 'https://api.deepseek.com/v1/chat/completions')
})

console.log('== parseJsonObject（通用 JSON 提取） ==')
ok('提取被文本包裹的 JSON', () => {
  const obj = parseJsonObject('以下是结果：\n```json\n{"tech":"a","product":"b"}\n```\n完毕')
  assert.deepEqual(obj, { tech: 'a', product: 'b' })
})
ok('非 JSON 抛错', () => {
  assert.throws(() => parseJsonObject('抱歉，无法生成'))
})

console.log('== 变更文档渲染 / 追加 ==')
ok('localDateString 格式 YYYY-MM-DD', () => {
  assert.match(localDateString(new Date(2026, 7, 24)), /^\d{4}-\d{2}-\d{2}$/)
})
ok('renderTechDoc 含版本与正文', () => {
  const doc = renderTechDoc({ version: '1.2.0', body: '- 新增模块 X', date: '2026-08-24' })
  assert.ok(doc.includes('# v1.2.0 · 2026-08-24'))
  assert.ok(doc.includes('- 新增模块 X'))
})
ok('renderUpdateEntry 含版本与日期标题', () => {
  const entry = renderUpdateEntry({ version: '1.2.0', body: '- 新增划词提问', date: '2026-08-24' })
  assert.ok(entry.startsWith('## v1.2.0 · 2026-08-24'))
  assert.ok(entry.includes('- 新增划词提问'))
})
ok('appendUpdateFile：新文件写入标题头，再次追加不重复标题', () => {
  const dir = mkdtempSync(join(tmpdir(), 'upd-'))
  const file = join(dir, 'update.md')
  try {
    appendUpdateFile(file, renderUpdateEntry({ version: '1.2.0', body: '- A', date: '2026-08-24' }))
    appendUpdateFile(file, renderUpdateEntry({ version: '1.2.1', body: '- B', date: '2026-08-25' }))
    const text = readFileSync(file, 'utf-8')
    assert.equal(text.match(/# 产品更新日志/g).length, 1, '标题头只出现一次')
    assert.ok(text.indexOf('## v1.2.0') < text.indexOf('## v1.2.1'), '按时间正序追加')
    assert.ok(text.includes('- A') && text.includes('- B'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
ok('fallbackChangelog 兜底含版本与递增级别', () => {
  const fb = fallbackChangelog({ version: '1.2.0', bump: 'minor', diff: { shortstat: '3 files changed', log: 'abc feat: x' } })
  assert.ok(fb.tech.includes('minor'))
  assert.ok(fb.tech.includes('abc feat: x'))
  assert.ok(fb.product.includes('新增功能'))
})

console.log(`\n全部通过：${passed} 项 ✅`)
