<template>
  <div class="modal-mask" :class="{ open }" @click.self="$emit('close')">
    <div class="modal modal--lg">
      <h2>导入真题</h2>
      <p class="s" style="margin:4px 0 12px">按约定格式粘贴 Markdown（每块一题，块间用 --- 分隔），解析后可编辑导入；未匹配知识点不阻断，导入后可批量绑定。</p>
      <div class="field">
        <textarea
          v-model="text"
          rows="10"
          placeholder="粘贴真题 Markdown…"
        ></textarea>
        <div style="display:flex;gap:8px;margin-top:6px">
          <button class="btn ghost sm" @click="text = IMPORT_SAMPLE">粘贴示例</button>
          <button class="btn ghost sm" @click="text = ''">清空</button>
        </div>
      </div>
      <div class="modal-actions" style="margin-top:12px">
        <button class="btn primary" :disabled="!text.trim()" @click="preview">预览解析</button>
        <button class="btn ghost" @click="$emit('close')">取消</button>
      </div>

      <div v-if="report" class="qimp-report">
        <p class="s">
          解析完成：<b style="color:var(--as-green)">成功 {{ report.drafts.length }} 题</b>
          <template v-if="report.errors.length"> · <b style="color:var(--as-red)">失败 {{ report.errors.length }} 题</b></template>
        </p>
        <div v-if="report.errors.length" class="qimp-errors">
          <p v-for="e in report.errors" :key="e.line + e.reason" class="qimp-err">第 {{ e.line }} 行：{{ e.reason }}</p>
        </div>
        <div v-if="report.drafts.length" class="qimp-list">
          <div v-for="(d, i) in report.drafts" :key="i" class="qimp-item">
            <span class="qimp-type">{{ QUESTION_TYPE_LABELS[d.qType] }}·{{ QUESTION_DIFFICULTY_LABELS[d.difficulty] }}</span>
            <span class="qimp-title">{{ d.title.replace(/\n/g, " ").slice(0, 30) }}{{ d.title.length > 30 ? "…" : "" }}</span>
            <span v-if="d.unmatchedKpNames.length" class="qimp-warn">未匹配知识点：{{ d.unmatchedKpNames.join("、") }}</span>
          </div>
        </div>
        <div class="modal-actions" style="margin-top:12px">
          <button
            class="btn primary"
            :disabled="report.drafts.length === 0 || importing"
            @click="doImport"
          >
            {{ importing ? "导入中…" : `导入 ${report.drafts.length} 题` }}
          </button>
          <button class="btn ghost" @click="report = null">返回修改</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import {
  importQuestions,
  QUESTION_TYPE_LABELS,
  QUESTION_DIFFICULTY_LABELS,
} from "../api";
import {
  parseQuestionsMarkdown,
  IMPORT_SAMPLE,
  type ImportParseResult,
} from "../utils/questionImport";
import type { KnowledgePoint } from "../api";

const props = defineProps<{
  open: boolean;
  courseId: number;
  knowledgePoints: KnowledgePoint[];
}>();
const emit = defineEmits<{
  close: [];
  imported: [count: number];
}>();

const text = ref("");
const report = ref<ImportParseResult | null>(null);
const importing = ref(false);

function preview() {
  report.value = parseQuestionsMarkdown(text.value, props.knowledgePoints);
}

async function doImport() {
  if (!report.value || report.value.drafts.length === 0) return;
  importing.value = true;
  try {
    const created = await importQuestions(props.courseId, report.value.drafts);
    emit("imported", created.length);
  } catch (e) {
    console.error("导入题库失败:", e);
    window.siyuanAiStudy.showMessage(e instanceof Error ? e.message : "导入题库失败", 4000, "error");
  } finally {
    importing.value = false;
  }
}
</script>

