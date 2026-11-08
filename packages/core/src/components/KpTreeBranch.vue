<template>
  <div class="kpsm-ch">
    <div class="kpsm-row" :class="[rowClass, { checked: isNodeAll(chapter.id) }]">
      <input
        type="checkbox"
        :checked="isNodeAll(chapter.id)"
        :indeterminate.prop="isNodePartial(chapter.id)"
        @change="toggleNode(chapter.id, $event)"
      />
      <span class="nm">{{ chapter.name }}</span>
      <span class="cnt">{{ allKpIdsOfNode(chapter.id).length }}</span>
      <span
        v-if="hasChildren"
        class="tgl"
        role="button"
        tabindex="0"
        :aria-expanded="isExpanded"
        :class="{ open: isExpanded }"
        @click="toggleExpand(chapter.id)"
        @keydown.enter.prevent="toggleExpand(chapter.id)"
        @keydown.space.prevent="toggleExpand(chapter.id)"
      >▾</span>
    </div>
    <!-- 分支节点的子树：可折叠（搜索时自动展开）；直属 KP 与子分支同容器 -->
    <div v-if="hasChildren" v-show="isSearching || isExpanded" class="kpsm-children">
      <KpTreeBranch
        v-for="child in visibleChildren"
        :key="child.id"
        :chapter="child"
        :depth="depth + 1"
        :children="childrenOf(child.id)"
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
      <div v-if="directKps.length > 0" class="kpsm-kps direct">
        <label v-for="kp in directKps" :key="kp.id" class="kpsm-row kp" :class="{ checked: selected.has(kp.id) }">
          <input type="checkbox" :checked="selected.has(kp.id)" @change="toggleKp(kp.id)" />
          <span class="nm">{{ kp.name }}</span>
        </label>
      </div>
    </div>
    <!-- 叶子节点的直属 KP：无展开开关，直接展示 -->
    <div v-else-if="directKps.length > 0" class="kpsm-kps">
      <label v-for="kp in directKps" :key="kp.id" class="kpsm-row kp" :class="{ checked: selected.has(kp.id) }">
        <input type="checkbox" :checked="selected.has(kp.id)" @change="toggleKp(kp.id)" />
        <span class="nm">{{ kp.name }}</span>
      </label>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { Chapter, KnowledgePoint } from "../api";

/**
 * KP 树选择器的递归分支（自递归：组件名=文件名）。
 * 状态提升：选中/展开/搜索全部在上层 KpTreePicker 维护，本组件是无状态渲染单元，
 * 数据经 props 传入（kpsByNode/selected/expanded/isSearching），行为经 props 函数传入。
 */
const props = defineProps<{
  /** 当前节点章节 */
  chapter: Chapter;
  /** 树深度（1=顶层章） */
  depth: number;
  /** 直属子节点（sort 序） */
  children: Chapter[];
  /** 节点 → 直属 KP（教材序，已按搜索词过滤） */
  kpsByNode: Map<number, KnowledgePoint[]>;
  /** 已选 KP id */
  selected: Set<number>;
  /** 已展开节点 id */
  expanded: Set<number>;
  /** 是否处于搜索态（搜索时分支全展开、只显示含命中的分支） */
  isSearching: boolean;
  /** 搜索时节点是否可见（自身或任一后代有命中 KP） */
  nodeVisible: (id: number) => boolean;
  childrenOf: (id: number) => Chapter[];
  toggleNode: (id: number, e: Event) => void;
  toggleKp: (id: number) => void;
  toggleExpand: (id: number) => void;
  isNodeAll: (id: number) => boolean;
  isNodePartial: (id: number) => boolean;
  allKpIdsOfNode: (id: number) => number[];
}>();

const directKps = computed(() => props.kpsByNode.get(props.chapter.id) ?? []);
const hasChildren = computed(() => props.children.length > 0);
const isExpanded = computed(() => props.expanded.has(props.chapter.id));
/** 搜索时只渲染含命中 KP 的子分支 */
const visibleChildren = computed(() =>
  props.isSearching ? props.children.filter((c) => props.nodeVisible(c.id)) : props.children,
);
/** 行样式族：L1 章样式 / L2 节样式 / L3+ 节样式 + deep 档 */
const rowClass = computed(() => (props.depth === 1 ? "ch" : props.depth >= 3 ? "unit deep" : "unit"));
</script>
