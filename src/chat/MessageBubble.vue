<script setup lang="ts">
/**
 * 单条消息气泡：AI 消息渲染 Markdown + 代码块高亮/复制；用户消息纯文本。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { renderMarkdown } from './markdown'
import { copyText } from './clipboard'
import { ChatMessage } from '../shared/types'

const props = defineProps<{ msg: ChatMessage; streaming?: boolean }>()
const el = ref<HTMLElement | null>(null)

const html = computed(() =>
  props.msg.role === 'assistant' ? renderMarkdown(props.msg.content) : '',
)

function enhanceCodeBlocks() {
  if (!el.value) return
  el.value.querySelectorAll('pre').forEach((pre) => {
    if (pre.parentElement?.classList.contains('code-block')) return
    const wrapper = document.createElement('div')
    wrapper.className = 'code-block'
    const head = document.createElement('div')
    head.className = 'code-head'
    const codeEl = pre.querySelector('code')
    const langMatch = codeEl?.className.match(/language-([\w+#-]+)/)
    const lang = document.createElement('span')
    lang.className = 'code-lang'
    lang.textContent = langMatch ? langMatch[1] : 'code'
    const btn = document.createElement('button')
    btn.className = 'code-copy'
    btn.textContent = '复制'
    btn.addEventListener('click', () => {
      const code = pre.textContent || ''
      void copyText(code).then(() => {
        btn.textContent = '已复制'
        setTimeout(() => (btn.textContent = '复制'), 1200)
      })
    })
    head.appendChild(lang)
    head.appendChild(btn)
    pre.parentNode?.insertBefore(wrapper, pre)
    wrapper.appendChild(head)
    wrapper.appendChild(pre)
  })
}

watch(
  () => props.msg.content,
  () => nextTick(enhanceCodeBlocks),
)
onMounted(() => nextTick(enhanceCodeBlocks))

async function copyMsg() {
  const ok = await copyText(props.msg.content)
  if (ok) copied.value = true
  setTimeout(() => (copied.value = false), 1200)
}
const copied = ref(false)
</script>

<template>
  <div class="flex gap-2 mb-3.5" :class="[msg.role === 'user' ? 'flex-row-reverse' : '', { streaming }]">
    <div
      v-if="msg.role === 'assistant'"
      class="w-6 h-6 rounded-lg bg-gradient-to-br from-primary to-[#3b5bdb] text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5"
    >
      AI
    </div>
    <div class="max-w-[calc(100%-32px)] min-w-0">
      <div
        class="px-3 py-2 rounded-xl text-[12.5px] leading-relaxed break-words"
        :class="
          msg.role === 'assistant'
            ? 'bg-ai-bubble border border-border rounded-tl-sm'
            : 'bg-user-bubble rounded-tr-sm'
        "
      >
        <div v-if="msg.role === 'assistant'" ref="el" class="md" v-html="html"></div>
        <div v-else class="whitespace-pre-wrap">{{ msg.content }}</div>
      </div>
      <div v-if="msg.role === 'assistant' && msg.content" class="mt-1 flex justify-end">
        <button
          class="border-none bg-transparent text-[10px] text-text-3 px-1 rounded hover:bg-hover hover:text-primary transition-colors cursor-pointer"
          @click="copyMsg"
        >
          {{ copied ? '已复制' : '复制回答' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.streaming .md::after {
  content: '▍';
  margin-left: 2px;
  color: var(--primary);
  animation: blink 0.9s steps(2) infinite;
}
@keyframes blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0;
  }
}
</style>
