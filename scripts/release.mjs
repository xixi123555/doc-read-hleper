/**
 * 发布打包（在构建与 postbuild 成功后运行）：
 *  1. 计算 dist 文件指纹，与上次发布比对 —— 无任何变动则跳过打包（版本不递增）
 *  2. 确定递增级别：显式指定 BUMP=major|minor|patch 时直接采用；
 *     否则调用大模型（配置见 .env，依据 git 记录判定变动规模）
 *  3. 按级别递增版本（major=重构 / minor=新功能 / patch=小优化修复），保证不与历史重复
 *  4. 生成版本目录 releases/ai-web-reading-assistant-v<版本>/，将 dist 压缩为其中的
 *     ai-web-reading-assistant-v<版本>.zip
 *  5. 调用大模型生成本次构建的变更文档：
 *     - 技术向 → 版本目录/update_release_doc.md（本次构建变更了哪些内容）
 *     - 产品向 → 追加到 releases/update.md（里程碑 / 时间 / 版本迭代内容）
 *  6. 同步版本号到 dist/manifest.json、public/manifest.json、package.json
 *  7. 记录发布状态（版本 + 指纹 + 历史 + 本次 commit 基线）到 releases/version.json，
 *     供下次构建时大模型做「上一版本 commit → 当前」的差异对比
 *
 * 用法：npm run build                                （级别由大模型自动判定）
 *       BUMP=minor npm run build                     （手动覆盖：major|minor|patch）
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  computeFingerprints,
  fingerprintsEqual,
  nextVersion,
  uniqueVersion,
  VALID_BUMPS,
} from './release-lib.mjs'
import {
  appendUpdateFile,
  collectDiffSummary,
  decideBump,
  decideChangelog,
  gitHead,
  renderTechDoc,
  renderUpdateEntry,
  resolveBaseline,
} from './llm-release.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DIST = resolve(ROOT, 'dist')
const RELEASES = resolve(ROOT, 'releases')
const STATE_FILE = join(RELEASES, 'version.json')
const PKG_FILE = join(ROOT, 'package.json')

async function main() {
  const explicitBump = (process.env.BUMP || '').toLowerCase()
  if (explicitBump && !VALID_BUMPS.includes(explicitBump)) {
    console.error(
      `[release] 无效的 BUMP：${explicitBump}（可选 ${VALID_BUMPS.join('/')}；不设置则由大模型自动判定）`,
    )
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

  // 2. 确定递增级别：显式 BUMP 优先，否则交给大模型判定
  let bump = explicitBump
  let bumpReason = explicitBump ? '手动指定' : null
  let decided = null
  if (!bump) {
    decided = await decideBump({ stateFile: STATE_FILE })
    bump = decided.bump
    bumpReason = decided.reason || null
    console.log(`[release] 🤖 大模型判定递增级别：${bump}${bumpReason ? `（${bumpReason}）` : ''}`)
  }

  // 差异摘要（变更文档用；大模型判定时已顺带生成，手动 BUMP 时这里补算）
  const head = gitHead()
  const baseline = resolveBaseline({ stateFile: STATE_FILE })
  const diff = decided?.diff ?? (baseline && head ? collectDiffSummary(baseline.ref, head) : null)

  // 3. 版本递增 + 唯一性
  const pkg = JSON.parse(readFileSync(PKG_FILE, 'utf-8'))
  const base = state ? nextVersion(state.version, bump) : pkg.version || '1.0.0'
  const history = state?.history || []
  const version = uniqueVersion(base, history)
  console.log(`[release] 版本递增：${state ? state.version : '（首次发布）'} → v${version}（${bump}）`)

  // 4. 版本目录 + 打包 zip（先临时名，成功后再重命名；失败清理且不生成压缩包）
  const releaseDir = join(RELEASES, `ai-web-reading-assistant-v${version}`)
  mkdirSync(releaseDir, { recursive: true })
  const zipName = `ai-web-reading-assistant-v${version}.zip`
  const zipPath = join(releaseDir, zipName)
  const tmpZip = join(RELEASES, `.${zipName}.tmp`)
  try {
    execFileSync('zip', ['-r', '-q', tmpZip, 'dist'], { cwd: ROOT })
    rmSync(zipPath, { force: true })
    renameSync(tmpZip, zipPath)
  } catch (e) {
    rmSync(tmpZip, { force: true })
    console.error('[release] ❌ zip 打包失败，未生成压缩包', e?.message || e)
    process.exit(1)
  }

  // 5. 变更文档（大模型生成：技术向 + 产品向，失败自动兜底）
  const changelog = await decideChangelog({
    diff,
    version,
    prevVersion: state?.version ?? pkg.version,
    bump,
  })
  const docPath = join(releaseDir, 'update_release_doc.md')
  writeFileSync(docPath, renderTechDoc({ version, body: changelog.tech }))
  const updatePath = join(RELEASES, 'update.md')
  appendUpdateFile(updatePath, renderUpdateEntry({ version, body: changelog.product }))
  console.log(`[release] 📄 已生成 ${relative(ROOT, docPath)} 并追加 ${relative(ROOT, updatePath)}`)

  // 6. 同步版本号
  const syncVersion = (file) => {
    const raw = JSON.parse(readFileSync(file, 'utf-8'))
    raw.version = version
    writeFileSync(file, JSON.stringify(raw, null, 2) + '\n')
  }
  syncVersion(join(DIST, 'manifest.json'))
  syncVersion(join(ROOT, 'public/manifest.json'))
  syncVersion(PKG_FILE)

  // 7. 记录发布状态（含本次 commit 与差异基线，供下次大模型判定）
  writeFileSync(
    STATE_FILE,
    JSON.stringify(
      {
        version,
        bump,
        history: [...history, version],
        fingerprints,
        commit: head,
        baselineCommit: baseline?.ref ?? null,
        baselineSource: baseline?.source ?? null,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
  )

  console.log(`[release] ✅ 已生成 releases/ai-web-reading-assistant-v${version}/（zip + update_release_doc.md）`)
}

main().catch((e) => {
  console.error('[release] ❌', e?.message || e)
  process.exit(1)
})
