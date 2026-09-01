<script setup lang="ts">
/**
 * 输入区（底栏）：上下文状态 / 清空 / 多行输入 + 发送/停止 / 拖拽缩放角标。
 */
import { computed } from 'vue'
import type { PageContext } from '../../shared/types'

const props = defineProps<{
  streaming: boolean
  pageContext: PageContext | null
}>()

const emit = defineEmits<{
  (e: 'send'): void
  (e: 'stop'): void
  (e: 'clear'): void
  (e: 'refreshCtx'): void
  (e: 'resizeDown', e: MouseEvent): void
}>()

const inputText = defineModel<string>({ default: '' })

const ctxStatus = computed(() => {
  const ctx = props.pageContext
  if (!ctx) {
    return {
      text: '📄 页面上下文：未加载（点击重试）',
      title: '页面上下文获取失败，点击重试',
      cls: 'text-danger bg-[rgba(242,113,92,0.12)] hover:text-danger',
    }
  }
  return {
    text: `📄 页面上下文已加载（${ctx.wordCount} 词）`,
    title: '已基于当前页面内容回答，点击可刷新',
    cls: 'text-success bg-[rgba(52,199,123,0.12)] hover:text-success',
  }
})

function onInputKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    emit('send')
  }
}
</script>

<template>
  <footer class="border-t border-border bg-card px-2.5 pt-1.5 pb-2 relative shrink-0">
    <div class="flex items-center justify-between mb-1.5">
      <button
        class="text-[10px] rounded-full px-2 py-0.5 cursor-pointer border-none transition-colors"
        :class="ctxStatus.cls"
        :title="ctxStatus.title"
        @click="emit('refreshCtx')"
      >
        {{ ctxStatus.text }}
      </button>
      <button class="ghost-btn" title="清空对话" @click="emit('clear')">清空</button>
    </div>
    <div class="flex items-end gap-1.5">
      <textarea
        v-model="inputText"
        rows="2"
        placeholder="问任何关于当前网页的问题，Enter 发送，Shift+Enter 换行…"
        class="flex-1 resize-none rounded-xl border border-border bg-bg text-text text-[12.5px] leading-relaxed px-2.5 py-1.5 outline-none focus:border-primary focus:ring-2 focus:ring-primary-soft max-h-[120px]"
        @keydown="onInputKeydown"
      ></textarea>
      <button v-if="streaming" class="send-btn bg-danger hover:bg-danger" title="停止生成" @click="emit('stop')">■</button>
      <button v-else class="send-btn" title="发送" @click="emit('send')">➤</button>
    </div>
    <div
      class="absolute right-0 bottom-0 w-4 h-4 cursor-nwse-resize"
      title="拖拽调整大小"
      @mousedown="emit('resizeDown', $event)"
    ></div>
  </footer>
</template>
