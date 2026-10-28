<template>
  <Teleport to=".ai-study-app">
  <div class="modal-mask" :class="{ open }" @click.self="close">
    <div class="modal">
      <h2>编辑题目</h2>
      <div class="field">
        <label>题干 <span class="req">*</span></label>
        <textarea v-model="form.title" rows="3" aria-label="题干" placeholder="输入题干…" />
      </div>
      <div class="mode-grid">
        <div class="field" style="margin-bottom:0">
          <label>题型</label>
          <select v-model="form.qType" aria-label="题型" :disabled="saving" @change="onTypeChange">
            <option v-for="(label, key) in QUESTION_TYPE_LABELS" :key="key" :value="key">{{ label }}</option>
          </select>
        </div>
        <div class="field" style="margin-bottom:0">
          <label>难度</label>
          <select v-model="form.difficulty" aria-label="难度" :disabled="saving">
            <option v-for="(label, key) in QUESTION_DIFFICULTY_LABELS" :key="key" :value="key">{{ label }}</option>
          </select>
        </div>
      </div>

      <!-- 选项（单选 / 多选） -->
      <div v-if="form.qType === 'single' || form.qType === 'multiple'" class="field">
        <label>选项 <span class="req">*</span>（{{ form.qType === "single" ? "单选其一为正确答案" : "可多选正确答案" }}）</label>
        <div class="qe-options">
          <div v-for="(opt, i) in form.options" :key="i" class="qe-opt">
            <input
              v-model="form.options[i]"
              placeholder="选项内容"
              :disabled="saving"
            />
            <button class="qe-opt-del" :disabled="saving || form.options.length <= 2" title="删除选项" @click="removeOption(i)">✕</button>
          </div>
          <button class="btn sm ghost" :disabled="saving || form.options.length >= 5" @click="addOption">＋ 添加选项</button>
        </div>
        <!-- 单选 / 判断：答案下拉 -->
        <div v-if="form.qType === 'single'" class="qe-answer">
          <label class="qe-answer-label">正确答案</label>
          <select v-model.number="singleAnswerIdx" aria-label="正确答案" :disabled="saving">
            <option v-for="(opt, i) in form.options" :key="i" :value="i">{{ opt || "（未填写选项）" }}</option>
          </select>
        </div>
        <!-- 多选：勾选答案 -->
        <div v-if="form.qType === 'multiple'" class="qe-multi-answer">
          <label v-for="(opt, i) in form.options" :key="i" class="qe-check">
            <input type="checkbox" :checked="multiAnswerIdxs.includes(i)" :disabled="saving" @change="toggleMultiIdx(i)" />
            <span>{{ opt || "（未填写选项）" }}</span>
          </label>
        </div>
      </div>

      <!-- 判断：固定两项，选答案 -->
      <div v-else-if="form.qType === 'judge'" class="field">
        <label>正确答案 <span class="req">*</span></label>
        <select v-model.number="singleAnswerIdx" aria-label="正确答案" :disabled="saving">
          <option v-for="(opt, i) in form.options" :key="i" :value="i">{{ opt }}</option>
        </select>
      </div>

      <!-- 简答：参考答案 -->
      <div v-else class="field">
        <label>参考答案要点 <span class="req">*</span></label>
        <textarea v-model="essayAnswer" rows="4" aria-label="参考答案" placeholder="输入参考答案要点（AI 阅卷依据）" :disabled="saving" />
      </div>

      <div class="field">
        <label>解析</label>
        <textarea v-model="form.analysis" rows="3" aria-label="答案解析" placeholder="答案解析（可选）" />
      </div>

      <div class="field">
        <label>绑定知识点（可多选）</label>
        <div v-if="knowledgePoints.length === 0" class="qe-empty">暂无知识点</div>
        <div class="kp-select">
          <button
            v-for="kp in knowledgePoints"
            :key="kp.id"
            class="kp-chip"
            :class="{ on: form.kpIds.includes(kp.id) }"
            :disabled="saving"
            @click="toggleKp(kp.id)"
          >{{ kp.name }}</button>
        </div>
      </div>

      <div v-if="error" class="s" style="color:var(--as-red);margin-bottom:10px">✗ {{ error }}</div>

      <div class="modal-actions">
        <button class="btn ghost" @click="close">取消</button>
        <button class="btn primary" :disabled="saving" @click="save">{{ saving ? "保存中…" : "保存" }}</button>
      </div>
    </div>
  </div>
  </Teleport>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import {
  updateQuestion,
  parseQuestionKpIds,
  parseQuestionOptions,
  QUESTION_TYPE_LABELS,
  QUESTION_DIFFICULTY_LABELS,
} from "../api";
import type { KnowledgePoint, Question, QuestionType, QuestionDifficulty } from "../api";

const props = defineProps<{
  open: boolean;
  question: Question | null;
  knowledgePoints: KnowledgePoint[];
}>();

const emit = defineEmits<{ (e: "close"): void; (e: "saved", q: Question): void }>();

const form = reactive({
  title: "",
  qType: "single" as QuestionType,
  difficulty: "medium" as QuestionDifficulty,
  options: [] as string[],
  analysis: "",
  kpIds: [] as number[],
});
const singleAnswerIdx = ref(0);
const multiAnswerIdxs = ref<number[]>([]);
const essayAnswer = ref("");
const saving = ref(false);
const error = ref("");

const JUDGE_OPTIONS = ["正确", "错误"];

function initFrom(q: Question) {
  form.title = q.title;
  form.qType = q.qType as QuestionType;
  form.difficulty = q.difficulty as QuestionDifficulty;
  form.analysis = q.analysis;
  form.kpIds = parseQuestionKpIds(q);
  // 全量重置答案状态，避免复用组件时残留上一题的勾选/选中
  singleAnswerIdx.value = 0;
  multiAnswerIdxs.value = [];
  essayAnswer.value = "";
  const opts = parseQuestionOptions(q);
  if (q.qType === "judge") {
    form.options = [...JUDGE_OPTIONS];
    singleAnswerIdx.value = JUDGE_OPTIONS.indexOf(q.answer) >= 0 ? JUDGE_OPTIONS.indexOf(q.answer) : 0;
  } else if (q.qType === "essay") {
    form.options = [];
    essayAnswer.value = q.answer;
  } else {
    form.options = opts.length >= 2 ? opts : ["正确", "错误"];
    if (q.qType === "multiple") {
      const right = q.answer.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
      multiAnswerIdxs.value = right
        .map((r) => form.options.findIndex((o) => o === r))
        .filter((i) => i >= 0);
      if (multiAnswerIdxs.value.length === 0) multiAnswerIdxs.value = [0];
    } else {
      const idx = form.options.findIndex((o) => o === q.answer);
      singleAnswerIdx.value = idx >= 0 ? idx : 0;
    }
  }
  error.value = "";
}

watch(
  () => props.question,
  (q) => {
    if (q) initFrom(q);
  },
  { immediate: true },
);

function onTypeChange() {
  const t = form.qType;
  if (t === "judge") {
    form.options = [...JUDGE_OPTIONS];
    singleAnswerIdx.value = 0;
    multiAnswerIdxs.value = [];
  } else if (t === "essay") {
    form.options = [];
    essayAnswer.value = "";
    singleAnswerIdx.value = 0;
    multiAnswerIdxs.value = [];
  } else {
    if (form.options.length < 2) {
      form.options = ["正确", "错误"];
    }
    singleAnswerIdx.value = Math.min(singleAnswerIdx.value, form.options.length - 1);
    if (t === "multiple") {
      multiAnswerIdxs.value = multiAnswerIdxs.value.filter((i) => i < form.options.length);
      if (multiAnswerIdxs.value.length === 0 && singleAnswerIdx.value < form.options.length) {
        // 从单选/判断切来：继承当前选中的答案
        multiAnswerIdxs.value = [singleAnswerIdx.value];
      }
    } else {
      multiAnswerIdxs.value = [];
    }
  }
}

function addOption() {
  if (form.options.length >= 5) return;
  form.options.push("");
}

function removeOption(i: number) {
  if (form.options.length <= 2) return;
  form.options.splice(i, 1);
  if (form.qType === "single") {
    if (singleAnswerIdx.value === i) singleAnswerIdx.value = 0;
    else if (singleAnswerIdx.value > i) singleAnswerIdx.value -= 1;
  } else if (form.qType === "multiple") {
    multiAnswerIdxs.value = multiAnswerIdxs.value
      .filter((x) => x !== i)
      .map((x) => (x > i ? x - 1 : x));
  }
}

function toggleMultiIdx(i: number) {
  multiAnswerIdxs.value = multiAnswerIdxs.value.includes(i)
    ? multiAnswerIdxs.value.filter((x) => x !== i)
    : [...multiAnswerIdxs.value, i];
}

function toggleKp(id: number) {
  form.kpIds = form.kpIds.includes(id) ? form.kpIds.filter((x) => x !== id) : [...form.kpIds, id];
}

function validate(): string {
  if (!form.title.trim()) return "题干不能为空";
  if (form.qType === "single" || form.qType === "multiple") {
    const trimmed = form.options.map((o) => o.trim());
    if (trimmed.some((o) => !o)) return "选项内容不能为空";
    if (new Set(trimmed).size !== trimmed.length) return "选项内容不能重复";
  }
  if (form.qType === "multiple" && multiAnswerIdxs.value.length === 0) return "请至少勾选一个正确答案";
  if (form.qType === "essay" && !essayAnswer.value.trim()) return "参考答案不能为空";
  return "";
}

async function save() {
  if (!props.question) return;
  const err = validate();
  if (err) {
    error.value = err;
    return;
  }
  saving.value = true;
  error.value = "";
  try {
    const trimmedOpts =
      form.qType === "single" || form.qType === "multiple"
        ? form.options.map((o) => o.trim())
        : form.qType === "judge"
          ? [...form.options]
          : [];
    let answer = "";
    if (form.qType === "essay") {
      answer = essayAnswer.value.trim();
    } else if (form.qType === "multiple") {
      answer = [...multiAnswerIdxs.value]
        .sort((a, b) => a - b)
        .map((i) => trimmedOpts[i])
        .join(",");
    } else {
      answer = trimmedOpts[singleAnswerIdx.value] ?? "";
    }
    const updated = await updateQuestion(props.question.id, {
      title: form.title.trim(),
      options: trimmedOpts,
      answer,
      analysis: form.analysis,
      qType: form.qType,
      difficulty: form.difficulty,
      kpIds: form.kpIds,
    });
    emit("saved", updated);
    close();
  } catch (e) {
    console.error("保存题目失败:", e);
    error.value = e instanceof Error ? e.message : "保存题目失败";
  } finally {
    saving.value = false;
  }
}

function close() {
  emit("close");
}
</script>
