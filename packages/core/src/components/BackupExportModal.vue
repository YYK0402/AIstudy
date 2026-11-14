<template>
  <div class="modal-mask" :class="{ open }" @click.self="!busy && $emit('close')">
    <div class="modal">
      <h2>导出全量备份</h2>
      <p class="s t-faint" style="margin-top:0">
        备份包含全部课程内容与学习进度（知识点、题库、错题、闪卡、复习排程、计划、学习日志）以及模型配置。
        恢复时选择本文件即可完整还原。
      </p>
      <div class="field">
        <label style="display:flex;gap:6px;align-items:center;cursor:pointer">
          <input v-model="opts.includeAssets" type="checkbox" :disabled="busy" />
          包含原始资料文件（PDF / Word / PPT 等）
        </label>
        <div class="s t-faint" style="margin-top:4px">体积可能较大（取决于资料数量）；不勾选时仅备份已解析文本。</div>
        <label style="display:flex;gap:6px;align-items:center;cursor:pointer;margin-top:12px">
          <input v-model="opts.includeApiKeys" type="checkbox" :disabled="busy" />
          包含 API Key（加密存储）
        </label>
        <div class="s t-danger" style="margin-top:4px">
          含密钥的备份文件等同于密钥明文，请勿分享给他人；换机恢复时勾选才能免重填。
        </div>
      </div>
      <template v-if="busy">
        <ProgressBar :value="progress" />
        <div class="s t-faint" style="margin-top:6px">正在打包：{{ Math.round(progress) }}%</div>
      </template>
      <div class="modal-actions">
        <button class="btn ghost" :disabled="busy" @click="$emit('close')">取消</button>
        <button class="btn primary" :disabled="busy" @click="doExport">{{ busy ? "导出中…" : "导出" }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import { exportBackupZip } from "../api";
import { getBridge } from "@/bridge";
import ProgressBar from "./ProgressBar.vue";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: "close"): void }>();

const busy = ref(false);
const progress = ref(0);
const opts = reactive({ includeAssets: true, includeApiKeys: true });

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    busy.value = false;
    progress.value = 0;
    opts.includeAssets = true;
    opts.includeApiKeys = true;
  },
);

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

async function doExport() {
  if (busy.value) return;
  busy.value = true;
  progress.value = 0;
  try {
    const res = await exportBackupZip({ ...opts }, "aistudy-backup", (pct) => {
      progress.value = pct;
    });
    const c = res.counts;
    const asset = res.assetFiles > 0 ? ` / ${res.assetFiles} 个原始文件` : "";
    getBridge().showMessage(
      `已导出备份：${c.courses} 门课程 / ${c.kps} 知识点 / ${c.questions} 题${asset}（${formatBytes(res.bytes)}）`,
    );
    emit("close");
  } catch (e) {
    console.error("导出备份失败:", e);
    getBridge().showMessage(e instanceof Error ? e.message : "导出备份失败", 4000, "error");
  } finally {
    busy.value = false;
  }
}
</script>
