/**
 * 构建后处理（每次 build 必跑）：
 *  - 拷贝 manifest.json 与图标到 dist/
 *  - 因产物带内容指纹，重写 manifest 中 background / content_scripts 的实际文件名
 *  - 校验产物完整性（缺失任一关键文件 → 构建失败，不进入发布打包）
 */
import {
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { resolve, relative, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DIST = resolve(ROOT, 'dist')
const PUBLIC = resolve(ROOT, 'public')

/** 在目录中按前缀查找唯一文件（带指纹产物），找不到返回 null */
function findByPrefix(dir, prefix) {
  if (!existsSync(dir)) return null
  const hits = readdirSync(dir).filter((f) => f.startsWith(prefix))
  return hits.length === 1 ? hits[0] : hits.length > 1 ? hits.sort().pop() : null
}

// 1. 拷贝静态资源
cpSync(resolve(PUBLIC, 'manifest.json'), resolve(DIST, 'manifest.json'))
cpSync(resolve(PUBLIC, 'icons'), resolve(DIST, 'icons'), { recursive: true })

// 2. 重写 manifest 中带指纹的文件名（background SW / content script）
const manifestPath = resolve(DIST, 'manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))

const backgroundFile = findByPrefix(resolve(DIST, 'js'), 'background-')
if (backgroundFile) manifest.background.service_worker = `js/${backgroundFile}`

const contentFile = findByPrefix(resolve(DIST, 'js'), 'content-')
if (contentFile) {
  if (Array.isArray(manifest.content_scripts?.[0]?.js)) {
    manifest.content_scripts[0].js = [`js/${contentFile}`]
  }
}

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
console.log(`[postbuild] manifest 指纹重写: sw=${manifest.background.service_worker}, cs=${manifest.content_scripts?.[0]?.js?.[0]}`)

// 3. 校验产物完整性（缺失即失败，不会进入发布打包）
const required = [
  'manifest.json',
  'popup.html',
  'chat.html',
  'translate.html',
  'icons/icon16.png',
  'icons/icon32.png',
  'icons/icon48.png',
  'icons/icon128.png',
]
const requiredPrefix = [
  ['js', 'background-'],
  ['js', 'content-'],
]
const missing = required.filter((f) => !existsSync(resolve(DIST, f)))
for (const [dir, prefix] of requiredPrefix) {
  if (!findByPrefix(resolve(DIST, dir), prefix)) missing.push(`${dir}/${prefix}*`)
}
if (missing.length) {
  console.error('[postbuild] ❌ 缺少产物文件:', missing.join(', '))
  process.exit(1)
}
if (manifest.manifest_version !== 3) {
  console.error('[postbuild] ❌ manifest_version 必须为 3')
  process.exit(1)
}
console.log('[postbuild] ✅ 产物校验通过 (MV3)')

// 4. 打印产物树
function walk(dir, prefix = '') {
  for (const e of readdirSync(dir).sort()) {
    const p = resolve(dir, e)
    if (statSync(p).isDirectory()) {
      console.log(`${prefix}${e}/`)
      walk(p, prefix + '  ')
    } else {
      console.log(`${prefix}${e} (${statSync(p).size} B)`)
    }
  }
}
console.log(`\n[postbuild] dist/`)
walk(DIST)
console.log(`\n[postbuild] ✅ 构建完成，产物位于 dist/（加载方式见 README）`)
console.log(`[postbuild] 相对路径：${relative(ROOT, DIST)}`)
