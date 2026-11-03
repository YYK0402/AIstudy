<template>
  <div class="modal-mask" :class="{ open }" @click.self="$emit('close')">
    <div class="modal">
      <h2>导出知识点树</h2>
      <p class="s t-faint" style="margin-top:0">
        把当前课程的知识点树导出为 Markdown 文件（章节层级 + 掌握度 + 统计），可导入笔记软件或留档。
      </p>
      <div class="field">
        <label class="s" style="display:flex;gap:6px;align-items:center;cursor:pointer">
          <input type="checkbox" v-model="opts.includeMastery" :disabled="busy" />
          包含掌握度标记
        </label>
        <label class="s" style="display:flex;gap:6px;align-items:center;cursor:pointer;margin-top:8px">
          <input type="checkbox" v-model="opts.includeWrongCount" :disabled="busy" />
          包含错题数（仅统计在管错题）
        </label>
        <label class="s" style="display:flex;gap:6px;align-items:center;cursor:pointer;margin-top:8px">
          <input type="checkbox" v-model="opts.onlyUnmastered" :disabled="busy" />
          仅导出未掌握知识点（未学习/了解）
        </label>
      </div>
      <div class="modal-actions">
        <button class="btn ghost" :disabled="busy" @click="$emit('close')">取消</button>
        <button class="btn primary" :disabled="busy" @click="doExport">{{ busy ? "导出中…" : "导出" }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import { getData, formatLocalDate } from "../api";
import { buildKpTreeMarkdown } from "../utils/kpTreeExport";
import { getBridge } from "@/bridge";

const props = defineProps<{ courseId: number; open: boolean; courseName: string }>();
const emit = defineEmits<{ (e: "close"): void }>();

const busy = ref(false);
const opts = reactive({ includeMastery: true, includeWrongCount: false, onlyUnmastered: false });

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    opts.includeMastery = true;
    opts.includeWrongCount = false;
    opts.onlyUnmastered = false;
    busy.value = false;
  },
);

async function doExport() {
  if (busy.value) return;
  busy.value = true;
  try {
    const data = await getData();
    const cid = props.courseId;
    const chapters = data.chapters.filter((c) => c.courseId === cid);
    const kps = data.knowledgePoints.filter((k) => k.courseId === cid);
    const questions = data.questions.filter((q) => q.courseId === cid);
    const qIds = new Set(questions.map((q) => q.id));
    const wrongs = data.wrongQuestions.filter((w) => w.qId != null && qIds.has(w.qId));
    const md = buildKpTreeMarkdown({ id: cid, name: props.courseName }, chapters, kps, wrongs, questions, { ...opts });
    const stamp = formatLocalDate().replace(/-/g, "");
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement("a");
    a.href = url;
    a.download = `${props.courseName}-知识点树-${stamp}.md`;
    a.click();
    URL.revokeObjectURL(url);
    getBridge().showMessage("已导出知识点树 Markdown");
    emit("close");
  } catch (e) {
    console.error("导出知识点树失败:", e);
    getBridge().showMessage(e instanceof Error ? e.message : "导出知识点树失败", 4000, "error");
  } finally {
    busy.value = false;
  }
}
</script>
