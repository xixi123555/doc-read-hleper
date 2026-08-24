/**
 * 发布版本化：纯逻辑（可单测）
 *  - 版本递增规则：major（重构/大变动）/ minor（新模块/较大功能）/ patch（小优化/小 bug）
 *  - 版本唯一性：基于历史版本号自动去重（重复则 patch 递增直到唯一）
 *  - 文件指纹：对 dist 内容做 SHA-256 指纹，用于「无变动不打包」
 */
import { createHash } from 'node:crypto'
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

export const VALID_BUMPS = ['major', 'minor', 'patch']

/** 解析 "x.y.z" → [x,y,z]，非法返回 null */
export function parseVersion(v) {
  const m = String(v ?? '').trim().match(/^(\d+)\.(\d+)\.(\d+)$/)
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

/** 按递增规则生成下一版本号（不做唯一性处理） */
export function nextVersion(current, bump = 'patch') {
  const p = parseVersion(current)
  if (!p) throw new Error(`版本号格式非法：${current}`)
  const [maj, min, pat] = p
  switch (bump) {
    case 'major':
      return `${maj + 1}.0.0`
    case 'minor':
      return `${maj}.${min + 1}.0`
    case 'patch':
    default:
      return `${maj}.${min}.${pat + 1}`
  }
}

/** 保证版本号不重复：若 base 已存在于 history，则 patch 位递增直到唯一 */
export function uniqueVersion(base, history = []) {
  let v = base
  const used = new Set(history)
  while (used.has(v)) {
    const p = parseVersion(v)
    if (!p) throw new Error(`版本号格式非法：${v}`)
    v = `${p[0]}.${p[1]}.${p[2] + 1}`
  }
  return v
}

/**
 * 计算目录文件指纹：{ "相对路径": sha256hex }。
 * exclude 用于排除派生文件（如 manifest.json 含版本号，不参与变动判定）。
 */
export function computeFingerprints(dir, { exclude = ['manifest.json'] } = {}) {
  const map = {}
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e)
      const st = statSync(p)
      if (st.isDirectory()) {
        walk(p)
      } else {
        const rel = relative(dir, p).split(sep).join('/')
        if (exclude.includes(rel)) continue
        map[rel] = createHash('sha256').update(readFileSync(p)).digest('hex')
      }
    }
  }
  walk(dir)
  return map
}

/** 指纹是否完全一致 */
export function fingerprintsEqual(a, b) {
  const ka = Object.keys(a).sort()
  const kb = Object.keys(b).sort()
  if (ka.length !== kb.length) return false
  for (const k of ka) {
    if (a[k] !== b[k]) return false
  }
  return true
}
