/**
 * 对话总结导出模块 —— 可插拔、多适配架构（PRD 3.5.3）
 *
 * 核心分层：
 *  - 文档生成层：buildExportDoc() 产出标准 Markdown（来源链接 / 对话时间 / 主题 /
 *    问答分区 / 代码块 / 知识点总结分区）
 *  - 输出渠道层：EXPORT_TARGETS 注册表，新增输出渠道只需实现 ExportTarget 接口，
 *    开启/关闭不影响现有本地下载核心功能，兼容存量使用逻辑。
 *
 * 已落地：本地 Markdown 下载
 * 预留：控制台打印、云端存储、多格式（TXT/PDF/HTML）——均为可插拔拓展点。
 */
import { ChatMessage } from '../shared/types'
import { copyText } from './clipboard'

export interface ExportTarget {
  id: string
  label: string
  available: boolean
  note?: string
}

/** 输出渠道注册表（可插拔：新增渠道在此追加并实现对应函数） */
export const EXPORT_TARGETS: ExportTarget[] = [
  { id: 'download', label: '本地下载（Markdown）', available: true },
  { id: 'console', label: '浏览器控制台打印', available: false, note: '预留拓展接口' },
  { id: 'server', label: '云端存储 / 归档', available: false, note: '预留拓展接口' },
]

export type ExportMode = 'full' | 'ai'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function exportTimestamp(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/-+/g, '-').slice(0, 60)
}

export function buildFilename(pageTitle: string): string {
  return `${sanitizeFilename(pageTitle || '对话总结')}-AI对话总结-${exportTimestamp().replace(/[-: ]/g, '')}.md`
}

export interface ExportDocOptions {
  mode: ExportMode
  title: string
  url: string
  domain: string
  messages: ChatMessage[]
  /** AI 精简总结模式的模型输出 */
  aiSummary?: string
}

/** 文档生成层：统一生成标准化 Markdown 文档 */
export function buildExportDoc(opts: ExportDocOptions): string {
  const time = exportTimestamp()
  const header = [
    `# ${opts.title || '网页对话'} — AI 对话总结`,
    '',
    `> **网页来源**：[${opts.url}](${opts.url})`,
    `> **域名**：${opts.domain || '-'}`,
    `> **导出时间**：${time}`,
    `> **导出模式**：${opts.mode === 'ai' ? 'AI 精简总结' : '完整对话留存'}`,
    '',
  ].join('\n')

  if (opts.mode === 'ai' && opts.aiSummary) {
    return `${header}\n${opts.aiSummary.trim()}\n`
  }

  // 完整对话留存模式：原样整理所有对话
  const qa = opts.messages
    .map((m, i) => {
      if (m.role === 'user') {
        return `\n## Q${i + 1}：${m.content.trim().split('\n')[0]}\n\n> 提问时间：${exportTimestamp(new Date(m.ts))}\n\n${escapeForMd(m.content)}\n`
      }
      return `\n### A：\n\n${m.content}\n`
    })
    .join('')
  return `${header}\n## 问答记录\n${qa}\n`
}

function escapeForMd(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n')
}

/* ---------------- 输出渠道实现 ---------------- */

export function downloadMarkdown(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 预留：控制台打印输出（开发者调试） */
export function printToConsole(doc: string): void {
  console.log('%c[AI 网页阅读助手] 对话总结文档\n', 'color:#4A7DFF;font-weight:bold')
  console.log(doc)
}

/** 预留：云端上传接口（对接后台服务器时实现） */
export async function uploadToServer(_doc: string, _meta: { title: string; domain: string }): Promise<boolean> {
  throw new Error('云端存储接口为预留拓展，尚未接入服务器')
}

/** 通用导出执行器：根据目标 id 分发 */
export async function runExport(targetId: string, opts: ExportDocOptions): Promise<{ ok: boolean; message: string }> {
  const doc = buildExportDoc(opts)
  switch (targetId) {
    case 'download':
      downloadMarkdown(buildFilename(opts.title), doc)
      return { ok: true, message: '已下载到本地' }
    case 'console':
      printToConsole(doc)
      return { ok: true, message: '已打印到控制台' }
    case 'server':
      return { ok: false, message: '云端存储为预留拓展，暂未接入服务器' }
    default:
      return { ok: false, message: '未知导出渠道' }
  }
}

export { copyText }
