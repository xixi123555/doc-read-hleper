<script setup lang="ts">
/**
 * 快捷指令栏：发送预设指令（总结 / 解读 / 翻译 / 代码 / 答疑）。
 */
import { QUICK_COMMANDS } from '../../shared/prompts'

defineProps<{ disabled?: boolean }>()
const emit = defineEmits<{ (e: 'run', id: string): void }>()
</script>

<template>
  <div class="flex gap-1.5 px-2.5 py-1.5 overflow-x-auto border-b border-border bg-bg shrink-0">
    <button
      v-for="c in QUICK_COMMANDS"
      :key="c.id"
      class="chip shrink-0"
      :disabled="disabled"
      @click="emit('run', c.id)"
    >
      <span>{{ c.icon }}</span>{{ c.label }}
    </button>
  </div>
</template>
