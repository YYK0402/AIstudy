<template>
  <div class="page">
    <div class="page-title"><h1>刷题练习</h1><div class="desc">筛选 · 组卷 · 即时批改</div></div>

    <div v-if="!currentCourseId" class="card">
      <div class="empty-state"><span class="ico">📭</span> 请先在「课程主页」选择或创建一个课程</div>
    </div>

    <template v-else>
      <div v-if="practicing" class="card quiz-card">
        <div v-if="quizSummary" class="quiz-summary">
          <h3>本次刷题小结</h3>
          <div class="big">{{ quizSummary.total }} 题 · 答对 {{ quizSummary.correct }} 题<template v-if="quizSummary.essayCount"> · 简答均分 {{ quizSummary.essayAvg }} 分</template></div>
          <div style="display:flex;gap:8px;justify-content:center;margin-top:14px">
            <button class="btn primary" @click="startPractice">再来一轮</button>
            <button class="btn ghost" @click="endPractice">返回题库</button>
          </div>
        </div>
        <template v-else>
          <div class="quiz-progress">
            {{ quizIdx + 1 }} / {{ quizList.length }}
            <div class="bar"><div class="fill" :style="{ width: ((quizIdx + 1) / quizList.length * 100) + '%' }"></div></div>
          </div>
          <div class="q-title">{{ currentQuestion!.title }}</div>
          <!-- 单选 / 判断 -->
          <template v-if="currentQuestion!.qType === 'single' || currentQuestion!.qType === 'judge'">
            <div
              v-for="opt in currentOptions"
              :key="opt"
              class="option"
              :class="{
                picked: userAnswer === opt,
                right: quizResult && opt === currentQuestion!.answer,
                wrong: quizResult && userAnswer === opt && !quizResult.isCorrect,
              }"
              @click="pickOption(opt)"
            >
              <span class="d"></span>{{ opt }}
            </div>
          </template>
          <!-- 多选 -->
          <template v-else-if="currentQuestion!.qType === 'multiple'">
            <div
              v-for="opt in currentOptions"
              :key="opt"
              class="option"
              :class="{
                picked: pickedMulti.includes(opt),
                right: quizResult && isRightOption(opt),
                wrong: quizResult && pickedMulti.includes(opt) && !isRightOption(opt),
              }"
              @click="toggleMulti(opt)"
            >
              <span class="d"></span>{{ opt }}
            </div>
          </template>
          <!-- 简答 -->
          <template v-else>
            <textarea class="essay-input" v-model="userAnswer" rows="6" placeholder="写下你的回答…" :disabled="!!quizResult" />
            <div v-if="quizResult" class="essay-feedback">
              <div class="score" :class="{ pass: quizResult.isCorrect, fail: !quizResult.isCorrect }">{{ quizResult.score }} 分</div>
              <div class="fb">{{ quizResult.feedback || "AI 未给出具体点评" }}</div>
              <div class="ref">参考答案：{{ currentQuestion!.answer }}</div>
            </div>
          </template>

          <div v-if="quizResult && currentQuestion!.qType !== 'essay'" class="judge-line" :class="quizResult.isCorrect ? 'ok' : 'bad'">
            {{ quizResult.isCorrect ? "✓ 回答正确" : "✗ 回答错误，答案是 " + currentQuestion!.answer }}
          </div>
          <div v-if="quizResult && currentQuestion!.analysis" class="analysis">{{ currentQuestion!.analysis }}</div>

          <div class="quiz-actions">
            <template v-if="!quizResult">
              <button
                v-if="currentQuestion!.qType === 'multiple'"
                class="btn primary"
                :disabled="pickedMulti.length === 0 || submitting"
                @click="submitMulti"
              >{{ submitting ? "提交中…" : "提交" }}</button>
              <button
                v-else-if="currentQuestion!.qType === 'essay'"
                class="btn primary"
                :disabled="!userAnswer.trim() || submitting"
                @click="submitCurrent"
              >{{ submitting ? "AI 阅卷中…" : "提交（AI 阅卷）" }}</button>
            </template>
            <button v-if="quizResult" class="btn primary" :disabled="submitting" @click="nextQuestion">
              {{ quizIdx + 1 < quizList.length ? "下一题" : "查看小结" }}
            </button>
            <button class="btn ghost" @click="endPractice">结束刷题</button>
          </div>
        </template>
      </div>

      <div v-show="!practicing" class="card">
        <h3>AI 出题
          <span style="margin-left:auto;font-size:11px;color:var(--as-text-faint)">从已抽取的知识点命题</span>
        </h3>
        <div v-if="knowledgePoints.length === 0" class="empty-state" style="padding:20px 0">
          <span class="ico">🌱</span> 暂无知识点，请先上传资料并抽取知识点
        </div>
        <template v-else>
          <div class="kp-select">
            <button
              v-for="kp in knowledgePoints"
              :key="kp.id"
              class="kp-chip"
              :class="{ on: selectedKpIds.includes(kp.id) }"
              @click="toggleKp(kp.id)"
            >{{ kp.name }}</button>
          </div>
          <div class="gen-form">
            <div class="field">
              <label>题型</label>
              <select v-model="genQType" :disabled="generating">
                <option v-for="(label, key) in QUESTION_TYPE_LABELS" :key="key" :value="key">{{ label }}</option>
              </select>
            </div>
            <div class="field">
              <label>难度</label>
              <select v-model="genDifficulty" :disabled="generating">
                <option v-for="(label, key) in QUESTION_DIFFICULTY_LABELS" :key="key" :value="key">{{ label }}</option>
              </select>
            </div>
            <div class="field">
              <label>数量</label>
              <select v-model.number="genCount" :disabled="generating">
                <option v-for="n in 5" :key="n" :value="n">{{ n }} 题</option>
              </select>
            </div>
            <button class="btn primary" :disabled="generating || selectedKpIds.length === 0" @click="generate" style="align-self:stretch">
              {{ generating ? "出题中…" : "⚡ 开始出题" }}
            </button>
          </div>
          <div v-if="genError" class="s" style="color:var(--as-red);margin-top:10px">✗ {{ genError }}</div>
          <div v-else-if="genResult" class="s" style="color:var(--as-green);margin-top:10px">✓ 已生成 {{ genResult }} 道题目</div>
        </template>
      </div>

      <div v-show="!practicing" class="card" style="margin-top:14px">
        <h3>题库
          <span style="margin-left:auto;font-size:11px;color:var(--as-text-faint)">共 {{ questions.length }} 题</span>
          <button class="btn primary sm" :disabled="filteredQuestions.length === 0" @click="startPractice" style="margin-left:12px">
            开始刷题
          </button>
        </h3>
        <div v-if="questions.length === 0" class="empty-state" style="padding:24px 0">
          <span class="ico">✏️</span> 暂无题目，选择知识点后点「开始出题」
        </div>
        <template v-else>
          <div class="filter-chips">
            <button class="chip" :class="{ on: filterType === '' }" @click="filterType = ''">全部</button>
            <button
              v-for="(label, key) in QUESTION_TYPE_LABELS"
              :key="key"
              class="chip"
              :class="{ on: filterType === key }"
              @click="filterType = filterType === key ? '' : String(key)"
            >{{ label }}</button>
          </div>
          <div class="q-list">
            <div v-for="q in filteredQuestions" :key="q.id" class="q-fixed">
              <div class="top">
                <span class="tag" :class="q.qType"><span class="d"></span>{{ QUESTION_TYPE_LABELS[q.qType as QuestionType] }}</span>
                <span v-for="name in kpNames(q)" :key="name" class="kp-tag">{{ name }}</span>
              </div>
              <div class="title">{{ q.title }}</div>
              <div class="foot">
                <span>{{ QUESTION_DIFFICULTY_LABELS[q.difficulty as QuestionDifficulty] ?? q.difficulty }}</span>
                <span style="margin-left:auto"></span>
                <button class="btn sm ghost" @click="delQ(q)">删除</button>
              </div>
            </div>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useCourseStore } from "../stores/course";
import {
  queryKnowledgePoints,
  queryQuestions,
  deleteQuestion,
  generateQuestions,
  submitAnswer,
  parseQuestionKpIds,
  parseQuestionOptions,
  QUESTION_TYPE_LABELS,
  QUESTION_DIFFICULTY_LABELS,
} from "../api";
import type { KnowledgePoint, Question, QuestionType, QuestionDifficulty } from "../api";
import type { AnswerResult } from "../api";

const courseStore = useCourseStore();
const currentCourseId = () => courseStore.currentCourseId;

const knowledgePoints = ref<KnowledgePoint[]>([]);
const questions = ref<Question[]>([]);
const selectedKpIds = ref<number[]>([]);
const genQType = ref<QuestionType>("single");
const genDifficulty = ref<QuestionDifficulty>("easy");
const genCount = ref(3);
const generating = ref(false);
const genError = ref("");
const genResult = ref(0);
const filterType = ref("");

const filteredQuestions = computed(() =>
  filterType.value === "" ? questions.value : questions.value.filter((q) => q.qType === filterType.value),
);

// ===== 刷题模式 =====
const practicing = ref(false);
const quizList = ref<Question[]>([]);
const quizIdx = ref(0);
const userAnswer = ref("");
const pickedMulti = ref<string[]>([]);
const quizResult = ref<AnswerResult | null>(null);
const submitting = ref(false);
const quizSummary = ref<{
  total: number;
  correct: number;
  essayCount: number;
  essayAvg: string;
} | null>(null);
const answeredResults = ref<Array<{ isCorrect: boolean; score: string; qType: string }>>([]);

const currentQuestion = computed<Question | null>(() => quizList.value[quizIdx.value] ?? null);
const currentOptions = computed(() => (currentQuestion.value ? parseQuestionOptions(currentQuestion.value) : []));

function resetQuestionState() {
  userAnswer.value = "";
  pickedMulti.value = [];
  quizResult.value = null;
}

function startPractice() {
  const pool = filteredQuestions.value;
  if (pool.length === 0 || practicing.value) return;
  quizList.value = [...pool].sort(() => Math.random() - 0.5);
  quizIdx.value = 0;
  answeredResults.value = [];
  quizSummary.value = null;
  resetQuestionState();
  practicing.value = true;
}

function endPractice() {
  practicing.value = false;
  quizList.value = [];
  quizSummary.value = null;
}

function pickOption(opt: string) {
  if (quizResult.value || submitting.value) return;
  userAnswer.value = opt;
  void submitCurrent();
}

function toggleMulti(opt: string) {
  if (quizResult.value || submitting.value) return;
  pickedMulti.value = pickedMulti.value.includes(opt)
    ? pickedMulti.value.filter((o) => o !== opt)
    : [...pickedMulti.value, opt];
}

function isRightOption(opt: string): boolean {
  if (!quizResult.value || !currentQuestion.value) return false;
  return quizResult.value.isCorrect
    ? currentQuestion.value.answer.split(",").map((s) => s.trim()).includes(opt)
    : false;
}

function submitMulti() {
  userAnswer.value = pickedMulti.value.join(",");
  void submitCurrent();
}

async function submitCurrent() {
  const q = currentQuestion.value;
  if (!q || quizResult.value) return;
  submitting.value = true;
  try {
    const result = await submitAnswer(q, userAnswer.value);
    quizResult.value = result;
    answeredResults.value.push({ isCorrect: result.isCorrect, score: result.score, qType: q.qType });
  } catch (e) {
    console.error("提交作答失败:", e);
    genError.value = e instanceof Error ? e.message : String(e);
  } finally {
    submitting.value = false;
  }
}

function nextQuestion() {
  if (quizIdx.value + 1 < quizList.value.length) {
    quizIdx.value++;
    resetQuestionState();
  } else {
    const total = answeredResults.value.length;
    const correct = answeredResults.value.filter((r) => r.isCorrect).length;
    const essays = answeredResults.value.filter((r) => r.qType === "essay");
    const essayAvg = essays.length
      ? String(Math.round(essays.reduce((s, r) => s + Number(r.score || 0), 0) / essays.length))
      : "";
    quizSummary.value = { total, correct, essayCount: essays.length, essayAvg };
  }
}

function kpNames(q: Question): string[] {
  const map = new Map(knowledgePoints.value.map((k) => [k.id, k.name]));
  return parseQuestionKpIds(q)
    .map((id) => map.get(id))
    .filter((n): n is string => Boolean(n));
}

function toggleKp(id: number) {
  selectedKpIds.value = selectedKpIds.value.includes(id)
    ? selectedKpIds.value.filter((n) => n !== id)
    : [...selectedKpIds.value, id];
}

async function load() {
  if (!currentCourseId()) {
    knowledgePoints.value = [];
    questions.value = [];
    return;
  }
  [knowledgePoints.value, questions.value] = await Promise.all([
    queryKnowledgePoints(currentCourseId()),
    queryQuestions(currentCourseId()),
  ]);
}

async function generate() {
  if (!currentCourseId() || selectedKpIds.value.length === 0) return;
  generating.value = true;
  genError.value = "";
  genResult.value = 0;
  try {
    const created = await generateQuestions(currentCourseId(), {
      kpIds: selectedKpIds.value,
      count: genCount.value,
      qType: genQType.value,
      difficulty: genDifficulty.value,
    });
    genResult.value = created.length;
    questions.value = [...created, ...questions.value];
  } catch (e) {
    genError.value = e instanceof Error ? e.message : String(e);
  } finally {
    generating.value = false;
  }
}

async function delQ(q: Question) {
  if (!window.confirm(`确定删除题目「${q.title.slice(0, 20)}…」？`)) return;
  try {
    await deleteQuestion(q.id);
    questions.value = questions.value.filter((x) => x.id !== q.id);
  } catch (e) {
    console.error("删除题目失败:", e);
  }
}

watch(
  () => courseStore.currentCourseId,
  () => {
    genError.value = "";
    genResult.value = 0;
    selectedKpIds.value = [];
    filterType.value = "";
    load();
  },
);

onMounted(load);
</script>
