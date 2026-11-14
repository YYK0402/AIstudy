<template>
  <div class="modal-mask" :class="{ open }" @click.self="!busy && !result && $emit('close')">
    <div class="modal">
      <template v-if="result">
        <h2>已{{ result.mode === "replace" ? "恢复" : "合并" }}备份</h2>
        <p class="s t-faint" style="margin-top:0">
          课程 {{ result.counts.courses }} / 知识点 {{ result.counts.kps }} / 题目 {{ result.counts.questions }}
          <template v-if="result.assetFiles > 0"> / 原始文件 {{ result.assetFiles }}</template>
          <template v-if="result.skippedCourses"> / 跳过重复课程 {{ result.skippedCourses }}</template>
        </p>
        <p class="s">数据已写入，刷新页面后生效。</p>
        <div class="modal-actions">
          <button class="btn primary" @click="reloadPage">刷新页面</button>
        </div>
      </template>

      <template v-else-if="!parsed">
        <h2>从备份恢复</h2>
        <p class="s t-faint" style="margin-top:0">
          选择之前导出的 aistudy-backup-*.zip 文件。支持两种方式：覆盖恢复（还原整库）或合并导入（把备份课程与进度并入当前数据）。
        </p>
        <div class="field">
          <button class="btn primary" :disabled="busy" @click="pickFile">{{ busy ? "正在校验备份…" : "选择备份文件" }}</button>
          <input ref="fileInput" type="file" accept=".zip" style="display:none" @change="onFile" />
        </div>
        <div v-if="error" class="s t-danger">{{ error }}</div>
        <div class="modal-actions">
          <button class="btn ghost" :disabled="busy" @click="$emit('close')">取消</button>
        </div>
      </template>

      <template v-else>
        <h2>确认恢复</h2>
        <div class="field">
          <div class="s"><b>{{ parsed.fileName }}</b></div>
          <div class="s t-faint" style="margin-top:6px">
            生成时间：{{ formatTime(parsed.manifest.createdAt) }} · 来源端：{{ hostLabel(parsed.manifest.host) }}
          </div>
          <div class="s t-faint" style="margin-top:4px">
            课程 {{ parsed.manifest.counts.courses }} / 知识点 {{ parsed.manifest.counts.kps }} / 题目
            {{ parsed.manifest.counts.questions }} / 闪卡 {{ parsed.manifest.counts.cards }} / 作答记录
            {{ parsed.manifest.counts.answerRecords }}
            <template v-if="parsed.manifest.options.assets"> / 含原始资料文件</template>
          </div>
          <div v-if="!parsed.manifest.options.apiKeys" class="s t-danger" style="margin-top:4px">
            备份不含 API Key，恢复后需到「模型配置」重新填写。
          </div>
        </div>

        <div class="field">
          <label style="display:flex;gap:8px;align-items:flex-start;cursor:pointer">
            <input v-model="mode" type="radio" value="replace" :disabled="busy" />
            <span>
              <b>覆盖恢复</b>
              <span class="s t-faint" style="display:block">
                清空当前全部数据并还原备份；恢复前会自动导出一份当前数据兜底。
              </span>
            </span>
          </label>
          <label style="display:flex;gap:8px;align-items:flex-start;cursor:pointer;margin-top:10px">
            <input v-model="mode" type="radio" value="merge" :disabled="busy" />
            <span>
              <b>合并导入</b>
              <span class="s t-faint" style="display:block">
                保留当前数据，把备份中的课程与学习进度并入（同名同创建时间的课程自动跳过）；当前模型配置不变。
              </span>
            </span>
          </label>
        </div>

        <template v-if="busy">
          <ProgressBar :value="total > 0 ? done : 1" :max="total > 0 ? total : 1" />
          <div class="s t-faint" style="margin-top:6px">{{ phase }}<template v-if="total > 0">（{{ done }}/{{ total }}）</template></div>
        </template>
        <div v-if="error" class="s t-danger">{{ error }}</div>

        <div class="modal-actions">
          <button class="btn ghost" :disabled="busy" @click="reset">重新选择</button>
          <button class="btn ghost" :disabled="busy" @click="$emit('close')">取消</button>
          <button class="btn" :class="mode === 'replace' ? 'danger-solid' : 'primary'" :disabled="busy" @click="run">
            {{ busy ? "处理中…" : mode === "replace" ? "覆盖恢复" : "合并导入" }}
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { readBackupFile, restoreFromBackup, mergeFromBackup } from "../api";
import type { ParsedBackup, RestoreOutcome } from "../api";
import { getBridge } from "@/bridge";
import { useConfirm } from "../composables/useConfirm";
import ProgressBar from "./ProgressBar.vue";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: "close"): void }>();

const { confirm, confirmWithChoice } = useConfirm();

const fileInput = ref<HTMLInputElement | null>(null);
const parsed = ref<ParsedBackup | null>(null);
const mode = ref<"replace" | "merge">("replace");
const busy = ref(false);
const phase = ref("");
const done = ref(0);
const total = ref(0);
const error = ref("");
const result = ref<RestoreOutcome | null>(null);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
  },
);

function reset() {
  parsed.value = null;
  mode.value = "replace";
  busy.value = false;
  phase.value = "";
  done.value = 0;
  total.value = 0;
  error.value = "";
  result.value = null;
}

function pickFile() {
  if (busy.value) return;
  fileInput.value?.click();
}

function hostLabel(host: string): string {
  if (host === "siyuan") return "思源笔记";
  if (host === "fnos") return "飞牛 fnOS";
  return "未知";
}

function formatTime(iso: string): string {
  if (!iso) return "未知";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : iso;
}

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  busy.value = true;
  error.value = "";
  try {
    parsed.value = await readBackupFile(file);
  } catch (err) {
    console.error("读取备份失败:", err);
    const msg = err instanceof Error ? err.message : "读取备份失败";
    error.value = msg;
    getBridge().showMessage(msg, 4000, "error");
  } finally {
    busy.value = false;
  }
}

async function run() {
  const backup = parsed.value;
  if (!backup || busy.value) return;

  if (mode.value === "replace") {
    const res = await confirmWithChoice({
      title: "确认覆盖恢复",
      message: "当前全部数据将被备份内容覆盖，且不可撤销（恢复前会自动导出一份当前数据兜底）。",
      confirmText: "覆盖并恢复",
      danger: true,
      checkbox: { label: "我已了解并确认覆盖当前数据", defaultChecked: false },
    });
    if (!res.ok || !res.checked) return;
  } else if (
    !(await confirm({
      message: "将把备份中的课程与学习进度并入当前数据（不覆盖现有课程），继续？",
      confirmText: "合并导入",
    }))
  ) {
    return;
  }

  busy.value = true;
  error.value = "";
  phase.value = mode.value === "replace" ? "正在准备恢复…" : "正在准备合并…";
  done.value = 0;
  total.value = 0;
  try {
    const fn = mode.value === "replace" ? restoreFromBackup : mergeFromBackup;
    result.value = await fn(backup, {
      onProgress: (d, t, p) => {
        done.value = d;
        total.value = t;
        phase.value = p;
      },
    });
  } catch (err) {
    console.error("恢复备份失败:", err);
    const msg = err instanceof Error ? err.message : "恢复备份失败";
    error.value = msg;
    getBridge().showMessage(msg, 4000, "error");
  } finally {
    busy.value = false;
  }
}

function reloadPage() {
  window.location.reload();
}
</script>
