<script setup lang="ts">
/**
 * 对话总结导出弹窗：导出模式 / 输出渠道 / AI 总结预览 / 复制与导出。
 */
import { NButton, NModal, NRadioButton, NRadioGroup } from 'naive-ui'
import { EXPORT_TARGETS } from '../exporters'
import type { ExportMode } from '../exporters'

const show = defineModel<boolean>('show', { default: false })
const mode = defineModel<ExportMode>('mode', { default: 'full' })
const target = defineModel<string>('target', { default: 'download' })

defineProps<{ busy: boolean; msg: string; summary: string }>()

const emit = defineEmits<{
  (e: 'export'): void
  (e: 'copy'): void
}>()
</script>

<template>
  <n-modal v-model:show="show" preset="card" title="对话总结导出" style="width: 360px">
    <div class="mb-3">
      <div class="text-[10.5px] text-text-2 mb-1.5">导出模式</div>
      <n-radio-group v-model:value="mode">
        <n-radio-button value="full">完整对话留存</n-radio-button>
        <n-radio-button value="ai">AI 精简总结</n-radio-button>
      </n-radio-group>
    </div>
    <div class="mb-3">
      <div class="text-[10.5px] text-text-2 mb-1.5">输出渠道（可插拔架构）</div>
      <n-radio-group v-model:value="target">
        <n-radio-button
          v-for="t in EXPORT_TARGETS"
          :key="t.id"
          :value="t.id"
          :disabled="!t.available"
        >
          {{ t.label }}{{ t.note ? `（${t.note}）` : '' }}
        </n-radio-button>
      </n-radio-group>
    </div>
    <div v-if="mode === 'ai' && summary" class="bg-bg-soft rounded-lg p-2 mb-2">
      <div class="text-[10.5px] text-text-2 mb-1">AI 总结预览</div>
      <div class="text-[11px] text-text-2 whitespace-pre-wrap max-h-[120px] overflow-y-auto">
        {{ summary.slice(0, 200) }}{{ summary.length > 200 ? '…' : '' }}
      </div>
    </div>
    <div v-if="msg" class="text-[11px] text-success mt-1.5">{{ msg }}</div>
    <template #footer>
      <div class="flex justify-end gap-2">
        <n-button size="small" @click="emit('copy')">复制文档</n-button>
        <n-button size="small" type="primary" :loading="busy" @click="emit('export')">
          {{ mode === 'ai' ? 'AI 总结并导出' : '导出 Markdown' }}
        </n-button>
      </div>
    </template>
  </n-modal>
</template>
