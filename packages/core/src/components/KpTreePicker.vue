<template>
  <div class="kpt" :class="{ inline: inline }">
    <div class="kpsm-search">
      <input v-model="search" aria-label="搜索知识点" placeholder="搜索知识点名称…" />
      <span class="kpsm-count">已选 {{ modelValue.length }}</span>
    </div>
    <div class="kpsm-tree">
      <KpTreeBranch
        v-for="ch in visibleChapters"
        :key="ch.id"
        :chapter="ch"
        :depth="1"
        :children="childrenOf(ch.id)"
        :kps-by-node="kpsByNode"
        :selected="selected"
        :expanded="expanded"
        :is-searching="isSearching"
        :node-visible="nodeVisible"
        :children-of="childrenOf"
        :toggle-node="toggleNode"
        :toggle-kp="toggleKp"
        :toggle-expand="toggleExpand"
        :is-node-all="isNodeAll"
        :is-node-partial="isNodePartial"
        :all-kp-ids-of-node="allKpIdsOfNode"
      />
      <div v-if="visibleChapters.length === 0" class="kpsm-empty">未找到匹配的知识点</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, withDefaults } from "vue";
import type { Chapter, KnowledgePoint } from "../api";
import { buildChapterTreeFlat, type NestedChapter } from "../utils/outline";
import KpTreeBranch from "./KpTreeBranch.vue";

const props = withDefaults(
  defineProps<{
    chapters: Chapter[];
    kps: KnowledgePoint[];
    /** 已选知识点 id（教材序） */
    modelValue: number[];
    /** 内联嵌入（弹窗内）时压缩树高度 */
    inline?: boolean;
    /** 新章节出现时是否默认展开（内联组卷场景传 false，默认收起减少滚动） */
    autoExpand?: boolean;
  }>(),
  {
    autoExpand: true,
  },
);

const emit = defineEmits<{ (e: "update:modelValue", ids: number[]): void }>();

const search = ref("");
const expanded = ref<Set<number>>(new Set());
const selected = computed(() => new Set(props.modelValue));

// N 级章节树（T1）：同级 sort 序，孤儿（parentId 指向已删节点）提升顶层追加末尾
const tree = computed(() => buildChapterTreeFlat(props.chapters));

// 顶层章列表（顶层渲染/空态判断）
const topChapters = computed(() => tree.value.map((n) => n.chapter));

// 章节异步加载：默认展开全部顶层章（不主动收起用户手动折叠的）；immediate 覆盖挂载时章节已就绪的场景
watch(
  tree,
  (roots) => {
    if (!props.autoExpand) return;
    const next = new Set(expanded.value);
    let changed = false;
    for (const n of roots) {
      if (!next.has(n.chapter.id)) {
        next.add(n.chapter.id);
        changed = true;
      }
    }
    if (changed) expanded.value = next;
  },
  { immediate: true },
);

const isSearching = computed(() => search.value.trim() !== "");
const matchName = (s: string) => !isSearching.value || s.toLowerCase().includes(search.value.trim().toLowerCase());

// 节点 → 直属子节点（任意 parentId，sort 序）：替代两级 unitsByChapter
const childrenByParent = computed(() => {
  const map = new Map<number, Chapter[]>();
  const walk = (list: NestedChapter[]) => {
    for (const n of list) {
      if (n.children.length > 0) map.set(n.chapter.id, n.children.map((c) => c.chapter));
      walk(n.children);
    }
  };
  walk(tree.value);
  return map;
});

function childrenOf(nodeId: number): Chapter[] {
  return childrenByParent.value.get(nodeId) ?? [];
}

// 节点直属 KP（按教材序，搜索词过滤）：预计算替代每行 filter+sort；
// 依赖 search/props.kps，搜索变化时整体重算一次
const kpsByNode = computed(() => {
  const map = new Map<number, KnowledgePoint[]>();
  for (const k of props.kps) {
    if (k.chapterId == null || !matchName(k.name)) continue;
    let list = map.get(k.chapterId);
    if (!list) {
      list = [];
      map.set(k.chapterId, list);
    }
    list.push(k);
  }
  for (const list of map.values()) list.sort((a, b) => a.sort - b.sort || a.id - b.id);
  return map;
});

function kpsOfNode(nodeId: number): KnowledgePoint[] {
  return kpsByNode.value.get(nodeId) ?? [];
}

// 节点 → 前序索引（整树一次 DFS）：任意深度节点的教材序位置
const preorderIndex = computed(() => {
  const idx = new Map<number, number>();
  let i = 0;
  const walk = (list: NestedChapter[]) => {
    for (const n of list) {
      idx.set(n.chapter.id, i++);
      walk(n.children);
    }
  };
  walk(tree.value);
  return idx;
});

// 节点 → 其顶层祖先章 sort（教材序主键；章直属先于子节点天然由前序索引保证）
const topSortOf = computed(() => {
  const map = new Map<number, number>();
  for (const root of tree.value) {
    const visit = (list: NestedChapter[]) => {
      for (const n of list) {
        map.set(n.chapter.id, root.chapter.sort);
        visit(n.children);
      }
    };
    visit([root]);
  }
  return map;
});

// 节点全部 KP id（直属 + 全部后代，DFS 前序聚合）：预计算 + 选中数，
// 替代 isNodeAll/isNodePartial 每行全量遍历；章直属排在其子节点之前
const nodeKpIds = computed(() => {
  const ids = new Map<number, number[]>();
  const walk = (node: NestedChapter): number[] => {
    const all = kpsOfNode(node.chapter.id).map((k) => k.id);
    for (const child of node.children) all.push(...walk(child));
    ids.set(node.chapter.id, all);
    return all;
  };
  for (const root of tree.value) walk(root);
  return ids;
});

const nodeSelectedCount = computed(() => {
  const counts = new Map<number, number>();
  for (const [id, idList] of nodeKpIds.value) {
    let n = 0;
    for (const kid of idList) if (selected.value.has(kid)) n++;
    counts.set(id, n);
  }
  return counts;
});

function allKpIdsOfNode(nodeId: number): number[] {
  return nodeKpIds.value.get(nodeId) ?? [];
}

function isNodeAll(nodeId: number): boolean {
  const ids = nodeKpIds.value.get(nodeId);
  return !!ids && ids.length > 0 && (nodeSelectedCount.value.get(nodeId) ?? 0) === ids.length;
}

function isNodePartial(nodeId: number): boolean {
  const ids = nodeKpIds.value.get(nodeId);
  if (!ids || ids.length === 0) return false;
  const hit = nodeSelectedCount.value.get(nodeId) ?? 0;
  return hit > 0 && hit < ids.length;
}

/** 教材序：顶层祖先章 sort → 节点前序索引 → KP 排序（章直属先于子节点） */
function orderKey(kp: KnowledgePoint): [number, number, number, number] {
  if (kp.chapterId == null) return [9999, 9999, kp.sort, kp.id];
  const idx = preorderIndex.value.get(kp.chapterId);
  if (idx === undefined) return [9999, 9999, kp.sort, kp.id];
  return [topSortOf.value.get(kp.chapterId) ?? 9999, idx, kp.sort, kp.id];
}

function emitSorted(set: Set<number>) {
  emit(
    "update:modelValue",
    props.kps
      .filter((k) => set.has(k.id))
      .sort((a, b) => {
        const ka = orderKey(a);
        const kb = orderKey(b);
        return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2] || ka[3] - kb[3];
      })
      .map((k) => k.id),
  );
}

function toggleNode(nodeId: number, e: Event) {
  const on = (e.target as HTMLInputElement).checked;
  const set = new Set(props.modelValue);
  for (const id of allKpIdsOfNode(nodeId)) {
    if (on) set.add(id);
    else set.delete(id);
  }
  emitSorted(set);
}

function toggleExpand(nodeId: number) {
  const next = new Set(expanded.value);
  if (next.has(nodeId)) next.delete(nodeId);
  else next.add(nodeId);
  expanded.value = next;
}

function toggleKp(id: number) {
  const set = new Set(props.modelValue);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  emitSorted(set);
}

// 搜索时只保留含命中 KP 的分支（节点自身或任一后代有直属命中）；null = 未搜索不过滤
const visibleNodeIds = computed(() => {
  if (!isSearching.value) return null;
  const set = new Set<number>();
  const walk = (node: NestedChapter): boolean => {
    const visible = kpsOfNode(node.chapter.id).length > 0 || node.children.some((c) => walk(c));
    if (visible) set.add(node.chapter.id);
    return visible;
  };
  for (const root of tree.value) walk(root);
  return set;
});

function nodeVisible(nodeId: number): boolean {
  const set = visibleNodeIds.value;
  return set === null || set.has(nodeId);
}

/** 搜索时只保留含命中 KP 的顶层章 */
const visibleChapters = computed(() => {
  if (!isSearching.value) return topChapters.value;
  return topChapters.value.filter((c) => nodeVisible(c.id));
});
</script>
