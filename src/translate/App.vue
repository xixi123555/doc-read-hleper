<script setup lang="ts">
/**
 * 划词翻译悬浮小窗（PRD 3.6）
 * 三种场景：单词（英美音标 + 多义项 + 上下文释义）/ 短语 / 长段
 */
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { PM } from '../shared/msg'
import { TranslateMode, TranslateResult } from '../shared/types'
import { copyText } from '../chat/clipboard'

const nonce = ref('')
const mode = ref<TranslateMode>('word')
const sourceText = ref('')
const loading = ref(true)
const error = ref('')
const result = ref<TranslateResult | null>(null)
const copied = ref(false)

const rootRef = ref<HTMLElement | null>(null)

function postToHost(msg: any) {
  window.parent.postMessage(msg, '*')
}

function onWindowMessage(e: MessageEvent) {
  const msg = e.data || {}
  // TranslateInit 消息用于建立信任（携带宿主 nonce），必须在 nonce 校验之前处理
  if (msg.type === PM.TranslateInit) {
    nonce.value = msg.nonce
    mode.value = msg.mode || 'word'
    sourceText.value = msg.text || ''
    loading.value = true
    error.value = ''
    result.value = null
    return
  }
  if (msg.nonce && msg.nonce !== nonce.value) return
  switch (msg.type) {
    case PM.TranslateResult:
      loading.value = false
      if (msg.ok) {
        result.value = normalizeResult(msg.data, mode.value, sourceText.value)
      } else {
        error.value = msg.error || '翻译失败'
      }
      break
    case PM.TranslateClose:
      break
    default:
      break
  }
}

function normalizeResult(data: any, m: TranslateMode, source: string): TranslateResult {
  const base: TranslateResult = { mode: m, source, literal: '', contextual: '' }
  if (data && typeof data === 'object') {
    base.phonetics = data.phonetics
    base.usage = data.usage
    base.contextual = data.contextual || ''
    base.literal = m === 'word' ? data.literal || [] : data.literal || ''
  }
  return base
}

function retry() {
  loading.value = true
  error.value = ''
  postToHost({ type: PM.TranslateRetry, nonce: nonce.value })
}

function close() {
  postToHost({ type: PM.TranslateClose, nonce: nonce.value })
}

async function copyContextual() {
  const text = result.value?.contextual || ''
  if (!text) return
  const ok = await copyText(text)
  copied.value = ok
  setTimeout(() => (copied.value = false), 1200)
}

/** 内容变化后向宿主上报自适应高度 */
function reportHeight() {
  void nextTick(() => {
    const h = rootRef.value?.scrollHeight || 200
    postToHost({ type: PM.SetHeight, nonce: nonce.value, height: h + 2 })
  })
}

watch([loading, result, error], reportHeight)

onMounted(() => {
  window.addEventListener('message', onWindowMessage)
  reportHeight()
})
onBeforeUnmount(() => window.removeEventListener('message', onWindowMessage))

function isWord(): boolean {
  return mode.value === 'word'
}
function literalList(): { pos: string; meaning: string }[] {
  const l = result.value?.literal
  if (Array.isArray(l)) return l as { pos: string; meaning: string }[]
  return []
}
</script>

<template>
  <div ref="rootRef" class="relative bg-card text-text text-[12px] leading-relaxed px-3 pt-2.5 pb-2 min-h-[90px] rounded-[10px] max-h-screen overflow-y-auto translate-pop">
    <button
      class="absolute top-1.5 right-1.5 w-5 h-5 border-none bg-transparent text-text-3 rounded hover:bg-hover hover:text-text cursor-pointer text-[11px] leading-none flex items-center justify-center"
      title="关闭"
      @click="close"
    >
      ✕
    </button>

    <!-- 加载中 -->
    <div v-if="loading" class="flex items-center gap-2 text-text-2 py-3 px-1">
      <span class="w-3.5 h-3.5 border-2 border-border-strong border-t-primary rounded-full animate-spin"></span>
      <span class="text-[11.5px]">正在翻译…</span>
    </div>

    <!-- 错误 -->
    <div v-else-if="error" class="py-2 px-1">
      <p class="text-danger text-[11.5px] my-0 mb-2 break-words">{{ error }}</p>
      <button
        class="border border-primary text-primary bg-transparent rounded-md px-3 py-1 text-[11px] cursor-pointer hover:bg-primary-soft transition-colors"
        @click="retry"
      >
        重试
      </button>
    </div>

    <!-- 单词模式 -->
    <template v-else-if="isWord() && result">
      <div class="flex items-baseline flex-wrap gap-x-2.5 gap-y-1 mb-2 pr-5">
        <span class="text-[17px] font-bold">{{ result.source }}</span>
        <span v-if="result.phonetics?.uk" class="text-[11px] text-text-3 font-mono">英 /{{ result.phonetics.uk }}/</span>
        <span v-if="result.phonetics?.us" class="text-[11px] text-text-3 font-mono">美 /{{ result.phonetics.us }}/</span>
      </div>
      <div v-if="literalList().length" class="mb-2">
        <div v-for="(m, i) in literalList()" :key="i" class="flex gap-2 py-0.5">
          <span class="text-primary text-[11px] shrink-0 w-8">{{ m.pos }}</span>
          <span class="break-words">{{ m.meaning }}</span>
        </div>
      </div>
      <div v-if="result.usage" class="my-1.5 flex gap-1.5 items-baseline">
        <span class="tag">上下文释义</span>
        <span class="text-text-2 break-words">{{ result.usage }}</span>
      </div>
      <div v-if="result.contextual" class="my-1.5 flex gap-1.5 items-baseline">
        <span class="tag">语境翻译</span>
        <span class="text-text-2 break-words">{{ result.contextual }}</span>
      </div>
      <div class="flex justify-end mt-1.5">
        <button class="copy-btn" @click="copyContextual">{{ copied ? '已复制' : '复制' }}</button>
      </div>
    </template>

    <!-- 短语 / 长段模式 -->
    <template v-else-if="result">
      <div class="text-[13px] font-semibold mb-2 break-words pr-5">{{ result.source }}</div>
      <div class="my-2">
        <span class="tag">直译</span>
        <p class="mt-1 text-text-2 whitespace-pre-wrap break-words my-0">{{ result.literal }}</p>
      </div>
      <div class="my-2">
        <span class="tag">上下文意译</span>
        <p class="mt-1 text-text-2 whitespace-pre-wrap break-words my-0">{{ result.contextual }}</p>
      </div>
      <div class="flex justify-end mt-1.5">
        <button class="copy-btn" @click="copyContextual">{{ copied ? '已复制' : '复制' }}</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.translate-pop {
  /* 内部滚动：内容超高时仍可完整查看（高度由宿主按内容自适应） */
  scrollbar-width: thin;
}
.tag {
  display: inline-block;
  font-size: 10px;
  color: var(--primary);
  background: var(--primary-soft);
  border-radius: 4px;
  padding: 1px 6px;
  flex-shrink: 0;
}
.copy-btn {
  border: none;
  background: transparent;
  color: var(--text-3);
  font-size: 11px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition:
    background 0.15s,
    color 0.15s;
}
.copy-btn:hover {
  background: var(--hover);
  color: var(--primary);
}
</style>
