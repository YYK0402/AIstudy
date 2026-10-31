<template>
  <div class="empty-state" :class="{ compact }">
    <span v-if="icon" class="ico"><AppIcon :name="icon" :size="30" :stroke-width="1.5" /></span>
    <div class="es-text">{{ text }}</div>
    <div v-if="$slots.default" class="es-actions">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import AppIcon from "./AppIcon.vue";
import type { IconName } from "../utils/icons";

defineProps<{
  /** 空态图标 */
  icon?: IconName;
  /** 支持换行的说明文案 */
  text: string;
  /** 紧凑模式：用于卡片内部的小空态 */
  compact?: boolean;
}>();
</script>
