<template>
  <Teleport to=".ai-study-app">
  <div class="modal-mask" :class="{ open }" @click.self="$emit('close')">
    <div class="modal modal--lg">
      <h2>导入真题</h2>
      <p class="s" style="margin:4px 0 12px">按约定格式粘贴 Markdown（每块一题，块间用 --- 分隔），解析后可编辑导入；未匹配知识点不阻断，导入后可批量绑定。</p>
      <div class="field">
        <textarea
          v-model="text"
          rows="10"
          placeholder="粘贴真题 Markdown…&#10;&#10;格式示例：&#10;# 2024考研政治真题&#10;1. 题干...&#10;A. 选项A&#10;答案: A&#10;---&#10;2. ..."
        ></textarea>
        <div style="display:flex;gap:8px;margin-top:6px">
          <button class="btn ghost sm" @click="text = IMPORT_SAMPLE">粘贴示例</button>
          <button class="btn ghost sm" @click="text = ''">清空</button>
        </div>
      </div>
      <div class="field">
        <label class="field-label">关联试卷</label>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <select v-model="paperId" class="input">
            <option :value="null">不关联试卷（直接导入题库）</option>
            <option v-for="p in existingPapers" :key="p.id" :value="p.id">
              {{ p.name }}（{{ p.year }}年，{{ p.questionCount }}题）
            </option>
          </select>
          <button class="btn ghost sm" @click="showCreatePaper = true">+ 新建试卷</button>
        </div>
      </div>
      <div v-if="showCreatePaper" class="qimp-paper-create">
        <input v-model="newPaperName" class="input" placeholder="试卷名称，如：2024考研政治真题" />
        <input v-model.number="newPaperYear" class="input" type="number" placeholder="年份" style="width:100px" />
        <button class="btn ghost sm" :disabled="creatingPaper" @click="createPaper">{{ creatingPaper ? "创建中…" : "创建" }}</button>
        <button class="btn ghost sm" @click="showCreatePaper = false">取消</button>
      </div>
      <div class="modal-actions" style="margin-top:12px">
        <button class="btn primary" :disabled="!text.trim()" @click="preview">预览解析</button>
        <button class="btn ghost" @click="$emit('close')">取消</button>
      </div>

      <div v-if="report" class="qimp-report">
        <p class="s">
          解析完成：<b class="t-success">成功 {{ report.drafts.length }} 题</b>
          <template v-if="report.errors.length"> · <b class="t-danger">失败 {{ report.errors.length }} 题</b></template>
          <template v-if="report.paperName"> · 识别试卷：<b>{{ report.paperName }}</b></template>
        </p>
        <div v-if="report.errors.length" class="qimp-errors">
          <p v-for="e in report.errors" :key="e.line + e.reason" class="qimp-err">第 {{ e.line }} 行：{{ e.reason }}</p>
        </div>
        <div v-if="report.warnings.length" class="qimp-warnings">
          <p v-for="w in report.warnings" :key="w.line + w.reason" class="qimp-warn-line">第 {{ w.line }} 行：{{ w.reason }}</p>
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
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import {
  importQuestions,
  createExamPaper,
  getExamPapers,
  QUESTION_TYPE_LABELS,
  QUESTION_DIFFICULTY_LABELS,
} from "../api";
import {
  parseQuestionsMarkdown,
  IMPORT_SAMPLE,
  type ImportParseResult,
} from "../utils/questionImport";
import type { KnowledgePoint, ExamPaperWithQuestions } from "../api";
import { getBridge } from "@/bridge";

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
const paperId = ref<number | null>(null);
const showCreatePaper = ref(false);
const newPaperName = ref("");
const newPaperYear = ref<number | undefined>(undefined);
const existingPapers = ref<ExamPaperWithQuestions[]>([]);
const creatingPaper = ref(false);

watch(
  () => props.open,
  async (v) => {
    if (!v) return;
    try {
      existingPapers.value = await getExamPapers(props.courseId);
    } catch (e) {
      getBridge().showMessage(e instanceof Error ? e.message : "加载试卷列表失败", 4000, "error");
      existingPapers.value = [];
    }
    report.value = null;
    paperId.value = null;
    text.value = "";
    showCreatePaper.value = false;
    newPaperName.value = "";
    newPaperYear.value = undefined;
  },
);

function preview() {
  report.value = parseQuestionsMarkdown(text.value, props.knowledgePoints);
  // 如果解析到试卷名称且用户未选择试卷，提示用户
  const r = report.value;
  if (r?.paperName && !paperId.value) {
    // 尝试匹配现有试卷
    const matched = existingPapers.value.find(
      (p) => p.name === r.paperName,
    );
    if (matched) {
      paperId.value = matched.id;
    }
  }
}

async function createPaper() {
  if (!newPaperName.value.trim() || creatingPaper.value) return;
  creatingPaper.value = true;
  try {
    const paper = await createExamPaper(
      props.courseId,
      newPaperName.value.trim(),
      newPaperYear.value ?? 2024,
    );
    existingPapers.value = await getExamPapers(props.courseId);
    paperId.value = paper.id;
    showCreatePaper.value = false;
  } catch (e) {
    getBridge().showMessage(e instanceof Error ? e.message : "创建试卷失败", 4000, "error");
  } finally {
    creatingPaper.value = false;
  }
}

async function doImport() {
  if (!report.value || report.value.drafts.length === 0) return;
  importing.value = true;
  try {
    const created = await importQuestions(props.courseId, report.value.drafts, {
      paperId: paperId.value,
      source: paperId.value ? "paper" : "import",
    });
    emit("imported", created.length);
  } catch (e) {
    console.error("导入题库失败:", e);
    getBridge().showMessage(e instanceof Error ? e.message : "导入题库失败", 4000, "error");
  } finally {
    importing.value = false;
  }
}
</script>

