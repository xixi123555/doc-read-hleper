/**
 * 构建后处理：
 *  - 拷贝 manifest.json 与图标到 dist/
 *  - 校验 manifest 关键字段与产物完整性
 *  - 输出构建产物清单
 */
import { cpSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DIST = resolve(ROOT, 'dist')
const PUBLIC = resolve(ROOT, 'public')

// 1. 拷贝静态资源
cpSync(resolve(PUBLIC, 'manifest.json'), resolve(DIST, 'manifest.json'))
cpSync(resolve(PUBLIC, 'icons'), resolve(DIST, 'icons'), { recursive: true })

// 2. 校验 manifest
const manifest = JSON.parse(readFileSync(resolve(DIST, 'manifest.json'), 'utf-8'))
const required = [
  'js/background.js',
  'content.js',
  'popup.html',
  'chat.html',
  'translate.html',
  'icons/icon16.png',
  'icons/icon32.png',
  'icons/icon48.png',
  'icons/icon128.png',
]
const missing = required.filter((f) => !existsSync(resolve(DIST, f)))
if (missing.length) {
  console.error('[postbuild] ❌ 缺少产物文件:', missing.join(', '))
  process.exit(1)
}
if (!manifest.manifest_version || manifest.manifest_version !== 3) {
  console.error('[postbuild] ❌ manifest_version 必须为 3')
  process.exit(1)
}
console.log('[postbuild] ✅ manifest 校验通过 (MV3)')

// 3. 打印产物树
function walk(dir, prefix = '') {
  const entries = readdirSync(dir).sort()
  for (const e of entries) {
    const p = resolve(dir, e)
    const st = statSync(p)
    if (st.isDirectory()) {
      console.log(`${prefix}${e}/`)
      walk(p, prefix + '  ')
    } else {
      console.log(`${prefix}${e} (${st.size} B)`)
    }
  }
}
console.log(`\n[postbuild] dist/`)
walk(DIST)

const total = required.reduce((acc, f) => acc + statSync(resolve(DIST, f)).size, 0)
console.log(`\n[postbuild] ✅ 构建完成，产物位于 dist/（关键文件合计 ${(total / 1024).toFixed(1)} KB）`)
console.log(`[postbuild] 加载方式：Chrome → chrome://extensions → 开启开发者模式 → 加载已解压的扩展程序 → 选择 ${relative(ROOT, DIST)} 目录`)
