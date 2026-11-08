<template>
  <div class="import-diff">
    <p v-for="(n, i) in notices" :key="i" class="s t-faint" style="margin:0 0 6px">{{ n }}</p>
    <template v-if="diff && !noChanges">
      <section v-if="diff.updated.length > 0">
        <h4>更新知识点（{{ diff.updated.length }}）</h4>
        <ul>
          <li v-for="u in diff.updated" :key="u.id">
            <span class="dn">{{ kpLabel(u.id) }}</span>
            <span v-if="u.name !== undefined" class="t-faint">→ {{ u.name }}</span>
            <span v-if="u.content !== undefined" class="diff-badge">内容</span>
            <span v-if="u.chapterKey !== undefined" class="diff-badge">移至 {{ chName(u.chapterKey) }}</span>
          </li>
        </ul>
      </section>
      <section v-if="diff.added.length > 0">
        <h4>新增知识点（{{ diff.added.length }}，默认「未学习」）</h4>
        <ul>
          <li v-for="(a, i) in diff.added" :key="i">
            <span class="dn">{{ a.name }}</span>
            <span class="diff-badge">{{ chName(a.chapterKey) }}</span>
          </li>
        </ul>
      </section>
      <section v-if="diff.removed.length > 0">
        <h4>删除知识点（{{ diff.removed.length }}）</h4>
        <ul>
          <li v-for="r in diff.removed" :key="r.id" class="t-danger">{{ r.name }}</li>
        </ul>
      </section>
      <section v-if="chCount > 0">
        <h4>章节变更（{{ chCount }}）</h4>
        <ul>
          <li v-for="c in diff.chaptersUpdated" :key="c.id">
            <span class="dn">{{ chLabel(c.id) }}</span>
            <span v-if="c.name !== undefined" class="t-faint">→ {{ c.name }}</span>
            <span v-if="c.parentKey !== undefined" class="diff-badge">移至 {{ chName(c.parentKey) }}</span>
          </li>
          <li v-for="a in diff.chaptersAdded" :key="a.key">
            <span class="dn">{{ a.name }}</span>
            <span class="diff-badge">{{ chAddBadge(a) }}</span>
          </li>
          <li v-for="r in diff.chaptersRemoved" :key="r.id" class="t-danger">{{ r.name }}（删除章节）</li>
        </ul>
      </section>
    </template>
    <p v-else-if="diff" class="s t-faint">{{ emptyText }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { KpTreeDiff } from "../utils/kpTreeImport";

const props = withDefaults(
  defineProps<{
    diff: KpTreeDiff | null;
    kpOldName: Map<number, string>;
    chOldName: Map<number, string>;
    /** ParsedChapter key → 章节名（「移至 X」展示用） */
    chKeyNames: Map<string, string>;
    /** 只读提示项（文档已删除/尚无区/待写 KP 保留等，读回弹窗用） */
    notices?: string[];
    /** 无变更时的文案 */
    emptyText?: string;
  }>(),
  { notices: () => [], emptyText: "无变更，数据与当前一致。" },
);

const noChanges = computed(
  () =>
    !!props.diff &&
    props.diff.updated.length === 0 &&
    props.diff.added.length === 0 &&
    props.diff.removed.length === 0 &&
    props.diff.chaptersUpdated.length === 0 &&
    props.diff.chaptersAdded.length === 0 &&
    props.diff.chaptersRemoved.length === 0,
);

const chCount = computed(
  () =>
    (props.diff?.chaptersUpdated.length ?? 0) +
    (props.diff?.chaptersAdded.length ?? 0) +
    (props.diff?.chaptersRemoved.length ?? 0),
);

function chName(key: string | null): string {
  if (key === null) return "未归章";
  return props.chKeyNames.get(key) ?? "未知章节";
}

function chAddBadge(a: { level: number; parentKey: string | null }): string {
  return a.level === 1 ? "新增顶章" : `新增小节（${chName(a.parentKey)}）`;
}

function kpLabel(id: number): string {
  return props.kpOldName.get(id) ?? `#${id}`;
}

function chLabel(id: number): string {
  return props.chOldName.get(id) ?? `#${id}`;
}
</script>
