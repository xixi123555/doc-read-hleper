<script setup lang="ts">
/**
 * 顶部栏（拖拽区）：标题 / 模型标签 / 域名 + 操作按钮；收起态渲染悬浮圆钮。
 */
import { NTag } from 'naive-ui'

defineProps<{
  collapsed?: boolean
  pageTitle?: string
  modelName?: string
  domain?: string
  themeIcon?: string
}>()

const emit = defineEmits<{
  (e: 'expand'): void
  (e: 'history'): void
  (e: 'export'): void
  (e: 'theme'): void
  (e: 'fullscreen'): void
  (e: 'collapse'): void
  (e: 'close'): void
  (e: 'dragDown', e: MouseEvent): void
}>()
</script>

<template>
  <button
    v-if="collapsed"
    class="absolute inset-0 w-full h-full rounded-full bg-gradient-to-br from-primary to-[#3b5bdb] shadow-lg cursor-pointer border-none flex items-center justify-center hover:brightness-110 transition-all"
    title="展开对话窗"
    @click="emit('expand')"
  >
    <span class="text-white font-bold text-[16px] tracking-wide select-none">AI</span>
  </button>

  <header
    v-else
    class="flex items-center justify-between gap-2 px-2.5 py-2 cursor-grab select-none border-b border-border bg-card shrink-0"
    @mousedown="emit('dragDown', $event)"
  >
    <div class="min-w-0 flex-1">
      <div class="text-[13px] font-semibold truncate" :title="pageTitle">
        {{ pageTitle || 'AI 网页阅读助手' }}
      </div>
      <div class="flex items-center gap-1.5 mt-0.5">
        <n-tag size="tiny" :bordered="false" type="info" class="max-w-[140px] overflow-hidden">
          {{ modelName }}
        </n-tag>
        <span class="text-[10px] text-text-3 truncate">{{ domain }}</span>
      </div>
    </div>
    <div class="flex items-center gap-0.5 shrink-0">
      <button class="icon-btn" title="历史记录" @click="emit('history')">🕘</button>
      <button class="icon-btn" title="总结导出" @click="emit('export')">📤</button>
      <button class="icon-btn" :title="themeIcon" @click="emit('theme')">{{ themeIcon }}</button>
      <button class="icon-btn" title="全屏" @click="emit('fullscreen')">⛶</button>
      <button class="icon-btn" title="收起" @click="emit('collapse')">—</button>
      <button class="icon-btn" title="关闭" @click="emit('close')">✕</button>
    </div>
  </header>
</template>
