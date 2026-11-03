<template>
  <div class="modal-mask" :class="{ open }" @click.self="$emit('close')">
    <div class="modal modal--lg">
      <h2>导入知识点树</h2>
      <p class="s t-faint" style="margin-top:0">
        选择之前导出的「知识点树」Markdown（含 ch/kp 身份标记），编辑后用「确认导入」更新当前课程的知识点树。
      </p>

      <div class="field" style="display:flex;gap:8px;align-items:center">
        <button class="btn" style="width:100%" :disabled="busy" @click="fileInput?.click()">
          <AppIcon name="upload" :size="14" /> {{ fileName || "选择文件…" }}
        </button>
        <input ref="fileInput" type="file" accept=".md,.markdown,text/markdown" style="display:none" @change="onFileChange" />
      </div>

      <p v-if="parseError" class="s t-danger" style="word-break:break-all">{{ parseError }}</p>

      <div v-if="stage === 'preview' && preview">
        <p class="s t-faint" style="margin:0 0 8px">
          文件：{{ preview.fileName }}
          <template v-if="!preview.courseVerified">（⚠ 缺少课程标识，请确认本文件属于「{{ courseName }}」）</template>
        </p>
        <KpTreeChangePreview
          :diff="d"
          :kp-old-name="kpOldName"
          :ch-old-name="chOldName"
          :ch-key-names="keyName"
          empty-text="文件与当前课程知识点树一致，导入不会产生任何变更。"
        />
      </div>

      <p v-if="stage === 'pick'" class="s t-faint">
        导入将更新知识点名称、内容、章节结构与顺序，并新建 / 删除章节与知识点；
        <b>掌握度、错题、闪卡、复习排期等学习记录不会被改动</b>。
      </p>

      <div class="modal-actions">
        <button class="btn ghost" :disabled="busy" @click="$emit('close')">关闭</button>
        <template v-if="stage === 'preview' && preview">
          <button class="btn ghost" :disabled="busy" @click="resetToPick">重选文件</button>
          <button class="btn primary" :disabled="noChanges || busy" @click="confirm">{{ confirmLabel }}</button>
        </template>
        <button v-else class="btn primary" :disabled="!file || busy" @click="analyze">{{ busy ? "解析中…" : "预览变更" }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import AppIcon from "./AppIcon.vue";
import KpTreeChangePreview from "./KpTreeChangePreview.vue";
import { confirmKpTreeImport, getData, previewKpTreeImport, type KpTreeImportPreview } from "../api";
import { getBridge } from "@/bridge";

const props = defineProps<{ courseId: number; open: boolean; courseName: string }>();
const emit = defineEmits<{ (e: "close"): void; (e: "saved"): void }>();

const stage = ref<"pick" | "preview">("pick");
const busy = ref(false);
const file = ref<File | null>(null);
const fileName = ref("");
const parseError = ref("");
const preview = ref<KpTreeImportPreview | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const kpOldName = ref(new Map<number, string>());
const chOldName = ref(new Map<number, string>());

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    stage.value = "pick";
    file.value = null;
    fileName.value = "";
    parseError.value = "";
    preview.value = null;
    busy.value = false;
    if (fileInput.value) fileInput.value.value = "";
  },
);

const d = computed(() => preview.value?.diff ?? null);
const keyName = computed(() => new Map((preview.value?.tree.chapters ?? []).map((c) => [c.key, c.name])));
const chCount = computed(
  () => (d.value?.chaptersUpdated.length ?? 0) + (d.value?.chaptersAdded.length ?? 0) + (d.value?.chaptersRemoved.length ?? 0),
);
const changeCount = computed(
  () => (d.value?.updated.length ?? 0) + (d.value?.added.length ?? 0) + (d.value?.removed.length ?? 0) + chCount.value,
);
const noChanges = computed(() => preview.value !== null && changeCount.value === 0);
const confirmLabel = computed(() => {
  if (busy.value) return "导入中…";
  if (noChanges.value) return "无变更";
  return `确认导入（${changeCount.value} 处变更）`;
});

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0] ?? null;
  file.value = f;
  fileName.value = f?.name ?? "";
  parseError.value = "";
  if (f) void analyze();
}

async function analyze() {
  if (!file.value || busy.value) return;
  busy.value = true;
  parseError.value = "";
  preview.value = null;
  try {
    const data = await getData();
    kpOldName.value = new Map(data.knowledgePoints.map((k) => [k.id, k.name]));
    chOldName.value = new Map(data.chapters.map((c) => [c.id, c.name]));
    preview.value = await previewKpTreeImport(file.value, props.courseId);
    stage.value = "preview";
  } catch (e) {
    console.error("解析知识点树失败:", e);
    parseError.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

function resetToPick() {
  stage.value = "pick";
  preview.value = null;
  parseError.value = "";
}

async function confirm() {
  if (!preview.value || busy.value || noChanges.value) return;
  busy.value = true;
  try {
    await confirmKpTreeImport(props.courseId, preview.value);
    getBridge().showMessage(`已导入知识点树：${changeCount.value} 处变更`);
    emit("saved");
    emit("close");
  } catch (e) {
    console.error("导入知识点树失败:", e);
    getBridge().showMessage(e instanceof Error ? e.message : "导入知识点树失败", 4000, "error");
  } finally {
    busy.value = false;
  }
}
</script>
