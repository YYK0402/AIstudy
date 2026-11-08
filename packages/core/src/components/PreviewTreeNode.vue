<template>
  <div>
    <div class="tp-node-row" :data-depth="depth" :style="{ marginLeft: depth * 14 + 'px' }">
      <span class="tp-tag" :class="depth === 0 ? 'chapter' : depth === 1 ? 'unit' : 'sub'">{{ depth === 0 ? "章" : depth === 1 ? "节" : "小节" }}</span>
      <input v-model="node.name" class="tp-input" :aria-label="`节点名称 L${depth + 1}`" placeholder="节点名称" />
      <span v-if="node.variants.length" class="tp-variants" :title="node.variants.join('；')">（{{ node.variants[0] }}{{ node.variants.length > 1 ? ` 等${node.variants.length}种写法` : "" }}）</span>
      <span v-if="node.from.length" class="tp-from">{{ node.from.slice(0, 2).join("、") }}{{ node.from.length > 2 ? "…" : "" }}</span>
      <span v-if="node.unlocated" class="tp-warn" title="存在未能定位到正文的标题">⚠</span>
      <button class="btn sm ghost" data-act="add" @click="emit('add', node.id)">＋子</button>
      <button class="btn sm ghost" data-act="remove" @click="emit('remove', node.id)">删除</button>
    </div>
    <PreviewTreeNode
      v-for="child in node.children"
      :key="child.id"
      :node="child"
      :depth="depth + 1"
      @add="(id) => emit('add', id)"
      @remove="(id) => emit('remove', id)"
    />
  </div>
</template>

<script setup lang="ts">
/** 目录预览树节点（递归自身引用）：variants=该章的其余写法；from=来源资料名；unlocated=该节点存在未能定位到正文的标题映射 */
export interface PreviewNode {
  id: number;
  name: string;
  variants: string[];
  from: string[];
  unlocated: boolean;
  chapterId: number | null;
  children: PreviewNode[];
}

defineProps<{ node: PreviewNode; depth: number }>();
const emit = defineEmits<{ add: [number]; remove: [number] }>();
</script>
