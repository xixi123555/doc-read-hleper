/**
 * 发布打包（在构建与 postbuild 成功后运行）：
 *  1. 计算 dist 文件指纹，与上次发布比对 —— 无任何变动则跳过打包（版本不递增）
 *  2. 按 BUMP 递增版本（major=重构 / minor=新功能 / patch=小优化修复，默认 patch），
 *     保证版本号不与历史重复
 *  3. 将 dist 压缩为 releases/ai-web-reading-assistant-v<版本>.zip
 *  4. 同步版本号到 dist/manifest.json、public/manifest.json、package.json
 *  5. 记录发布状态（版本 + 指纹 + 历史）到 releases/version.json
 *
 * 用法：BUMP=minor npm run build    （BUMP: major | minor | patch）
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  computeFingerprints,
  fingerprintsEqual,
  nextVersion,
  uniqueVersion,
  VALID_BUMPS,
} from './release-lib.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DIST = resolve(ROOT, 'dist')
const RELEASES = resolve(ROOT, 'releases')
const STATE_FILE = join(RELEASES, 'version.json')
const PKG_FILE = join(ROOT, 'package.json')

const bump = (process.env.BUMP || 'patch').toLowerCase()
if (!VALID_BUMPS.includes(bump)) {
  console.error(`[release] 无效的 BUMP：${bump}（可选 ${VALID_BUMPS.join('/')}）`)
  process.exit(1)
}

if (!existsSync(DIST)) {
  console.error('[release] ❌ dist 不存在，请先构建')
  process.exit(1)
}

// 1. 指纹比对：无变动 → 跳过打包
const fingerprints = computeFingerprints(DIST)
let state = null
try {
  state = JSON.parse(readFileSync(STATE_FILE, 'utf-8'))
} catch {
  /* 首次发布 */
}
if (state && fingerprintsEqual(state.fingerprints, fingerprints)) {
  console.log(`[release] ℹ️ dist 无任何变动，跳过打包（版本保持 v${state.version}）`)
  process.exit(0)
}

// 2. 版本递增 + 唯一性
const pkg = JSON.parse(readFileSync(PKG_FILE, 'utf-8'))
const base = state ? nextVersion(state.version, bump) : pkg.version || '1.0.0'
const history = state?.history || []
const version = uniqueVersion(base, history)
console.log(`[release] 版本递增：${state ? state.version : '（首次发布）'} → v${version}（${bump}）`)

// 3. 打包 zip（先临时名，成功后再重命名；失败清理且不生成压缩包）
const zipName = `ai-web-reading-assistant-v${version}.zip`
const zipPath = join(RELEASES, zipName)
const tmpZip = join(RELEASES, `.${zipName}.tmp`)
try {
  execFileSync('zip', ['-r', '-q', tmpZip, 'dist'], { cwd: ROOT })
  rmSync(zipPath, { force: true })
  const { renameSync } = await import('node:fs')
  renameSync(tmpZip, zipPath)
} catch (e) {
  rmSync(tmpZip, { force: true })
  console.error('[release] ❌ zip 打包失败，未生成压缩包', e?.message || e)
  process.exit(1)
}

// 4. 同步版本号
const syncVersion = (file) => {
  const raw = JSON.parse(readFileSync(file, 'utf-8'))
  raw.version = version
  writeFileSync(file, JSON.stringify(raw, null, 2) + '\n')
}
syncVersion(join(DIST, 'manifest.json'))
syncVersion(join(ROOT, 'public/manifest.json'))
syncVersion(PKG_FILE)

// 5. 记录发布状态
writeFileSync(
  STATE_FILE,
  JSON.stringify(
    {
      version,
      bump,
      history: [...history, version],
      fingerprints,
      createdAt: new Date().toISOString(),
    },
    null,
    2,
  ) + '\n',
)

console.log(`[release] ✅ 已生成 releases/${zipName}`)
