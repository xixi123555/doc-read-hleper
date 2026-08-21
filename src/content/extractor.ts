/**
 * 网页智能解析 Agent（PRD 3.3）
 * 基于 Readability 提取正文，过滤导航/广告/侧边栏等冗余内容；
 * 额外抽取代码块与标题大纲，针对性优化技术文档场景。
 *
 * 安全预算（防崩溃加固）：
 *  - 克隆前先评估节点数/最大深度，超限走轻量路径（不克隆整树、不跑 Readability）；
 *  - 轻量路径带节点上限 + 时间盒，保证最坏耗时可控；
 *  - 全文统一使用 textContent（innerText 会触发整页布局回流，超大页面有卡死风险）。
 */
import { Readability } from '@mozilla/readability'
import { CodeBlockInfo, PageContext, PageOutlineItem } from '../shared/types'

/** 节点数预算：超过则跳过 Readability（克隆整树 + 解析在超大/恶意 DOM 上可能拖垮渲染进程） */
const MAX_NODES = 60000
/** 深度预算：恶意深嵌套会触发 Readability 递归栈溢出 */
const MAX_DEPTH = 300
/** 轻量路径遍历节点上限 */
const LIGHT_MAX_NODES = 60000
/** 轻量路径时间盒（ms）：到达即中止，保证最坏耗时可控 */
const LIGHT_TIME_BUDGET_MS = 24
/** 提取文本硬上限（字符） */
const MAX_TEXT_CHARS = 100000

const NOISE_SELECTOR = [
  'script', 'style', 'noscript', 'link', 'meta', 'iframe', 'svg', 'canvas',
  'video', 'audio', 'form', 'button', 'object', 'embed', 'template',
  '[hidden]', '[aria-hidden="true"]', '[data-ad]', '[class*="advert"]',
  '[class*="adsbygoogle"]', '[class*="cookie"]', '[class*="popup"]',
  '[class*="modal"]', '[class*="share"]', '[class*="social"]',
].join(',')

/** 轻量路径跳过这些祖先内部的元素 */
const NOISE_ANCESTOR = [
  'script', 'style', 'noscript', 'nav', 'header', 'footer', 'aside',
  '.sidebar', '.ad', '.ads', '.advert', 'iframe',
  '[hidden]', '[aria-hidden="true"]',
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

/** 迭代评估节点数与最大深度（非递归栈式遍历，O(n)，不怕深嵌套） */
function assessDocument(): { nodes: number; depth: number } {
  let nodes = 0
  let depth = 0
  const root = document.body
  if (!root) return { nodes: 0, depth: 0 }
  const stack: { el: Element; d: number }[] = [{ el: root, d: 1 }]
  while (stack.length) {
    const { el, d } = stack.pop()!
    nodes++
    if (d > depth) depth = d
    if (nodes > MAX_NODES) break
    const children = el.children
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push({ el: children[i] as Element, d: d + 1 })
    }
  }
  return { nodes, depth }
}

interface LightResult {
  text: string
  outline: PageOutlineItem[]
  codeBlocks: CodeBlockInfo[]
  truncated: boolean
}

/** 轻量安全提取：单遍遍历 + 节点上限 + 时间盒（不克隆、不回流） */
function extractLight(): LightResult {
  const start = performance.now()
  const parts: string[] = []
  const outline: PageOutlineItem[] = []
  const codeBlocks: CodeBlockInfo[] = []
  let count = 0
  let chars = 0
  let truncated = false
  const root = document.body
  if (!root) return { text: '', outline: [], codeBlocks: [], truncated: false }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
  let el = walker.nextNode() as Element | null
  while (el && count < LIGHT_MAX_NODES) {
    count++
    // 时间盒：每处理 2000 个节点检查一次，超时立即中止
    if (count % 2000 === 0 && performance.now() - start > LIGHT_TIME_BUDGET_MS) {
      truncated = true
      break
    }
    if (el.closest(NOISE_ANCESTOR)) {
      el = walker.nextNode() as Element | null
      continue
    }
    const tag = el.tagName
    if (/^(P|LI|TD|BLOCKQUOTE|SECTION|ARTICLE)$/.test(tag)) {
      const t = normalizeWhitespace(el.textContent || '')
      if (t && t.length >= 2) {
        if (chars >= MAX_TEXT_CHARS) {
          truncated = true
        } else {
          const room = MAX_TEXT_CHARS - chars
          parts.push(room >= t.length ? t : t.slice(0, room))
          chars += Math.min(room, t.length)
        }
      }
    } else if (/^H[1-4]$/.test(tag)) {
      const t = normalizeWhitespace(el.textContent || '')
      if (t) outline.push({ level: Number(tag[1]), text: t.slice(0, 120) })
    } else if (tag === 'PRE') {
      const code = normalizeWhitespace(el.textContent || '')
      if (code && code.length >= 8) {
        const codeEl = el.querySelector('code') || el
        codeBlocks.push({ lang: langFromClass(codeEl), code: code.slice(0, 8000) })
      }
    }
    el = walker.nextNode() as Element | null
  }
  return { text: parts.join('\n'), outline, codeBlocks, truncated }
}

function buildPageContext(
  title: string,
  url: string,
  lang: string,
  r: LightResult,
): PageContext {
  return {
    title,
    url,
    lang,
    wordCount: r.text.split(/\s+/).length,
    outline: r.outline,
    codeBlocks: r.codeBlocks,
    text: r.text,
    truncated: r.truncated,
  }
}

/** 提取当前页面上下文（带安全预算，最坏耗时可控） */
export function extractPage(): PageContext {
  const title = document.title || location.hostname
  const url = location.href
  const lang = document.documentElement.lang || navigator.language || ''

  // 预算评估：超限直接走轻量路径，避免克隆整树 + Readability
  const { nodes, depth } = assessDocument()
  if (nodes > MAX_NODES || depth > MAX_DEPTH) {
    return buildPageContext(title, url, lang, extractLight())
  }

  // 常规路径：克隆 + Readability（预算内），失败回退轻量提取
  try {
    const clone = document.cloneNode(true) as Document
    clone.querySelectorAll(NOISE_SELECTOR).forEach((n) => n.remove())
    const article = new Readability(clone).parse()
    if (article && article.textContent) {
      const text = normalizeWhitespace(article.textContent)
      const holder = document.createElement('div')
      holder.innerHTML = article.content || ''
      const { outline, codeBlocks } = collectBlocks(holder)
      const truncated = text.length > MAX_TEXT_CHARS
      return buildPageContext(title, url, lang, {
        text: truncated ? text.slice(0, MAX_TEXT_CHARS) : text,
        outline,
        codeBlocks,
        truncated,
      })
    }
  } catch {
    /* 回退轻量路径 */
  }

  return buildPageContext(title, url, lang, extractLight())
}
