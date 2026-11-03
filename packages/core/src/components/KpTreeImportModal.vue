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

      <div v-if="stage === 'preview' && preview" class="import-diff">
        <p class="s t-faint" style="margin:0 0 8px">
          文件：{{ preview.fileName }}
          <template v-if="!preview.courseVerified">（⚠ 缺少课程标识，请确认本文件属于「{{ courseName }}」）</template>
        </p>
        <template v-if="d && !noChanges">
          <section v-if="d.updated.length > 0">
            <h4>更新知识点（{{ d.updated.length }}）</h4>
            <ul>
              <li v-for="u in d.updated" :key="u.id">
                <span class="dn">{{ kpLabel(u.id) }}</span>
                <span v-if="u.name !== undefined" class="t-faint">→ {{ u.name }}</span>
                <span v-if="u.content !== undefined" class="diff-badge">内容</span>
                <span v-if="u.chapterKey !== undefined" class="diff-badge">移至 {{ chName(u.chapterKey) }}</span>
              </li>
            </ul>
          </section>
          <section v-if="d.added.length > 0">
            <h4>新增知识点（{{ d.added.length }}，默认「未学习」）</h4>
            <ul>
              <li v-for="(a, i) in d.added" :key="i">
                <span class="dn">{{ a.name }}</span>
                <span class="diff-badge">{{ chName(a.chapterKey) }}</span>
              </li>
            </ul>
          </section>
          <section v-if="d.removed.length > 0">
            <h4>删除知识点（{{ d.removed.length }}）</h4>
            <ul>
              <li v-for="r in d.removed" :key="r.id" class="t-danger">{{ r.name }}</li>
            </ul>
          </section>
          <section v-if="chCount > 0">
            <h4>章节变更（{{ chCount }}）</h4>
            <ul>
              <li v-for="c in d.chaptersUpdated" :key="c.id">
                <span class="dn">{{ chLabel(c.id) }}</span>
                <span v-if="c.name !== undefined" class="t-faint">→ {{ c.name }}</span>
                <span v-if="c.parentKey !== undefined" class="diff-badge">移至 {{ chName(c.parentKey) }}</span>
              </li>
              <li v-for="a in d.chaptersAdded" :key="a.key">
                <span class="dn">{{ a.name }}</span>
                <span class="diff-badge">{{ chAddBadge(a) }}</span>
              </li>
              <li v-for="r in d.chaptersRemoved" :key="r.id" class="t-danger">{{ r.name }}（删除章节）</li>
            </ul>
          </section>
        </template>
        <p v-else class="s t-faint">文件与当前课程知识点树一致，导入不会产生任何变更。</p>
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

const d = computed(() => preview.value?.diff);
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

function chName(key: string | null): string {
  if (key === null) return "未归章";
  return keyName.value.get(key) ?? "未知章节";
}

function chAddBadge(a: { level: "chapter" | "unit"; parentKey: string | null }): string {
  return a.level === "chapter" ? "新增顶章" : `新增小节（${chName(a.parentKey)}）`;
}

function kpLabel(id: number): string {
  return kpOldName.value.get(id) ?? `#${id}`;
}

function chLabel(id: number): string {
  return chOldName.value.get(id) ?? `#${id}`;
}

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
