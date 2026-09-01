<script setup lang="ts">
/**
 * 消息列表：空态引导 / 折叠提示 / 气泡渲染；对外暴露 scrollToBottom 供流式刷新滚动。
 */
import { computed, ref } from 'vue'
import type { ChatMessage } from '../../shared/types'
import MessageBubble from '../MessageBubble.vue'

const props = defineProps<{
  messages: ChatMessage[]
  streaming: boolean
  foldedCount: number
}>()

const emit = defineEmits<{
  (e: 'expand'): void
  (e: 'runQuick', id: string): void
}>()

const el = ref<HTMLElement | null>(null)

const empty = computed(() => !props.messages.length && !props.streaming)

function scrollToBottom() {
  if (el.value) el.value.scrollTop = el.value.scrollHeight
}

defineExpose({ scrollToBottom })
</script>

<template>
  <div ref="el" class="flex-1 overflow-y-auto px-2.5 pt-3 pb-1.5">
    <div v-if="empty" class="text-center text-text-2 pt-10 text-[12.5px]">
      <div class="text-[34px] mb-2">💬</div>
      <p class="my-1">我是网页阅读助手，已解析当前页面内容。</p>
      <p class="text-[11px] text-text-3">试试上方快捷指令，或直接提问：</p>
      <div class="flex justify-center gap-2 mt-2.5">
        <button class="chip" @click="emit('runQuick', 'summarize')">📝 总结全文</button>
        <button class="chip" @click="emit('runQuick', 'explain')">🧠 解读知识点</button>
      </div>
    </div>
    <div v-if="foldedCount > 0" class="text-center py-2 mb-2">
      <button
        class="text-[11px] text-text-3 border border-dashed border-border-strong rounded-full px-3 py-1 hover:text-primary hover:border-primary transition-colors cursor-pointer"
        @click="emit('expand')"
      >
        🔺 更早的 {{ foldedCount }} 条消息已折叠 · 点击展开
      </button>
    </div>
    <MessageBubble
      v-for="(m, i) in messages"
      :key="i"
      :msg="m"
      :streaming="streaming && m.role === 'assistant' && i === messages.length - 1"
    />
  </div>
</template>
