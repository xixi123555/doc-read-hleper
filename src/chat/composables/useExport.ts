/**
 * 对话总结导出：导出模式（完整 / AI 精简）、AI 总结流式预览、文档生成与复制。
 */
import { ref } from 'vue'
import type { Ref } from 'vue'
import type { ChatMessage } from '../../shared/types'
import { buildExportDoc, buildFilename } from '../exporters'
import type { ExportMode } from '../exporters'

export function useExport(deps: {
  pageTitle: Ref<string>
  pageUrl: Ref<string>
  domain: Ref<string>
  messages: Ref<ChatMessage[]>
  reqSeq: Ref<number>
  postToBackground: (msg: any) => Promise<boolean>
}) {
  const exportOpen = ref(false)
  const exportBusy = ref(false)
  const exportMsg = ref('')
  const exportMode = ref<ExportMode>('full')
  const exportTarget = ref('download')
  const exportSummary = ref('')
  const summarizeState = ref<{ id: number; buffer: string } | null>(null)

  function openExport() {
    exportOpen.value = true
    exportMsg.value = ''
    exportSummary.value = ''
  }

  function exportOpts() {
    return {
      title: deps.pageTitle.value,
      url: deps.pageUrl.value,
      domain: deps.domain.value,
      messages: deps.messages.value,
    }
  }

  function downloadDoc(doc: string) {
    const a = document.createElement('a')
    const blob = new Blob([doc], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    a.href = url
    a.download = buildFilename(deps.pageTitle.value)
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  async function doExport() {
    exportBusy.value = true
    exportMsg.value = ''
    if (exportMode.value === 'full') {
      downloadDoc(buildExportDoc({ mode: 'full', ...exportOpts() }))
      exportMsg.value = '已下载到本地'
      exportBusy.value = false
      return
    }
    if (!deps.messages.value.length) {
      exportMsg.value = '当前没有可总结的对话内容'
      exportBusy.value = false
      return
    }
    exportSummary.value = ''
    const id = ++deps.reqSeq.value
    summarizeState.value = { id, buffer: '' }
    const ok = await deps.postToBackground({
      type: 'summarize',
      payload: {
        id,
        messages: deps.messages.value.map((m) => ({ role: m.role, content: m.content })),
        pageMeta: { title: deps.pageTitle.value, url: deps.pageUrl.value, domain: deps.domain.value },
      },
    })
    if (!ok) {
      summarizeState.value = null
      exportBusy.value = false
      exportMsg.value = '与后台连接失败，请重试'
    }
  }

  async function finishExport() {
    downloadDoc(buildExportDoc({ mode: 'ai', aiSummary: exportSummary.value, ...exportOpts() }))
    exportMsg.value = '已生成 AI 精简总结并下载'
    exportBusy.value = false
  }

  async function copyExportDoc() {
    const doc = buildExportDoc({
      mode: exportMode.value,
      aiSummary: exportSummary.value || undefined,
      ...exportOpts(),
    })
    try {
      await navigator.clipboard.writeText(doc)
      exportMsg.value = '文档已复制到剪贴板'
    } catch {
      exportMsg.value = '复制失败'
    }
  }

  /* ---------------- 后台总结流式消息 ---------------- */

  function handleSummarizeChunk(id: number, delta: string) {
    if (summarizeState.value?.id !== id) return
    summarizeState.value.buffer += delta || ''
    exportSummary.value = summarizeState.value.buffer
  }

  function handleSummarizeDone(id: number, content: string) {
    if (summarizeState.value?.id !== id) return
    exportSummary.value = content || ''
    summarizeState.value = null
    void finishExport()
  }

  function handleSummarizeError(id: number, message: string) {
    if (summarizeState.value?.id !== id) return
    summarizeState.value = null
    exportBusy.value = false
    exportMsg.value = message || 'AI 总结失败'
  }

  return {
    exportOpen,
    exportBusy,
    exportMsg,
    exportMode,
    exportTarget,
    exportSummary,
    openExport,
    doExport,
    finishExport,
    copyExportDoc,
    handleSummarizeChunk,
    handleSummarizeDone,
    handleSummarizeError,
  }
}
