<script setup lang="ts">
/**
 * 历史记录抽屉：按域名列出历史会话，支持新建 / 载入 / 删除 / 清空。
 */
import { NButton, NDrawer, NDrawerContent, NEmpty } from 'naive-ui'
import type { ChatSession } from '../../shared/types'

const show = defineModel<boolean>('show', { default: false })

defineProps<{ sessions: ChatSession[]; loading: boolean }>()

const emit = defineEmits<{
  (e: 'new'): void
  (e: 'clear'): void
  (e: 'use', s: ChatSession): void
  (e: 'remove', s: ChatSession): void
}>()

function formatTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
</script>

<template>
  <n-drawer v-model:show="show" placement="right" :width="280">
    <n-drawer-content title="历史对话（按域名分类）" closable>
      <div class="flex justify-between mb-2.5">
        <n-button size="tiny" @click="emit('new')">新建会话</n-button>
        <n-button size="tiny" quaternary @click="emit('clear')">清空记录</n-button>
      </div>
      <div v-if="!sessions.length && !loading" class="pt-10">
        <n-empty description="暂无历史记录" size="small" />
      </div>
      <div v-else class="flex flex-col gap-2">
        <div
          v-for="s in sessions"
          :key="s.id"
          class="flex items-center gap-1.5 border border-border rounded-lg p-2"
        >
          <div class="flex-1 min-w-0 cursor-pointer" @click="emit('use', s)">
            <div class="text-[11.5px] font-medium truncate">{{ s.title }}</div>
            <div class="text-[10px] text-text-3 mt-0.5">{{ formatTime(s.updatedAt) }} · {{ s.messages.length }} 条</div>
          </div>
          <n-button size="tiny" quaternary @click="emit('remove', s)">删</n-button>
        </div>
      </div>
    </n-drawer-content>
  </n-drawer>
</template>
