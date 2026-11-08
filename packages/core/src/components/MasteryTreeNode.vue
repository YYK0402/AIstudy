<template>
  <div class="mtree-node" :class="rowCls">
    <span v-if="depth === 1" class="tag" :class="node.level"><span class="d"></span>{{ MASTERY_LABELS[node.level] }}</span>
    <span class="mtree-name">{{ node.name }}</span>
    <span class="mtree-progress">{{ node.mastered }}/{{ node.total }}</span>
    <div class="mtree-bar">
      <i v-for="m in MASTERY_ORDER" :key="m" :class="m" :style="{ width: nodeDistPct(node, m) + '%' }"></i>
    </div>
  </div>
  <div v-if="node.children.length > 0" class="mtree-children">
    <MasteryTreeNode v-for="c in node.children" :key="c.id" :node="c" :depth="depth + 1" />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { MASTERY_LABELS, MASTERY_LADDER } from "../utils/mastery";
import { nodeDistPct, type MasteryTreeChapter } from "../utils/masteryTree";
import type { Mastery } from "../types/appData";

const props = defineProps<{
  node: MasteryTreeChapter;
  /** 1 = 顶层章，向下逐级 +1 */
  depth: number;
}>();

/** 分布条分段顺序：高 → 低（阶梯反序） */
const MASTERY_ORDER: Mastery[] = [...MASTERY_LADDER].reverse();

const rowCls = computed(() => ({
  [`lv-${props.node.level}`]: true,
  sm: props.depth >= 2,
  "lv-deep": props.depth >= 3,
}));
</script>
