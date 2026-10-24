<template>
  <div class="progress" :class="[tone, { sm }]" :title="title">
    <i :style="{ width: `${pct}%` }"></i>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    value: number;
    max?: number;
    tone?: "accent" | "green" | "blue";
    sm?: boolean;
    title?: string;
  }>(),
  { max: 100, tone: "accent", sm: false, title: "" },
);

const pct = computed(() => {
  const max = props.max > 0 ? props.max : 1;
  return Math.max(0, Math.min(100, Math.round((props.value / max) * 100)));
});
</script>
