<template>
  <div class="tree-node" :class="{ open: ctx.isExpanded(id) }">
    <div
      class="row"
      role="button"
      tabindex="0"
      :data-chapter-id="id"
      :data-depth="depth"
      :data-pos="dropPos"
      :class="[{ active: ctx.isSelected(id) }, dropClass]"
      @click="emit('click', node)"
      @keydown.enter.prevent="emit('click', node)"
      @keydown.space.prevent="emit('click', node)"
      @dragover.prevent="onDragOver"
      @dragleave="ctx.onRowDragLeave(id)"
      @drop="onDrop"
    >
      <input
        v-if="ctx.isBatchMode()"
        type="checkbox"
        class="tp-check"
        :checked="ctx.isBatchChecked(id)"
        @click.stop
        @change="ctx.toggleSelect(id)"
      />
      <span class="tgl" :style="hasChildren ? undefined : 'opacity:0'" @click.stop="ctx.toggleExpand(id)">{{ hasChildren ? "▶" : "" }}</span>
      <span class="tp-tag" :class="depth === 0 ? 'chapter' : depth === 1 ? 'unit' : 'sub'">{{ depth === 0 ? "章" : depth === 1 ? "节" : "小节" }}</span>
      <span class="name">{{ node.chapter.name }}</span>
      <span class="count">{{ ctx.kpCountOf(id) }}</span>
      <template v-if="!ctx.isArchived() && !ctx.isBatchMode()">
        <span class="drag-handle" title="拖拽换序 / 挂为子级" draggable="true" @click.stop @dragstart="emit('dragstart', id)" @dragend="ctx.onDragEnd()">⋮⋮</span>
        <button class="btn sm ghost" @click.stop="ctx.addChapterChild(node.chapter)">＋子级</button>
        <span class="row-more">
          <button class="btn sm ghost row-more-btn" title="更多操作" @click.stop="emit('menu', node)">⋯</button>
          <div v-if="ctx.isRowMenuOpen(id)" class="row-menu" @click.stop>
            <button v-if="depth === 0" @click.stop="ctx.closeRowMenu(); ctx.openReview(node.chapter)">复盘</button>
            <button @click.stop="ctx.closeRowMenu(); ctx.editChapter(node.chapter)">编辑</button>
            <button class="danger" @click.stop="ctx.closeRowMenu(); ctx.delChapter(node.chapter)">删除</button>
          </div>
        </span>
      </template>
    </div>
    <div v-if="hasChildren" class="tree-children">
      <ChapterTreeRow
        v-for="child in node.children"
        :key="child.chapter.id"
        :node="child"
        :depth="depth + 1"
        @dragstart="(nid) => emit('dragstart', nid)"
        @dragover="(n, pos) => emit('dragover', n, pos)"
        @drop="(n, pos) => emit('drop', n, pos)"
        @click="(n) => emit('click', n)"
        @menu="(n) => emit('menu', n)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from "vue";
import type { NestedChapter } from "../utils/outline";
import type { DropPos } from "../utils/chapterMove";
import { chapterTreeCtxKey } from "./chapterTreeCtx";

const props = defineProps<{ node: NestedChapter; depth: number }>();
const emit = defineEmits<{
  dragstart: [id: number];
  dragover: [node: NestedChapter, pos: DropPos];
  drop: [node: NestedChapter, pos: DropPos];
  click: [node: NestedChapter];
  menu: [node: NestedChapter];
}>();

const ctx = inject(chapterTreeCtxKey)!;
const id = computed(() => props.node.chapter.id);
const hasChildren = computed(() => props.node.children.length > 0);
const dropPos = computed(() => ctx.dropPos(id.value));
const dropClass = computed(() => (dropPos.value ? "drop-" + dropPos.value : ""));

/** 行三区间：上/下沿 = 前后插入同级列表，中部 = 挂为直接子级（任意深度一致） */
function posFromEvent(e: DragEvent): DropPos {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const ratio = (e.clientY - rect.top) / rect.height;
  if (ratio < 0.3) return "before";
  if (ratio > 0.7) return "after";
  return "inside";
}

function onDragOver(e: DragEvent) {
  if (ctx.draggingId() === id.value) return;
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  emit("dragover", props.node, posFromEvent(e));
}

function onDrop(e: DragEvent) {
  e.preventDefault();
  if (ctx.draggingId() === id.value) return;
  emit("drop", props.node, posFromEvent(e));
}
</script>
