/**
 * 网页智能解析 Agent（PRD 3.3）
 * 基于 Readability 提取正文，过滤导航/广告/侧边栏等冗余内容；
 * 额外抽取代码块与标题大纲，针对性优化技术文档场景。
 */
import { Readability } from '@mozilla/readability'
import { CodeBlockInfo, PageContext, PageOutlineItem } from '../shared/types'

const NOISE_SELECTOR = [
  'script', 'style', 'noscript', 'link', 'meta', 'iframe', 'svg', 'canvas',
  'video', 'audio', 'form', 'button', 'object', 'embed', 'template',
  '[hidden]', '[aria-hidden="true"]', '[data-ad]', '[class*="advert"]',
  '[class*="adsbygoogle"]', '[class*="cookie"]', '[class*="popup"]',
  '[class*="modal"]', '[class*="share"]', '[class*="social"]',
].join(',')

function normalizeWhitespace(text: string): string {
  return text.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

function langFromClass(codeEl: Element): string {
  const cls = (codeEl.getAttribute('class') || '').toLowerCase()
  const m = cls.match(/(?:language|lang|brush)[-: ]([\w+#.-]+)/)
  if (m) return m[1].replace(/[^a-z0-9+#-]/gi, '')
  return ''
}

function collectBlocks(container: Element): { outline: PageOutlineItem[]; codeBlocks: CodeBlockInfo[] } {
  const outline: PageOutlineItem[] = []
  const codeBlocks: CodeBlockInfo[] = []
  container.querySelectorAll('h1,h2,h3,h4').forEach((h) => {
    const level = Number(h.tagName.slice(1))
    const text = normalizeWhitespace(h.textContent || '')
    if (text) outline.push({ level, text: text.slice(0, 120) })
  })
  container.querySelectorAll('pre').forEach((pre) => {
    const codeEl = pre.querySelector('code') || pre
    const code = normalizeWhitespace(codeEl.textContent || '')
    if (code && code.length >= 8) {
      codeBlocks.push({ lang: langFromClass(codeEl), code: code.slice(0, 8000) })
    }
  })
  return { outline, codeBlocks }
}

/** 提取当前页面上下文（同步执行，目标耗时 ≤ 300ms） */
export function extractPage(): PageContext {
  const title = document.title || location.hostname
  const url = location.href
  const lang = document.documentElement.lang || navigator.language || ''

  try {
    const clone = document.cloneNode(true) as Document
    clone.querySelectorAll(NOISE_SELECTOR).forEach((n) => n.remove())

    const article = new Readability(clone).parse()
    if (article && article.textContent) {
      const text = normalizeWhitespace(article.textContent)
      const holder = document.createElement('div')
      holder.innerHTML = article.content || ''
      const { outline, codeBlocks } = collectBlocks(holder)
      const wordCount = text.split(/\s+/).length
      return { title, url, lang, wordCount, outline, codeBlocks, text, truncated: false }
    }
  } catch {
    /* 回退到通用提取 */
  }

  // 通用回退：正文取 body 文本，去掉可见噪音
  try {
    const holder = document.body.cloneNode(true) as HTMLElement
    holder.querySelectorAll(NOISE_SELECTOR).forEach((n) => n.remove())
    const text = normalizeWhitespace(holder.innerText || '')
    const { outline, codeBlocks } = collectBlocks(holder)
    const wordCount = text.split(/\s+/).length
    return { title, url, lang, wordCount, outline, codeBlocks, text, truncated: false }
  } catch {
    return { title, url, lang, wordCount: 0, outline: [], codeBlocks: [], text: document.body?.innerText?.slice(0, 20000) || '', truncated: false }
  }
}
