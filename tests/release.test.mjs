/**
 * 发布版本化逻辑测试（release-lib.mjs）
 * 运行：node tests/release.test.mjs
 */
import assert from 'node:assert'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  computeFingerprints,
  fingerprintsEqual,
  nextVersion,
  parseVersion,
  uniqueVersion,
} from '../scripts/release-lib.mjs'

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

console.log(`\n全部通过：${passed} 项 ✅`)
