<template>
  <div class="gen-bar">
    <div class="gen-scope">
      <button class="btn sm" :disabled="disabled" @click="$emit('select')">选择知识点</button>
      <span v-if="selectedCount > 0" class="s" style="color: var(--as-text-dim)">
        已选 {{ selectedCount }} 个知识点
      </span>
      <span v-else class="s" style="color: var(--as-text-faint)">
        未选择知识点（按 章-节-知识点 选择）
      </span>
      <span v-if="$slots.scope" class="gen-scope-extra"><slot name="scope" /></span>
    </div>
    <div class="gen-row">
      <div v-if="$slots.options" class="gen-form">
        <slot name="options" />
      </div>
      <div class="gen-actions">
        <button
          class="btn primary"
          :disabled="disabled || actionDisabled || selectedCount === 0"
          @click="$emit('action')"
        >
          <AppIcon name="spark" :size="14" />
          {{ actionLabel }}
        </button>
        <slot name="actions" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import AppIcon from "./AppIcon.vue";

withDefaults(
  defineProps<{
    selectedCount: number;
    disabled?: boolean;
    /** 额外禁用主操作（如无可用知识点） */
    actionDisabled?: boolean;
    actionLabel: string;
  }>(),
  { disabled: false, actionDisabled: false },
);

defineEmits<{ select: []; action: [] }>();
</script>
