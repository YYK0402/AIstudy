<template>
  <div class="modal-mask" :class="{ open }" @click.self="$emit('close')">
    <div class="modal">
      <h2>导出课程包</h2>
      <p class="s t-faint" style="margin-top:0">
        把本课程打包成一个 .zip 文件，可发给他人。对方在插件首页点「导入课程包」选择该文件，即生成一门新课程（不含你的学习进度与本地文档绑定）。
      </p>
      <div class="field">
        <label class="s" style="display:flex;gap:6px;align-items:center;cursor:pointer">
          <input type="checkbox" v-model="opts.includeQuestions" :disabled="busy" />
          包含题库与试卷
        </label>
        <label class="s" style="display:flex;gap:6px;align-items:center;cursor:pointer;margin-top:8px">
          <input type="checkbox" v-model="opts.includeCards" :disabled="busy" />
          包含闪卡
        </label>
        <label class="s" style="display:flex;gap:6px;align-items:center;cursor:pointer;margin-top:8px">
          <input type="checkbox" v-model="opts.includeAssets" :disabled="busy" />
          包含原始资料文件（PDF / Word 等）
        </label>
        <div class="s t-faint" style="margin-top:6px">原始文件体积可能较大；请仅分享你原创或有权分享的资料，尊重原始版权。</div>
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
import { exportCourseZip } from "../api";

const props = defineProps<{ courseId: number; open: boolean }>();
const emit = defineEmits<{ (e: "close"): void }>();

const busy = ref(false);
const opts = reactive({ includeQuestions: true, includeCards: false, includeAssets: false });

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    opts.includeQuestions = true;
    opts.includeCards = false;
    opts.includeAssets = false;
    busy.value = false;
  },
);

async function doExport() {
  if (busy.value) return;
  busy.value = true;
  try {
    const res = await exportCourseZip(props.courseId, { ...opts });
    const c = res.counts;
    const asset = res.assetFiles > 0 ? ` / ${res.assetFiles} 原始文件` : "";
    window.siyuanAiStudy.showMessage(`已导出课程包：${c.chapters} 章 / ${c.kps} 知识点 / ${c.materials} 资料 / ${c.questions} 题${asset}`);
    emit("close");
  } catch (e) {
    console.error("导出课程包失败:", e);
    window.siyuanAiStudy.showMessage(e instanceof Error ? e.message : "导出课程包失败", 4000, "error");
  } finally {
    busy.value = false;
  }
}
</script>
