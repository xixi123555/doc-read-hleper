/**
 * 大模型版本递增级别判定 + 变更文档生成（供 release.mjs 在构建完成后调用，也可单独运行调试）
 *
 * 职责：
 *  1. 定位「上一版本对应的 commit」：
 *     优先取 releases/version.json 中记录的 commit（每次发布时写入），
 *     其次取最新的语义化 git 标签（v1.2.3 / 1.2.3）。
 *     两者都没有时无法做差异对比，按 patch 兜底并给出提示。
 *  2. 收集上一版本 commit → 当前 HEAD 的 git 差异摘要（文件数 / 增删行 / 文件清单 / 提交记录 / 未提交变更）。
 *  3. 调用大模型（配置在 .env：MODEL_BASE_URL / MODEL_API_KEY / MODEL_NAME）：
 *     - 判定本次变动的递增级别：
 *       major —— 重构 / 架构级大变动（内容差异很大，触发第一位 +1）
 *       minor —— 新增模块 / 较大功能（第二位 +1）
 *       patch —— 小优化 / 小 bug（第三位 +1）
 *     - 生成两份变更文档：
 *       tech —— 技术向（写入 releases/ai-web-reading-assistant-v<版本>/update_release_doc.md）
 *       product —— 产品向（追加到 releases/update.md，记录里程碑 / 时间 / 版本迭代内容）
 *
 * 环境变量 BUMP 仍可手动覆盖（见 release.mjs）；本脚本只在未显式指定时被调用。
 * 大模型不可用或失败时，级别兜底 patch、文档用 git 摘要兜底，保证构建不中断。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VALID_BUMPS, nextVersion } from './release-lib.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const ENV_FILE = join(ROOT, '.env')
const STATE_FILE = join(ROOT, 'releases', 'version.json')

/* ------------------------------------------------------------------ */
/* .env / 模型配置                                                      */
/* ------------------------------------------------------------------ */

/** 解析 .env 文本（支持 # 注释、KEY = 'value' 带空格与引号） */
export function parseDotEnv(text) {
  const out = {}
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    let val = m[2].trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    out[m[1]] = val
  }
  return out
}

/** 读取 .env；已存在于 process.env 的同名变量优先（可被 CI 等覆盖） */
export function loadDotEnv(file = ENV_FILE) {
  const fileEnv = existsSync(file) ? parseDotEnv(readFileSync(file, 'utf-8')) : {}
  const env = { ...fileEnv }
  for (const key of Object.keys(env)) {
    const procVal = process.env[key]
    if (procVal !== undefined && procVal !== '') env[key] = procVal
  }
  return env
}

/** 从环境对象解析模型配置；缺少 baseUrl / model 视为未配置 */
export function resolveModelConfig(env = {}) {
  const baseUrl = (env.MODEL_BASE_URL || '').trim()
  const apiKey = (env.MODEL_API_KEY || '').trim()
  const model = (env.MODEL_NAME || '').trim()
  if (!baseUrl || !model) return null
  return { baseUrl, apiKey, model }
}

/** 规范化 base URL → chat/completions 完整地址（与 src/background/llm.ts 语义一致，不自动补 /v1） */
export function chatUrl(baseUrl) {
  return `${String(baseUrl || '').trim().replace(/\/+$/, '')}/chat/completions`
}

/* ------------------------------------------------------------------ */
/* 模型输出解析                                                         */
/* ------------------------------------------------------------------ */

/** 从模型输出中稳健提取并解析 JSON 对象（容忍 markdown 代码块与多余文本） */
export function parseJsonObject(text) {
  const t = String(text ?? '').replace(/```(?:json)?/gi, '').trim()
  const m = t.match(/\{[\s\S]*\}/)
  if (!m) throw new Error(`模型输出不是 JSON：${t.slice(0, 120)}`)
  try {
    return JSON.parse(m[0])
  } catch (e) {
    throw new Error(`模型 JSON 解析失败：${e.message}`)
  }
}

/** 解析 { bump, reason }，校验 bump 合法性 */
export function parseBumpJson(text) {
  const obj = parseJsonObject(text)
  const bump = String(obj.bump || '').toLowerCase()
  if (!VALID_BUMPS.includes(bump)) {
    throw new Error(`模型返回了非法递增级别：${obj.bump}`)
  }
  return { bump, reason: String(obj.reason || '').trim() }
}

/* ------------------------------------------------------------------ */
/* git 记录                                                            */
/* ------------------------------------------------------------------ */

/** 执行 git 命令，失败返回 null（不抛错，保证构建不中断） */
function git(args, { cwd = ROOT } = {}) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

/** 当前 HEAD 完整 hash；非 git 仓库返回 null */
export function gitHead() {
  return git(['rev-parse', 'HEAD'])
}

/**
 * 定位「上一版本对应的 commit」：
 *  1. releases/version.json 记录的 commit（最精确，每次发布时写入）
 *  2. 最新的语义化 git 标签（v1.2.3 / 1.2.3）
 * 返回 null 表示无法定位（此时无法做差异对比，调用方按 patch 兜底）。
 */
export function resolveBaseline({ stateFile = STATE_FILE } = {}) {
  try {
    const state = JSON.parse(readFileSync(stateFile, 'utf-8'))
    if (state?.commit) {
      return { ref: state.commit, source: 'version.json', version: state.version }
    }
  } catch {
    /* 首次发布或文件缺失 */
  }
  const tags = (git(['tag', '--list']) || '')
    .split('\n')
    .map((t) => t.trim())
    .filter((t) => /^v?\d+\.\d+\.\d+$/.test(t))
  if (tags.length) {
    const dated = tags
      .map((t) => ({ t, date: git(['log', '-1', '--format=%ct', t]) }))
      .filter((x) => x.date)
      .sort((a, b) => Number(b.date) - Number(a.date))
    if (dated.length) {
      return { ref: dated[0].t, source: 'git-tag', version: dated[0].t.replace(/^v/, '') }
    }
  }
  return null
}

/**
 * 收集 baseline → head 的差异摘要（供大模型判断变动规模与生成变更文档）。
 * 返回 null 表示无法对比（缺基线或缺 git 环境）。
 */
export function collectDiffSummary(baseline, head, { cwd = ROOT } = {}) {
  if (!baseline || !head) return null
  const run = (args) => git(args, { cwd })
  const shortstat = run(['diff', '--shortstat', baseline, head]) || ''
  const stat = (run(['diff', '--stat', baseline, head]) || '')
    .split('\n')
    .slice(0, 200)
    .join('\n')
  const log = (run(['log', '--oneline', '--no-merges', `${baseline}..${head}`]) || '')
    .split('\n')
    .slice(0, 30)
    .join('\n')
  const dirty = (run(['status', '--porcelain']) || '').split('\n').slice(0, 50).join('\n')
  return { shortstat, stat, log, dirty, baseline, head }
}

/** 组装差异上下文文本（两个提示词共用） */
function buildDiffContext(diff) {
  return `变更统计（上一版本 → 当前）：
${diff.shortstat || '（无差异统计）'}

变更文件清单：
${diff.stat || '（无）'}

提交记录：
${diff.log || '（无）'}

工作区未提交变更：
${diff.dirty || '（无）'}`
}

/* ------------------------------------------------------------------ */
/* 大模型调用（OpenAI 兼容接口）                                        */
/* ------------------------------------------------------------------ */

/** 发送一次 chat/completions 请求并返回 content；部分服务端不支持 response_format 时降级重试 */
async function chatComplete(config, prompt) {
  const url = chatUrl(config.baseUrl)
  const headers = {
    'Content-Type': 'application/json',
    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
  }
  const body = {
    model: config.model,
    temperature: 0,
    messages: [{ role: 'user', content: prompt }],
  }

  async function attempt(withJsonMode) {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(withJsonMode ? { ...body, response_format: { type: 'json_object' } } : body),
      signal: AbortSignal.timeout(120_000),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`模型接口返回 ${res.status}：${text.slice(0, 300)}`)
    }
    return res.json()
  }

  let data
  try {
    data = await attempt(true)
  } catch (firstErr) {
    try {
      data = await attempt(false)
    } catch {
      throw new Error(`调用模型失败：${firstErr?.message || firstErr}`)
    }
  }

  const content = data?.choices?.[0]?.message?.content
  if (!content) throw new Error('模型响应缺少 choices[0].message.content')
  return content
}

/** 调用大模型判定递增级别 */
export async function askLlmForBump(diff, config) {
  const prompt = `你是软件版本发布助手，负责根据 git 变更记录判断本次构建应递增的 semver 级别。

规则：
- major：重构或架构级大变动（整体重构、协议/接口不兼容、大量文件重写、内容差异很大）
- minor：新增模块或较大的功能（新增能力、新页面、新交互）
- patch：小优化或小 bug 修复（文案、样式、性能微调、缺陷修复）

上一版本对应 commit：${diff.baseline}
当前构建 commit：${diff.head}

${buildDiffContext(diff)}

请严格只输出一个 JSON 对象，不要输出任何其他内容：
{"bump": "major" 或 "minor" 或 "patch", "reason": "一句话中文说明判断依据"}`

  return parseBumpJson(await chatComplete(config, prompt))
}

/** 调用大模型生成本次构建的两份变更文档（tech 技术向 / product 产品向） */
export async function askLlmForChangelog({ diff, version, prevVersion, bump }, config) {
  const prompt = `你是发布文档助手。请基于以下 git 变更信息，为版本 v${version}（自 v${prevVersion || '上一版本'} 以来的变更，本次递增级别：${bump}）生成两份变更说明。

${buildDiffContext(diff)}

要求：
- tech：技术向变更说明正文（markdown 分点，面向开发者）：本次构建到底变更了哪些内容，如新增模块、重构点、接口/协议变化、关键修复点与影响面。要具体，不要空话。
- product：产品向变更说明正文（markdown 简短分点，面向最终用户）：新增了什么功能、优化了什么体验、修复了什么问题，语气面向用户。

请严格只输出一个 JSON 对象，不要输出任何其他内容：
{"tech": "技术向 markdown 正文（不含标题）", "product": "产品向 markdown 正文（不含标题）"}`

  const obj = parseJsonObject(await chatComplete(config, prompt))
  const tech = String(obj.tech ?? '').trim()
  const product = String(obj.product ?? '').trim()
  if (!tech && !product) throw new Error('模型未返回 tech / product 内容')
  return {
    tech: tech || `（大模型未提供技术说明）\n- 提交记录：\n${diff.log || '（无）'}`,
    product: product || `v${version} 发布（${bump} 递增）`,
  }
}

/* ------------------------------------------------------------------ */
/* 兜底内容（大模型不可用 / 失败时使用，保证构建不中断）                   */
/* ------------------------------------------------------------------ */

/** 基于 git 摘要生成兜底变更文档 */
export function fallbackChangelog({ diff, version, bump }) {
  const log = diff?.log || ''
  const tech = [
    `- 递增级别：${bump}`,
    `- 变更规模：${diff?.shortstat || '（未知）'}`,
    '提交记录：',
    ...(log ? log.split('\n').map((l) => `  - ${l}`) : ['  - （无 git 记录）']),
  ].join('\n')
  const product = `- ${bump === 'major' ? '重大版本更新' : bump === 'minor' ? '新增功能' : '问题修复与体验优化'}（详见 git 提交记录）`
  return { tech, product }
}

/* ------------------------------------------------------------------ */
/* 文档渲染 / 追加                                                      */
/* ------------------------------------------------------------------ */

/** 本地日期 YYYY-MM-DD */
export function localDateString(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 技术向文档全文（版本目录/update_release_doc.md，每次构建一份） */
export function renderTechDoc({ version, body, date }) {
  const d = date || localDateString()
  return `# v${version} · ${d}（技术变更说明）\n\n${String(body ?? '').trim()}\n`
}

/** 产品向条目（追加到 releases/update.md，记录里程碑 / 时间 / 版本迭代内容） */
export function renderUpdateEntry({ version, body, date }) {
  const d = date || localDateString()
  return `## v${version} · ${d}\n\n${String(body ?? '').trim()}\n`
}

/** 向 update.md 追加条目：文件不存在则先写入标题头，新条目追加在末尾（时间正序） */
export function appendUpdateFile(file, entry) {
  const prev = existsSync(file) ? readFileSync(file, 'utf-8') : ''
  const trimmed = prev.trimEnd()
  const header = trimmed === '' ? '# 产品更新日志（里程碑）\n' : ''
  const sep = trimmed === '' ? '' : '\n\n'
  writeFileSync(file, header + trimmed + sep + String(entry ?? '').trimEnd() + '\n')
}

/* ------------------------------------------------------------------ */
/* 编排入口                                                            */
/* ------------------------------------------------------------------ */

/**
 * 完整判定流程（release.mjs 在未显式指定 BUMP 时调用）：
 * 返回 { bump, reason, baseline, baselineVersion, baselineSource, head, diff }
 * 任何一步失败都兜底为 patch，保证 `npm run build` 不中断。
 */
export async function decideBump({ stateFile = STATE_FILE } = {}) {
  const head = gitHead()
  if (!head) {
    console.warn('[release] ⚠️ 无法获取 git 记录（非 git 仓库？），本次按 patch 处理，或手动指定 BUMP=major|minor|patch')
    return { bump: 'patch', reason: '无法获取 git 记录，按 patch 兜底', baseline: null, head: null, diff: null }
  }

  const baseline = resolveBaseline({ stateFile })
  if (!baseline) {
    console.warn('[release] ⚠️ 无法定位上一版本对应的 commit（version.json 无 commit 记录且无 v* 标签）')
    console.warn('[release] ⚠️ 建议为上一版本打标签：git tag v<上一版本号>（如 git tag v1.1.1），本次按 patch 处理')
    return { bump: 'patch', reason: '缺少上一版本 commit 基线，按 patch 兜底', baseline: null, head, diff: null }
  }

  const diff = collectDiffSummary(baseline.ref, head)
  if (!diff) {
    console.warn('[release] ⚠️ 无法生成 git 差异摘要，本次按 patch 处理')
    return { ...baseline, bump: 'patch', reason: '无法生成 git 差异摘要，按 patch 兜底', head, diff: null }
  }

  const config = resolveModelConfig(loadDotEnv())
  if (!config) {
    console.warn('[release] ⚠️ .env 缺少 MODEL_BASE_URL / MODEL_NAME 配置，无法调用大模型，本次按 patch 处理')
    return { ...baseline, bump: 'patch', reason: '未配置模型（.env），按 patch 兜底', head, diff }
  }

  console.log(`[release] 🤖 调用大模型判定递增级别（基线 ${baseline.source}: ${baseline.ref}）…`)
  try {
    const { bump, reason } = await askLlmForBump(diff, config)
    return { ...baseline, bump, reason, head, diff }
  } catch (e) {
    console.warn(`[release] ⚠️ 大模型判定失败：${e?.message || e}`)
    console.warn('[release] ⚠️ 本次按 patch 处理，或手动指定 BUMP=major|minor|patch 覆盖')
    return { ...baseline, bump: 'patch', reason: '大模型判定失败，按 patch 兜底', head, diff }
  }
}

/**
 * 生成本次构建的变更文档：
 * 返回 { tech, product }：
 *  - tech：技术向说明（写入 releases/ai-web-reading-assistant-v<版本>/update_release_doc.md）
 *  - product：产品向条目（追加到 releases/update.md）
 * 无差异基线或大模型失败时用 git 摘要兜底。
 */
export async function decideChangelog({ diff, version, prevVersion, bump }) {
  if (!diff) {
    console.warn('[release] ⚠️ 无 git 差异基线，变更文档使用兜底内容')
    return fallbackChangelog({ diff, version, bump })
  }
  const config = resolveModelConfig(loadDotEnv())
  if (!config) {
    console.warn('[release] ⚠️ 未配置模型（.env），变更文档使用 git 摘要兜底')
    return fallbackChangelog({ diff, version, bump })
  }
  console.log('[release] 🤖 调用大模型生成变更文档（技术向 + 产品向）…')
  try {
    return await askLlmForChangelog({ diff, version, prevVersion, bump }, config)
  } catch (e) {
    console.warn(`[release] ⚠️ 大模型生成变更文档失败：${e?.message || e}，使用 git 摘要兜底`)
    return fallbackChangelog({ diff, version, bump })
  }
}

// 单独运行：node scripts/llm-release.mjs —— 输出本次级别判定 + 变更文档（便于调试）
const isMain =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const decided = await decideBump()
  const previewVersion = decided.version ? nextVersion(decided.version, decided.bump) : null
  const changelog = await decideChangelog({
    diff: decided.diff,
    version: previewVersion || 'x.x.x',
    prevVersion: decided.baselineVersion || null,
    bump: decided.bump,
  })
  console.log(
    JSON.stringify(
      {
        bump: decided.bump,
        reason: decided.reason,
        baseline: decided.baseline,
        head: decided.head,
        previewVersion,
        changelog,
      },
      null,
      2,
    ),
  )
}
