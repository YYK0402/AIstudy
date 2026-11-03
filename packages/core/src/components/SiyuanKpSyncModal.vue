<template>
  <div class="modal-mask" :class="{ open }" @click.self="$emit('close')">
    <div class="modal modal--lg">
      <h2>从思源同步</h2>
      <p class="s t-faint" style="margin-top:0">
        读取思源课程树文档中的知识点区，更新应用的知识点树。
        确认后更新应用数据，<b>掌握度、题目、闪卡、复习排期等学习记录不会被改动</b>。
      </p>

      <p v-if="error" class="s t-danger" style="word-break:break-all">{{ error }}</p>
      <p v-else-if="busy" class="s t-faint">正在读取思源文档…</p>
      <KpTreeChangePreview
        v-else-if="preview"
        :diff="preview.diff"
        :kp-old-name="kpOldName"
        :ch-old-name="chOldName"
        :ch-key-names="keyName"
        :notices="notices"
        empty-text="无变更，应用数据与思源知识点区一致。"
      />

      <div class="modal-actions">
        <button class="btn ghost" :disabled="busy" @click="$emit('close')">关闭</button>
        <button class="btn primary" :disabled="!preview || noChanges || busy" @click="confirm">
          {{ busy ? "同步中…" : `确认同步（${changeCount} 处变更）` }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import KpTreeChangePreview from "./KpTreeChangePreview.vue";
import { applySiyuanKpSync, getData, readSiyuanKpSync, type SiyuanKpSyncPreview } from "../api";
import { getBridge } from "@/bridge";

const props = defineProps<{ open: boolean; courseId: number; courseName: string }>();
const emit = defineEmits<{ (e: "close"): void; (e: "saved"): void }>();

const busy = ref(false);
const error = ref("");
const preview = ref<SiyuanKpSyncPreview | null>(null);
const kpOldName = ref(new Map<number, string>());
const chOldName = ref(new Map<number, string>());

const keyName = computed(() => new Map((preview.value?.tree.chapters ?? []).map((c) => [c.key, c.name])));
const chCount = computed(
  () =>
    (preview.value?.diff.chaptersUpdated.length ?? 0) +
    (preview.value?.diff.chaptersAdded.length ?? 0) +
    (preview.value?.diff.chaptersRemoved.length ?? 0),
);
const changeCount = computed(
  () =>
    (preview.value?.diff.updated.length ?? 0) +
    (preview.value?.diff.added.length ?? 0) +
    (preview.value?.diff.removed.length ?? 0) +
    chCount.value,
);
const noChanges = computed(() => preview.value !== null && changeCount.value === 0);

const notices = computed(() => {
  const p = preview.value;
  if (!p) return [];
  const out: string[] = [];
  if (p.deletedDocs > 0) out.push(`${p.deletedDocs} 个课程/章节文档已在思源中删除，对应知识点本次未同步`);
  if (p.historicalDocs > 0) out.push(`${p.historicalDocs} 个课程/章节文档尚无知识点区，本次未同步`);
  if (p.retained > 0) out.push(`${p.retained} 个应用侧新增知识点尚未写入思源，已保留并将写回对应区`);
  return out;
});

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    error.value = "";
    preview.value = null;
    busy.value = true;
    void load();
  },
);

async function load() {
  try {
    const data = await getData();
    kpOldName.value = new Map(data.knowledgePoints.map((k) => [k.id, k.name]));
    chOldName.value = new Map(data.chapters.map((c) => [c.id, c.name]));
    preview.value = await readSiyuanKpSync(props.courseId);
  } catch (e) {
    console.error("从思源同步读取失败:", e);
    error.value = e instanceof Error ? e.message : "读取思源文档失败";
  } finally {
    busy.value = false;
  }
}

async function confirm() {
  if (!preview.value || busy.value || noChanges.value) return;
  busy.value = true;
  try {
    await applySiyuanKpSync(props.courseId, preview.value);
    getBridge().showMessage(`已同步思源知识点：${changeCount.value} 处变更`);
    emit("saved");
    emit("close");
  } catch (e) {
    console.error("从思源同步失败:", e);
    getBridge().showMessage(e instanceof Error ? e.message : "从思源同步失败", 4000, "error");
  } finally {
    busy.value = false;
  }
}
</script>
