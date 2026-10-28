<template>
  <div class="kpt" :class="{ inline: inline }">
    <div class="kpsm-search">
      <input v-model="search" aria-label="搜索知识点" placeholder="搜索知识点名称…" />
      <span class="kpsm-count">已选 {{ modelValue.length }}</span>
    </div>
    <div class="kpsm-tree">
      <div v-for="ch in visibleChapters" :key="ch.id" class="kpsm-ch">
        <div class="kpsm-row ch" :class="{ checked: isNodeAll(ch.id) }">
          <input
            type="checkbox"
            :checked="isNodeAll(ch.id)"
            :indeterminate.prop="isNodePartial(ch.id)"
            @change="toggleNode(ch.id, $event)"
          />
          <span class="nm">{{ ch.name }}</span>
          <span class="cnt">{{ allKpIdsOfNode(ch.id).length }}</span>
          <span class="tgl" :class="{ open: expanded.has(ch.id) }" @click="toggleExpand(ch.id)">▾</span>
        </div>
        <div v-show="isSearching || expanded.has(ch.id)" class="kpsm-children">
          <div v-for="u in visibleUnitsOf(ch.id)" :key="u.id" class="kpsm-unit">
            <div class="kpsm-row unit" :class="{ checked: isNodeAll(u.id) }">
              <input
                type="checkbox"
                :checked="isNodeAll(u.id)"
                :indeterminate.prop="isNodePartial(u.id)"
                @change="toggleNode(u.id, $event)"
              />
              <span class="nm">{{ u.name }}</span>
              <span class="cnt">{{ kpsOfNode(u.id).length }}</span>
            </div>
            <div class="kpsm-kps">
              <label v-for="kp in kpsOfNode(u.id)" :key="kp.id" class="kpsm-row kp" :class="{ checked: selected.has(kp.id) }">
                <input type="checkbox" :checked="selected.has(kp.id)" @change="toggleKp(kp.id)" />
                <span class="nm">{{ kp.name }}</span>
              </label>
            </div>
          </div>
          <div v-if="kpsOfNode(ch.id).length > 0" class="kpsm-kps direct">
            <label v-for="kp in kpsOfNode(ch.id)" :key="kp.id" class="kpsm-row kp" :class="{ checked: selected.has(kp.id) }">
              <input type="checkbox" :checked="selected.has(kp.id)" @change="toggleKp(kp.id)" />
              <span class="nm">{{ kp.name }}</span>
            </label>
          </div>
        </div>
      </div>
      <div v-if="visibleChapters.length === 0" class="kpsm-empty">未找到匹配的知识点</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, withDefaults } from "vue";
import type { Chapter, KnowledgePoint } from "../api";

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

// 章节异步加载：autoExpand 时新出现的章默认展开（不主动收起用户手动折叠的）；immediate 覆盖挂载时章节已就绪的场景
watch(
  () => props.chapters,
  (chs) => {
    if (!props.autoExpand) return;
    const next = new Set(expanded.value);
    let changed = false;
    for (const c of chs) {
      if ((c.level === "chapter" || c.parentId === null) && !next.has(c.id)) {
        next.add(c.id);
        changed = true;
      }
    }
    if (changed) expanded.value = next;
  },
  { immediate: true },
);

const isSearching = computed(() => search.value.trim() !== "");
const matchName = (s: string) => !isSearching.value || s.toLowerCase().includes(search.value.trim().toLowerCase());

const chapterById = computed(() => new Map(props.chapters.map((c) => [c.id, c])));

const chapterSort = (id: number) => chapterById.value.get(id)?.sort ?? 0;

const topChapters = computed(() =>
  props.chapters.filter((c) => c.level === "chapter" || c.parentId === null).sort((a, b) => a.sort - b.sort),
);

// 章节 → 小节列表（按 sort），预计算替代每行 filter+sort
const unitsByChapter = computed(() => {
  const map = new Map<number, Chapter[]>();
  for (const c of props.chapters) {
    if (c.level === "unit" && c.parentId != null) {
      let list = map.get(c.parentId);
      if (!list) {
        list = [];
        map.set(c.parentId, list);
      }
      list.push(c);
    }
  }
  for (const list of map.values()) list.sort((a, b) => a.sort - b.sort);
  return map;
});

function unitsOf(chId: number): Chapter[] {
  return unitsByChapter.value.get(chId) ?? [];
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

// 节点全部 KP id（章 = 直属 + 其下所有节；节 = 直属）：预计算 + 选中数，
// 替代 isNodeAll/isNodePartial 每行全量遍历
const nodeKpIds = computed(() => {
  const ids = new Map<number, number[]>();
  for (const node of topChapters.value) {
    const all = [...kpsOfNode(node.id)];
    for (const u of unitsOf(node.id)) all.push(...kpsOfNode(u.id));
    ids.set(node.id, all.map((k) => k.id));
    for (const u of unitsOf(node.id)) ids.set(u.id, kpsOfNode(u.id).map((k) => k.id));
  }
  return ids;
});

const nodeSelectedCount = computed(() => {
  const counts = new Map<number, number>();
  for (const [id, ids] of nodeKpIds.value) {
    let n = 0;
    for (const kid of ids) if (selected.value.has(kid)) n++;
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

/** 教材序：章序 → 节序（章直属排节之前）→ KP 排序 */
function orderKey(kp: KnowledgePoint): [number, number, number, number] {
  const node = kp.chapterId != null ? chapterById.value.get(kp.chapterId) : undefined;
  if (!node) return [9999, 9999, kp.sort, kp.id];
  if (node.level === "unit" && node.parentId != null) {
    return [chapterSort(node.parentId), node.sort, kp.sort, kp.id];
  }
  return [chapterSort(node.id), -1, kp.sort, kp.id];
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

function toggleExpand(chId: number) {
  const next = new Set(expanded.value);
  if (next.has(chId)) next.delete(chId);
  else next.add(chId);
  expanded.value = next;
}

function toggleKp(id: number) {
  const set = new Set(props.modelValue);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  emitSorted(set);
}

/** 搜索时只保留含命中 KP 的节 */
function visibleUnitsOf(chId: number): Chapter[] {
  const units = unitsOf(chId);
  return isSearching.value ? units.filter((u) => kpsOfNode(u.id).length > 0) : units;
}

/** 搜索时只保留含命中 KP 的章 */
const visibleChapters = computed(() => {
  if (!isSearching.value) return topChapters.value;
  return topChapters.value.filter(
    (ch) => kpsOfNode(ch.id).length > 0 || unitsOf(ch.id).some((u) => kpsOfNode(u.id).length > 0),
  );
});
</script>
