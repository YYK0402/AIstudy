<template>
  <div class="page">
    <div class="page-title"><h1>刷题练习</h1><div class="desc">筛选 · 组卷 · 即时批改</div></div>

    <div v-if="!currentCourseId()" class="card">
      <div class="empty-state"><span class="ico"><AppIcon name="folder" :size="28" /></span> 请先在「课程主页」选择或创建一个课程</div>
    </div>

    <template v-else>
      <div v-if="practicing" class="card quiz-card">
        <div v-if="quizSummary && reviewing" class="quiz-review">
          <div class="review-progress">{{ quizIdx + 1 }} / {{ quizList.length }} · 回看</div>
          <div class="review-chips" aria-label="题目导航">
            <button
              v-for="(q, i) in quizList"
              :key="i"
              class="chip"
              :class="{ on: i === quizIdx, ok: answeredResults[i]?.isCorrect === true, bad: answeredResults[i] ? !answeredResults[i].isCorrect : undefined }"
              :title="answeredResults[i] ? (answeredResults[i].isCorrect ? '答对' : '答错') : '未判分'"
              @click="goReview(i)"
            >{{ i + 1 }}</button>
          </div>
          <div class="q-title">{{ currentQuestion!.title }}</div>
          <!-- 客观题：标出用户作答与正确答案 -->
          <template v-if="['single', 'judge', 'multiple'].includes(currentQuestion!.qType)">
            <div
              v-for="(opt, oi) in currentOptions"
              :key="oi"
              class="option"
              :class="{
                picked: reviewUserPicked.includes(opt),
                right: isReviewRight(opt),
                wrong: reviewUserPicked.includes(opt) && !isReviewRight(opt),
              }"
            >
              <span class="d"></span>{{ opt }}
            </div>
          </template>
          <!-- 简答 / 填空 / 翻译：我的作答 + 判分结果 + 参考答案 -->
          <template v-else>
            <div class="review-essay">
              <div class="s t-faint">我的作答</div>
              <div class="essay-answered">{{ reviewResult?.userAnswer || "（未作答 / 未判分）" }}</div>
              <div v-if="reviewResult" class="essay-feedback">
                <div class="score" :class="{ pass: reviewResult.isCorrect, fail: !reviewResult.isCorrect }">{{ reviewResult.score }} 分</div>
                <div v-if="reviewResult.feedback" class="fb">{{ reviewResult.feedback }}</div>
                <div class="ref">{{ getAnswerLabel() }}：{{ currentQuestion!.answer }}</div>
              </div>
            </div>
          </template>
          <div v-if="reviewResult && currentQuestion!.qType !== 'essay'" class="judge-line" :class="reviewResult.isCorrect ? 'ok' : 'bad'">
            {{ reviewResult.isCorrect ? "✓ 回答正确" : "✗ 回答错误，答案是 " + currentQuestion!.answer }}
          </div>
          <div v-if="currentQuestion!.analysis" class="analysis">{{ currentQuestion!.analysis }}</div>
          <div class="review-actions">
            <div style="display:flex;gap:8px">
              <button class="btn ghost" :disabled="quizIdx === 0" @click="goReview(quizIdx - 1)">上一题</button>
              <button class="btn ghost" :disabled="quizIdx >= quizList.length - 1" @click="goReview(quizIdx + 1)">下一题</button>
            </div>
            <button class="btn primary" @click="reviewing = false">返回小结</button>
          </div>
          <!-- 就本题 AI 问答（辅助理解，会话按题留存） -->
          <div class="ask-panel">
            <button class="ask-toggle" @click="toggleAsk">
              <AppIcon name="spark" :size="14" /> AI 问答
              <span class="s t-faint" style="font-weight:400">就这道题和它的知识点提问，帮你弄懂为止</span>
            </button>
            <div v-if="askOpen" class="ask-body">
              <div v-if="askTurns.length === 0" class="s t-faint ask-empty">围绕题干、选项、答案或关联知识点问点什么吧。</div>
              <div v-else class="ask-list">
                <div v-for="(t, i) in askTurns" :key="i" class="ask-msg" :class="t.role">
                  <div class="who">{{ t.role === "user" ? "我" : "AI" }}</div>
                  <div class="txt">{{ t.content }}</div>
                </div>
                <div v-if="askLoading" class="ask-msg assistant">
                  <div class="who">AI</div>
                  <div class="txt">思考中…</div>
                </div>
              </div>
              <div v-if="askError" class="s t-danger" style="margin-bottom:8px">✗ {{ askError }}</div>
              <div class="ask-input-row">
                <input
                  v-model="askInput"
                  class="ask-input"
                  :disabled="askLoading"
                  placeholder="就这道题/知识点问点什么…"
                  aria-label="向 AI 提问"
                  @keydown.enter.prevent="sendAsk"
                />
                <button class="btn sm primary" :disabled="!askInput.trim() || askLoading" @click="sendAsk">
                  {{ askLoading ? "回答中…" : "发送" }}
                </button>
              </div>
            </div>
          </div>
        </div>
        <div v-else-if="quizSummary" class="quiz-summary">
          <h3>本次刷题小结</h3>
          <div class="big">{{ quizSummary.total }} 题 · 答对 {{ quizSummary.correct }} 题<template v-if="quizSummary.essayCount"> · 简答均分 {{ quizSummary.essayAvg }} 分</template></div>
          <div v-if="testDoneTitles.length" class="plan-note">✓ 测评任务已自动勾选：{{ testDoneTitles.join("、") }}</div>
          <div style="display:flex;gap:8px;justify-content:center;margin-top:14px">
            <button class="btn ghost" @click="startReview">回看题目</button>
            <button class="btn primary" @click="againPractice">再来一轮</button>
            <button class="btn ghost" @click="endPractice">返回题库</button>
          </div>
        </div>
        <template v-else>
          <div class="quiz-progress">
            {{ quizIdx + 1 }} / {{ quizList.length }}
            <div class="bar"><div class="fill" :style="{ width: ((quizIdx + 1) / quizList.length * 100) + '%' }"></div></div>
          </div>
          <div class="q-title">{{ currentQuestion!.title }}</div>
          <!-- 单选 / 判断（radiogroup：方向键移焦，Space/Enter 选择） -->
          <template v-if="currentQuestion!.qType === 'single' || currentQuestion!.qType === 'judge'">
            <div role="radiogroup" :aria-label="`第 ${quizIdx + 1} 题选项`">
              <div
                v-for="(opt, oi) in currentOptions"
                :key="opt"
                ref="optionEls"
                class="option"
                role="radio"
                :aria-checked="pickedSingle === opt"
                :tabindex="oi === optionFocusIdx ? 0 : -1"
                :class="{
                  picked: pickedSingle === opt,
                  right: revealed && opt === currentQuestion!.answer,
                  wrong: revealed && pickedSingle === opt && !quizResult!.isCorrect,
                }"
                @click="pickOption(opt, oi)"
                @keydown="onOptionKeydown($event, oi)"
              >
                <span class="d"></span>{{ opt }}
              </div>
            </div>
          </template>
          <!-- 多选（listbox：方向键移焦，Space/Enter 勾选） -->
          <template v-else-if="currentQuestion!.qType === 'multiple'">
            <div role="listbox" aria-multiselectable="true" :aria-label="`第 ${quizIdx + 1} 题选项`">
              <div
                v-for="(opt, oi) in currentOptions"
                :key="opt"
                ref="optionEls"
                class="option"
                role="option"
                :aria-selected="pickedMulti.includes(opt)"
                :tabindex="oi === optionFocusIdx ? 0 : -1"
                :class="{
                  picked: pickedMulti.includes(opt),
                  right: revealed && isRightOption(opt),
                  wrong: revealed && pickedMulti.includes(opt) && !isRightOption(opt),
                }"
                @click="toggleMulti(opt, oi)"
                @keydown="onOptionKeydown($event, oi)"
              >
                <span class="d"></span>{{ opt }}
              </div>
            </div>
          </template>
          <!-- 简答 / 填空 / 翻译 -->
          <template v-else>
            <textarea
              class="essay-input"
              v-model="userAnswer"
              rows="6"
              :aria-label="getInputLabel()"
              :placeholder="getInputPlaceholder()"
              :disabled="!!quizResult"
            />
            <div v-if="revealed" class="essay-feedback">
              <div class="score" :class="{ pass: quizResult!.isCorrect, fail: !quizResult!.isCorrect }">{{ quizResult!.score }} 分</div>
              <div class="fb">{{ quizResult!.feedback || (currentQuestion!.qType === 'translation' ? 'AI 未给出具体点评' : '') }}</div>
              <div class="ref">{{ getAnswerLabel() }}：{{ currentQuestion!.answer }}</div>
            </div>
          </template>

          <div v-if="quizError" class="s t-danger" style="margin-bottom:10px">
            ✗ {{ quizError }}
            <button v-if="pendingGrading !== null" class="btn sm" style="margin-left:8px" :disabled="submitting" @click="regrade">
              {{ submitting ? "判分中…" : "重新判分" }}
            </button>
          </div>
          <div v-if="quizResult && !revealed" class="s t-faint" style="margin-top:12px">已提交。收口模式：本轮答完后可在回看中查看解析与得分。</div>
          <div v-if="revealed && currentQuestion!.qType !== 'essay'" class="judge-line" :class="quizResult!.isCorrect ? 'ok' : 'bad'">
            {{ quizResult!.isCorrect ? "✓ 回答正确" : "✗ 回答错误，答案是 " + currentQuestion!.answer }}
          </div>
          <div v-if="revealed && quizResult!.masteryNotes.length" class="mastery-note">↓ 掌握度：{{ quizResult!.masteryNotes.join(" · ") }}</div>
          <div v-if="revealed && quizResult!.planNotes.length" class="plan-note">✓ 计划任务已自动勾选：{{ quizResult!.planNotes.join("、") }}</div>
          <div v-if="revealed && currentQuestion!.analysis" class="analysis">{{ currentQuestion!.analysis }}</div>

          <div class="quiz-actions">
            <template v-if="!quizResult">
              <button
                v-if="currentQuestion!.qType === 'multiple'"
                class="btn primary"
                :disabled="pickedMulti.length === 0 || submitting"
                @click="submitMulti"
              >{{ submitting ? "提交中…" : "提交" }}</button>
              <button
                v-else-if="['essay', 'translation'].includes(currentQuestion!.qType)"
                class="btn primary"
                :disabled="!userAnswer.trim() || submitting"
                @click="submitCurrent"
              >{{ submitting ? "AI 阅卷中…" : "提交（AI 阅卷）" }}</button>
              <button
                v-else-if="currentQuestion!.qType === 'cloze'"
                class="btn primary"
                :disabled="!userAnswer.trim() || submitting"
                @click="submitCurrent"
              >{{ submitting ? "提交中…" : "提交答案" }}</button>
              <button
                v-else
                class="btn primary"
                :disabled="pickedSingle === null || submitting"
                @click="submitPicked"
              >{{ submitting ? "提交中…" : "提交答案" }}</button>
            </template>
            <button v-if="quizResult" class="btn primary" :disabled="submitting" @click="nextQuestion">
              {{ quizIdx + 1 < quizList.length ? "下一题" : "查看小结" }}
            </button>
            <button class="btn ghost" @click="endPractice">结束刷题</button>
          </div>
        </template>
      </div>

      <!-- 去自测（?kp=）专属路径：有题直接刷，无题一键生成后自动开刷 -->
      <div v-if="selfTestKp && !practicing" class="card selftest-banner" style="margin-bottom:14px">
        <span class="st-ico">🎯</span>
        <div class="st-main">
          <div class="st-title">自测：{{ selfTestKp.name }}</div>
          <div class="st-meta">
            {{ selfTestKp.chapterName || "未分章" }} · 题库已有 {{ selfTestPool.length }} 道相关题
          </div>
          <div v-if="selfTestError" class="s t-danger">{{ selfTestError }}</div>
        </div>
        <button v-if="selfTestPool.length > 0" class="btn primary" @click="startSelfTest">
          开始刷题（{{ selfTestPool.length }} 题）
        </button>
        <button v-else class="btn primary" :disabled="selfTestBusy" @click="generateSelfTest">
          <AppIcon name="spark" :size="14" /> {{ selfTestBusy ? "出题中…" : "生成自测题并开始" }}
        </button>
        <button class="btn ghost sm" @click="kpChangeOpen = true">换一个</button>
        <button class="st-close" title="关闭" @click="selfTestKpId = null"><AppIcon name="x" :size="14" /></button>
      </div>

      <div v-show="!practicing && !archived" class="card">
        <h3>AI 出题
          <span style="margin-left:auto;font-size:11px;color:var(--as-text-faint)">从已抽取的知识点命题</span>
        </h3>
        <div v-if="knowledgePoints.length === 0" class="empty-state" style="padding:20px 0">
          <span class="ico"><AppIcon name="spark" :size="28" /></span> 暂无知识点，请先上传资料并抽取知识点
        </div>
        <template v-else>
          <GenConfigBar
            :selected-count="selectedKpIds.length"
            :disabled="generating"
            :action-label="generating ? '出题中…' : '开始出题'"
            @select="genKpOpen = true"
            @action="generate"
          >
            <template #options>
              <div class="field">
                <label>题型</label>
                <select v-model="genQType" :disabled="generating" aria-label="题型">
                  <option v-for="(label, key) in QUESTION_TYPE_LABELS" :key="key" :value="key">{{ label }}</option>
                </select>
              </div>
              <div class="field">
                <label>难度</label>
                <select v-model="genDifficulty" :disabled="generating" aria-label="难度">
                  <option v-for="(label, key) in QUESTION_DIFFICULTY_LABELS" :key="key" :value="key">{{ label }}</option>
                </select>
              </div>
              <div class="field">
                <label>数量</label>
                <select v-model.number="genCount" :disabled="generating" aria-label="数量">
                  <option v-for="n in 5" :key="n" :value="n">{{ n }} 题</option>
                </select>
              </div>
            </template>
          </GenConfigBar>
          <div v-if="genError" class="s t-danger" style="margin-top:10px">✗ {{ genError }}</div>
          <div v-else-if="genCreated.length > 0" class="gen-done">
            <span class="t-success">✓ 已生成 {{ genCreated.length }} 道题目</span>
            <button class="btn sm primary" @click="practiceGenerated">立即刷题 →</button>
            <button class="btn sm ghost" @click="genCreated = []">收起</button>
          </div>
        </template>
      </div>

      <div v-show="!practicing" class="card">
        <h3>题库
          <span style="margin-left:auto;font-size:11px;color:var(--as-text-faint)">共 {{ questions.length }} 题</span>
          <button v-if="!archived" class="btn ghost sm" @click="importOpen = true" style="margin-left:12px">导入真题</button>
          <button class="btn ghost sm" @click="paperModalOpen = true" style="margin-left:8px">试卷管理</button>
          <button class="btn ghost sm" :disabled="filteredQuestions.length === 0" @click="exportMarkdown" style="margin-left:8px">导出</button>
          <button
            class="btn primary sm"
            :disabled="questions.length === 0"
            :title="questions.length === 0 ? '题库为空：请先选择知识点出题，或导入真题' : '选择题型与范围开始刷题'"
            style="margin-left:8px"
            @click="openSetModal"
          >
            开始刷题
          </button>
        </h3>
        <SkeletonList v-if="loading && questions.length === 0 && knowledgePoints.length === 0" :rows="4" />
        <LoadError
          v-else-if="error && questions.length === 0 && knowledgePoints.length === 0"
          :message="error"
          @retry="load"
        />
        <EmptyState v-else-if="questions.length === 0" compact icon="pencil" text="题库为空。&#10;先在上方「AI 出题」选择知识点生成，或导入已有真题。">
          <button class="btn sm primary" :disabled="!currentCourseId()" @click="scrollToGen">去出题</button>
        </EmptyState>
        <template v-else>
          <div v-if="!archived" class="q-batch-bar">
            <button class="chip" :class="{ on: selectedAll }" @click="toggleSelectAll">
              {{ selectedAll ? "取消全选" : "全选" }}（{{ filteredQuestions.length }}）
            </button>
            <span v-if="selectedIds.size > 0" class="q-batch-count">已选 {{ selectedIds.size }} 题</span>
            <span style="flex:1"></span>
            <button class="btn sm ghost" :disabled="selectedIds.size === 0" @click="batchKpOpen = true">批量绑定知识点</button>
            <button class="btn sm ghost danger" :disabled="selectedIds.size === 0" @click="batchDelete">批量删除</button>
          </div>
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
            <div v-for="q in pagedQuestions" :key="q.id" class="q-fixed">
              <div class="top">
                <label v-if="!archived" class="q-check">
                  <input type="checkbox" :checked="selectedIds.has(q.id)" @change="toggleSelect(q.id)" />
                </label>
                <span class="tag" :class="q.qType"><span class="d"></span>{{ QUESTION_TYPE_LABELS[q.qType as QuestionType] }}</span>
                <span class="src-tag">{{ questionSourceLabel(q.source) }}</span>
                <span v-for="name in kpNames(q)" :key="name" class="tag-plain">{{ name }}</span>
              </div>
              <div class="title">{{ q.title }}</div>
              <div class="foot">
                <span>{{ QUESTION_DIFFICULTY_LABELS[q.difficulty as QuestionDifficulty] ?? q.difficulty }}</span>
                <span style="margin-left:auto"></span>
                <button v-if="!archived" class="btn sm ghost" @click="editing = q">编辑</button>
                <button class="btn sm ghost" @click="delQ(q)">删除</button>
              </div>
            </div>
          </div>
          <div v-if="questionTotalPages > 1" class="pagination">
            <button class="btn sm ghost" :disabled="questionPage === 1" @click="questionPage--">‹ 上一页</button>
            <span class="pg-info">{{ questionPage }} / {{ questionTotalPages }}</span>
            <button class="btn sm ghost" :disabled="questionPage === questionTotalPages" @click="questionPage++">下一页 ›</button>
          </div>
        </template>
      </div>

      <QuestionEditModal
        :open="editing !== null"
        :question="editing"
        :knowledge-points="knowledgePoints"
        @close="editing = null"
        @saved="onQuestionSaved"
      />
      <QuestionBatchKpModal
        :open="batchKpOpen"
        :ids="[...selectedIds]"
        :knowledge-points="knowledgePoints"
        @close="batchKpOpen = false"
        @saved="onBatchKpSaved"
      />
      <QuestionSetModal
        :open="setModalOpen"
        :questions="questions"
        :knowledge-points="knowledgePoints"
        :chapters="chapters"
        :preset="setPreset"
        :reveal-default="quizRevealDefault"
        :reveal-locked="currentTestContext?.kind === 'exam'"
        @close="onSetModalClose"
        @generated="onQuizGenerated"
      />
      <KpSelectModal
        :open="genKpOpen"
        :chapters="chapters"
        :kps="knowledgePoints"
        :initial-selected="selectedKpIds"
        @close="genKpOpen = false"
        @confirm="onGenKpConfirm"
      />
      <KpSelectModal
        :open="kpChangeOpen"
        :chapters="chapters"
        :kps="knowledgePoints"
        :initial-selected="selfTestKpId != null ? [selfTestKpId] : []"
        @close="kpChangeOpen = false"
        @confirm="onSelfTestKpConfirm"
      />
      <QuestionImportModal
        :open="importOpen"
        :course-id="currentCourseId()"
        :knowledge-points="knowledgePoints"
        @close="importOpen = false"
        @imported="onQuestionsImported"
      />
      <ExamPaperModal
        :open="paperModalOpen"
        :course-id="currentCourseId()"
        :on-quiz-start="beginPractice"
        @close="paperModalOpen = false"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: "QuizView" });

// keep-alive 停用（切到其他页签）时关闭本地弹层，避免 teleport modal 残留在其他页面上方
onDeactivated(() => {
    editing.value = null;
    batchKpOpen.value = false;
    setModalOpen.value = false;
    genKpOpen.value = false;
    kpChangeOpen.value = false;
    importOpen.value = false;
    paperModalOpen.value = false;
});
import GenConfigBar from "../components/GenConfigBar.vue";
import EmptyState from "../components/EmptyState.vue";
import AppIcon from "../components/AppIcon.vue";
import { onDeactivated, computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useCourseStore } from "../stores/course";
import {
  queryKnowledgePoints,
  queryQuestions,
  deleteQuestion,
  deleteQuestions,
  generateQuestions,
  submitAnswer,
  regradeAnswer,
  GradingFailedError,
  parseQuestionKpIds,
  parseQuestionOptions,
  shuffleList,
  exportQuestionsMarkdown,
  questionSourceLabel,
  queryChapters,
  QUESTION_TYPE_LABELS,
  QUESTION_DIFFICULTY_LABELS,
  completeTestTasks,
  getSettings,
  queryQuestionAsk,
  sendQuizAsk,
} from "../api";
import { kpsOfChapter } from "../utils/chapterScope";
import { capStudySec } from "../constants/study";
import type { Chapter, KnowledgePoint, Question, QuestionType, QuestionDifficulty, TestTaskContext } from "../api";
import type { AnswerResult, AskTurn } from "../api";
import QuestionEditModal from "../components/QuestionEditModal.vue";
import QuestionBatchKpModal from "../components/QuestionBatchKpModal.vue";
import QuestionSetModal from "../components/QuestionSetModal.vue";
import SkeletonList from "../components/SkeletonList.vue";
import LoadError from "../components/LoadError.vue";
import { useLoad } from "../composables/useLoad";
import QuestionImportModal from "../components/QuestionImportModal.vue";
import KpSelectModal from "../components/KpSelectModal.vue";
import ExamPaperModal from "../components/ExamPaperModal.vue";
import { useConfirm } from "../composables/useConfirm";
import { getBridge } from "@/bridge";

const courseStore = useCourseStore();
const { confirm } = useConfirm();
const currentCourseId = () => courseStore.currentCourseId;
/** 课程归档后隐藏出题入口（已有题目仍可练习） */
const archived = computed(() => courseStore.currentCourse?.status === "archived");
const route = useRoute();
const router = useRouter();

const knowledgePoints = ref<KnowledgePoint[]>([]);
const questions = ref<Question[]>([]);
const chapters = ref<Chapter[]>([]);
const selectedKpIds = ref<number[]>([]);
const genKpOpen = ref(false);
const genQType = ref<QuestionType>("single");
const genDifficulty = ref<QuestionDifficulty>("easy");
const genCount = ref(3);
const generating = ref(false);
const genError = ref("");
const genCreated = ref<Question[]>([]);
const filterType = ref("");

function onGenKpConfirm(ids: number[]) {
  selectedKpIds.value = ids;
  genKpOpen.value = false;
}

function practiceGenerated() {
  if (genCreated.value.length === 0) return;
  beginQuiz(shuffleList(genCreated.value));
  genCreated.value = [];
}

// ===== 去自测（?kp=）banner =====
const selfTestKpId = ref<number | null>(null);
const selfTestBusy = ref(false);
const selfTestError = ref("");
const kpChangeOpen = ref(false);
const selfTestKp = computed(() =>
  selfTestKpId.value != null ? knowledgePoints.value.find((k) => k.id === selfTestKpId.value) ?? null : null,
);
const selfTestPool = computed(() =>
  selfTestKpId.value != null
    ? questions.value.filter((q) => parseQuestionKpIds(q).includes(selfTestKpId.value as number))
    : [],
);

function onSelfTestKpConfirm(ids: number[]) {
  kpChangeOpen.value = false;
  selfTestKpId.value = ids.length > 0 ? ids[0] : null;
  selfTestError.value = "";
}

function startSelfTest() {
  if (selfTestPool.value.length === 0) return;
  beginQuiz(shuffleList(selfTestPool.value));
}

/** 无题时一键：AI 生成该 KP 自测题 → 生成完直接开刷 */
async function generateSelfTest() {
  const kp = selfTestKp.value;
  if (!kp || !currentCourseId() || selfTestBusy.value) return;
  selfTestBusy.value = true;
  selfTestError.value = "";
  try {
    const created = await generateQuestions(currentCourseId(), {
      kpIds: [kp.id],
      count: genCount.value,
      qType: genQType.value,
      difficulty: genDifficulty.value,
    });
    if (created.length === 0) {
      selfTestError.value = "AI 未生成题目，请重试或调整下方题型/难度";
      return;
    }
    questions.value = [...created, ...questions.value];
    getBridge().showMessage(`已为「${kp.name}」生成 ${created.length} 题，开始刷题`);
    beginQuiz(shuffleList(created));
  } catch (e) {
    console.error("生成自测题失败:", e);
    selfTestError.value = e instanceof Error ? e.message : String(e);
  } finally {
    selfTestBusy.value = false;
  }
}

const filteredQuestions = computed(() =>
  filterType.value === "" ? questions.value : questions.value.filter((q) => q.qType === filterType.value),
);

// 题库列表分页（50/页）：长题库只渲染当前页
const QUESTION_PAGE_SIZE = 50;
const questionPage = ref(1);
const questionTotalPages = computed(() => Math.max(1, Math.ceil(filteredQuestions.value.length / QUESTION_PAGE_SIZE)));
const pagedQuestions = computed(() =>
  filteredQuestions.value.slice((questionPage.value - 1) * QUESTION_PAGE_SIZE, questionPage.value * QUESTION_PAGE_SIZE),
);
// 筛选变化回第一页；删除导致当前页空时回落
watch(filterType, () => {
  questionPage.value = 1;
});
watch(questionPage, (p) => {
  if (p > questionTotalPages.value) questionPage.value = 1;
});

// ===== 刷题模式 =====
const practicing = ref(false);
const quizList = ref<Question[]>([]);
const quizIdx = ref(0);
const userAnswer = ref("");
const pickedMulti = ref<string[]>([]);
/** 单选/判断两步提交：先选中，再点「提交答案」 */
const pickedSingle = ref<string | null>(null);
const quizResult = ref<AnswerResult | null>(null);
const submitting = ref(false);
const quizSummary = ref<{
  total: number;
  correct: number;
  essayCount: number;
  essayAvg: string;
} | null>(null);
const answeredResults = ref<Array<{ isCorrect: boolean; score: string; qType: string; userAnswer: string; feedback: string }>>([]);
/** 本轮解析展示时机：immediate 即时 / afterAll 收口（组卷面板选定或全局默认；模考强制收口） */
const revealMode = ref<"immediate" | "afterAll">("immediate");
/** 全局默认解析时机（设置页 quizRevealMode，组卷面板未指定时的回退） */
const quizRevealDefault = ref<"immediate" | "afterAll">("immediate");
/** 收口模式下「已判分但未揭示」的可见性解耦：revealed=true 才展示对错/解析 */
const revealed = computed(() => quizResult.value !== null && revealMode.value === "immediate");
// ===== 回看模式（答完一轮后只读回顾 + 就题 AI 问答） =====
const reviewing = ref(false);
const reviewResult = computed(() => answeredResults.value[quizIdx.value] ?? null);
const reviewUserPicked = computed<string[]>(() => {
  const r = reviewResult.value;
  if (!r || !r.userAnswer) return [];
  return r.userAnswer.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
});
function isReviewRight(opt: string): boolean {
  const q = currentQuestion.value;
  if (!q) return false;
  return q.answer.split(/[,，]/).map((s) => s.trim()).includes(opt);
}
function startReview() {
  reviewing.value = true;
  quizIdx.value = 0;
  void resetAskPanel();
}
function goReview(i: number) {
  if (i < 0 || i >= quizList.value.length || i === quizIdx.value) return;
  quizIdx.value = i;
  void resetAskPanel();
}
async function resetAskPanel() {
  askOpen.value = false;
  askTurns.value = [];
  askError.value = "";
  askInput.value = "";
  const q = currentQuestion.value;
  if (!q) return;
  const s = await queryQuestionAsk(q.id);
  if (currentQuestion.value?.id === q.id) askTurns.value = s ? [...s.turns] : [];
}
// ===== 回看 AI 问答 =====
const askOpen = ref(false);
const askTurns = ref<AskTurn[]>([]);
const askLoading = ref(false);
const askError = ref("");
const askInput = ref("");
function toggleAsk() {
  askOpen.value = !askOpen.value;
}
async function sendAsk() {
  const q = currentQuestion.value;
  const text = askInput.value.trim();
  if (!q || !text || askLoading.value) return;
  askLoading.value = true;
  askError.value = "";
  // 乐观追加 user 轮（sendQuizAsk 内部落库；失败时本地与存储一致，重问自然续上）
  askTurns.value.push({ role: "user", content: text, createTime: new Date().toISOString() });
  askInput.value = "";
  try {
    const reply = await sendQuizAsk(q.courseId, q.id, text);
    askTurns.value.push({ role: "assistant", content: reply, createTime: new Date().toISOString() });
  } catch (e) {
    console.error("回看问答失败:", e);
    askError.value = e instanceof Error ? e.message : "问答失败，请重试";
  } finally {
    askLoading.value = false;
  }
}
/** 本轮刷题的测评来源：仅章节组卷（?set=）/结业模考（?exam=1）入口开刷时非空，答完最后一题据此自动勾 test 任务 */
const currentTestContext = ref<TestTaskContext | null>(null);
/** 本轮自动勾掉的测评任务标题（小结展示用） */
const testDoneTitles = ref<string[]>([]);

const quizError = ref("");
/** 简答判分失败后待重新判分的作答记录 id（非 null 时错误提示处显示「重新判分」按钮） */
const pendingGrading = ref<number | null>(null);
const currentQuestion = computed<Question | null>(() => quizList.value[quizIdx.value] ?? null);
const currentOptions = computed(() => (currentQuestion.value ? parseQuestionOptions(currentQuestion.value) : []));

/** 当前题展示时刻（毫秒）：提交时算答题实际耗时，写入学习时长日志 */
const questionStartAt = ref(0);
function startQuestionTimer() {
  questionStartAt.value = Date.now();
}
function elapsedQuestionSec(): number {
  return questionStartAt.value ? capStudySec((Date.now() - questionStartAt.value) / 1000) : 0;
}

function resetQuestionState() {
  userAnswer.value = "";
  pickedMulti.value = [];
  pickedSingle.value = null;
  quizResult.value = null;
  quizError.value = "";
  pendingGrading.value = null;
  optionFocusIdx.value = 0;
}

function beginQuiz(list: Question[], context: TestTaskContext | null = null, reveal?: "immediate" | "afterAll") {
  quizList.value = [...list];
  quizIdx.value = 0;
  answeredResults.value = [];
  quizSummary.value = null;
  testDoneTitles.value = [];
  currentTestContext.value = context;
  revealMode.value = reveal ?? quizRevealDefault.value;
  reviewing.value = false;
  askOpen.value = false;
  askTurns.value = [];
  askError.value = "";
  askInput.value = "";
  resetQuestionState();
  startQuestionTimer();
  practicing.value = true;
}

// ===== 组卷面板 =====
const setModalOpen = ref(false);
/** 预填（章节复盘 ?set= / 结业模考）：知识点范围 + 标题；关闭面板后清除 */
const setPreset = ref<{ kpIds: number[]; title: string } | null>(null);

function scrollToGen() {
  document.querySelector(".gen-bar")?.scrollIntoView({ block: "center", behavior: "smooth" });
}

function openSetModal() {
  if (practicing.value) return;
  setPreset.value = null;
  setModalOpen.value = true;
}

function onSetModalClose() {
  setModalOpen.value = false;
  setPreset.value = null;
  // 生成时 close 紧随 generated 触发（beginQuiz 已接管 context 且已在刷题）；仅取消组卷时清空待生效来源
  if (!practicing.value) currentTestContext.value = null;
}

function onQuizGenerated(list: Question[], opts: { revealMode: "immediate" | "afterAll" }) {
  if (list.length === 0) return;
  // 先取出待生效来源，再由 beginQuiz 存为本轮 context
  const ctx = currentTestContext.value;
  currentTestContext.value = null;
  beginQuiz(list, ctx, opts.revealMode);
}

function againPractice() {
  beginQuiz(shuffleList(quizList.value), null, revealMode.value);
}

/** 组卷预填入口：?set=<章节id>（章节复盘）/ ?exam=1（结业模考，全课程知识点） */
async function enterPresetSet() {
  const setRaw = route.query.set;
  const examRaw = route.query.exam;
  if ((setRaw == null || setRaw === "") && (examRaw == null || examRaw === "")) return;
  const clearQuery = () => router.replace({ path: "/quiz" });
  if (practicing.value) {
    clearQuery();
    return;
  }
  try {
    if (examRaw != null && examRaw !== "") {
      // 结业模考覆盖全课程题目（含未绑定知识点的题），故不按知识点过滤
      if (questions.value.length === 0) {
        getBridge().showMessage("课程暂无题目，无法进行结业模考", 4000, "error");
        return;
      }
      currentTestContext.value = { kind: "exam" };
      setPreset.value = { kpIds: [], title: `结业模考 · 全课程` };
      setModalOpen.value = true;
      return;
    }
    const chId = Number(Array.isArray(setRaw) ? setRaw[0] : setRaw);
    if (!Number.isFinite(chId) || chId <= 0 || !currentCourseId()) return;
    const allChapters = await queryChapters(currentCourseId());
    const ch = allChapters.find((c) => c.id === chId);
    if (!ch) {
      getBridge().showMessage("章节不存在，可能已被删除", 4000, "error");
      return;
    }
    const kpIds = kpsOfChapter(knowledgePoints.value, allChapters, ch.id).map((k) => k.id);
    if (kpIds.length === 0) {
      getBridge().showMessage("本章暂无知识点，无法组卷", 4000, "error");
      return;
    }
    currentTestContext.value = { kind: "chapter-test", chapterId: chId };
    setPreset.value = { kpIds, title: `章节组卷 · ${ch.name}` };
    setModalOpen.value = true;
  } catch (e) {
    console.error("组卷预填失败:", e);
    getBridge().showMessage(e instanceof Error ? e.message : "组卷预填失败", 4000, "error");
  } finally {
    clearQuery();
  }
}

/** 学习页「去自测」带入 ?kp=：显示自测 banner（有题直接刷 / 无题一键生成后开刷） */
function enterKpPractice() {
  const raw = route.query.kp;
  if (raw == null || raw === "") return;
  const kpId = Number(Array.isArray(raw) ? raw[0] : raw);
  const clearQuery = () => router.replace({ path: "/quiz" });
  if (!Number.isFinite(kpId) || kpId <= 0) {
    clearQuery();
    return;
  }
  if (practicing.value) {
    clearQuery();
    return;
  }
  selfTestKpId.value = kpId;
  selfTestError.value = "";
  clearQuery();
}

function endPractice() {
  practicing.value = false;
  quizList.value = [];
  quizSummary.value = null;
  quizError.value = "";
  reviewing.value = false;
  askOpen.value = false;
  askTurns.value = [];
  askInput.value = "";
  setPreset.value = null;
  currentTestContext.value = null;
  testDoneTitles.value = [];
}

const optionEls = ref<HTMLElement[]>([]);
const optionFocusIdx = ref(0);

function pickOption(opt: string, oi?: number) {
  if (quizResult.value || submitting.value) return;
  pickedSingle.value = pickedSingle.value === opt ? null : opt;
  if (oi !== undefined) optionFocusIdx.value = oi;
}

function onOptionKeydown(e: KeyboardEvent, oi: number): void {
  if (quizResult.value) return;
  const opts = currentOptions.value;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const next = e.key === "ArrowDown" ? (oi + 1) % opts.length : (oi - 1 + opts.length) % opts.length;
    optionFocusIdx.value = next;
    optionEls.value[next]?.focus();
  } else if (e.key === " " || e.key === "Enter") {
    e.preventDefault();
    const opt = opts[oi];
    if (currentQuestion.value?.qType === "multiple") toggleMulti(opt, oi);
    else pickOption(opt, oi);
  }
}

function getInputLabel(): string {
  const q = currentQuestion.value;
  if (!q) return "作答";
  if (q.qType === "cloze") return "填空题作答";
  if (q.qType === "translation") return "翻译题作答";
  return "简答题作答";
}

function getInputPlaceholder(): string {
  const q = currentQuestion.value;
  if (!q) return "写下你的回答…";
  if (q.qType === "cloze") return "填写空缺处的内容…";
  if (q.qType === "translation") return "输入翻译结果…";
  return "写下你的回答…";
}

function getAnswerLabel(): string {
  const q = currentQuestion.value;
  if (!q) return "参考答案";
  if (q.qType === "cloze") return "正确答案";
  if (q.qType === "translation") return "参考译文";
  return "参考答案";
}

function submitPicked() {
  if (pickedSingle.value === null) return;
  userAnswer.value = pickedSingle.value;
  void submitCurrent();
}

function toggleMulti(opt: string, oi?: number) {
  if (quizResult.value || submitting.value) return;
  pickedMulti.value = pickedMulti.value.includes(opt)
    ? pickedMulti.value.filter((o) => o !== opt)
    : [...pickedMulti.value, opt];
  if (oi !== undefined) optionFocusIdx.value = oi;
}

function isRightOption(opt: string): boolean {
  if (!quizResult.value || !currentQuestion.value) return false;
  return quizResult.value.isCorrect
    ? currentQuestion.value.answer.split(/[,，]/).map((s) => s.trim()).includes(opt)
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
    const result = await submitAnswer(q, userAnswer.value, elapsedQuestionSec());
    quizResult.value = result;
    answeredResults.value.push({ isCorrect: result.isCorrect, score: result.score, qType: q.qType, userAnswer: userAnswer.value, feedback: result.feedback });
  } catch (e) {
    if (e instanceof GradingFailedError) {
      // 简答题：作答已先落盘（graded=false），保留「重新判分」入口
      pendingGrading.value = e.recordId;
      quizError.value = "判分失败，作答已保存";
    } else {
      console.error("提交作答失败:", e);
      // 在刷题卡片内提示（genError 属于出题卡片，刷题时不可见）
      quizError.value = e instanceof Error ? e.message : String(e);
    }
  } finally {
    submitting.value = false;
  }
}

/** 简答判分失败后重试：只对已保存的作答重新判分并回填 */
async function regrade() {
  const q = currentQuestion.value;
  if (!q || pendingGrading.value === null) return;
  submitting.value = true;
  try {
    const result = await regradeAnswer(q, pendingGrading.value);
    quizResult.value = result;
    pendingGrading.value = null;
    quizError.value = "";
    answeredResults.value.push({ isCorrect: result.isCorrect, score: result.score, qType: q.qType, userAnswer: userAnswer.value, feedback: result.feedback });
  } catch (e) {
    console.error("重新判分失败:", e);
    quizError.value = e instanceof Error ? e.message : String(e);
  } finally {
    submitting.value = false;
  }
}

function nextQuestion() {
  if (quizIdx.value + 1 < quizList.value.length) {
    quizIdx.value++;
    resetQuestionState();
    startQuestionTimer();
  } else {
    const total = answeredResults.value.length;
    const correct = answeredResults.value.filter((r) => r.isCorrect).length;
    const essays = answeredResults.value.filter((r) => r.qType === "essay");
    const essayAvg = essays.length
      ? String(Math.round(essays.reduce((s, r) => s + Number(r.score || 0), 0) / essays.length))
      : "";
    quizSummary.value = { total, correct, essayCount: essays.length, essayAvg };
    // 测评入口（?set= / ?exam=1）且全部答完 → 自动勾掉计划里对应的 test 任务
    void finishTestTasks();
  }
}

/** 答完最后一题后勾测评任务；失败只提示，不影响刷题小结 */
async function finishTestTasks() {
  const ctx = currentTestContext.value;
  const courseId = currentCourseId();
  if (!ctx || courseId == null) return;
  try {
    testDoneTitles.value = await completeTestTasks(courseId, ctx);
  } catch (e) {
    console.error("测评任务自动勾选失败:", e);
    getBridge().showMessage(e instanceof Error ? e.message : "测评任务自动勾选失败", 4000, "error");
  }
}

function kpNames(q: Question): string[] {
  const map = new Map(knowledgePoints.value.map((k) => [k.id, k.name]));
  return parseQuestionKpIds(q)
    .map((id) => map.get(id))
    .filter((n): n is string => Boolean(n));
}

const { loading, error, load } = useLoad(async (ctx) => {
  if (!ctx.courseId) {
    knowledgePoints.value = [];
    questions.value = [];
    chapters.value = [];
    return;
  }
  const [kps, qs, chs] = await Promise.all([
    queryKnowledgePoints(ctx.courseId),
    queryQuestions(ctx.courseId),
    queryChapters(ctx.courseId),
  ]);
  if (ctx.isStale()) return;
  knowledgePoints.value = kps;
  questions.value = qs;
  chapters.value = chs;
});

async function generate() {
  if (!currentCourseId() || selectedKpIds.value.length === 0) return;
  generating.value = true;
  genError.value = "";
  genCreated.value = [];
  try {
    const created = await generateQuestions(currentCourseId(), {
      kpIds: selectedKpIds.value,
      count: genCount.value,
      qType: genQType.value,
      difficulty: genDifficulty.value,
    });
    genCreated.value = created;
    questions.value = [...created, ...questions.value];
  } catch (e) {
    genError.value = e instanceof Error ? e.message : String(e);
  } finally {
    generating.value = false;
  }
}

const editing = ref<Question | null>(null);

async function onQuestionSaved() {
  editing.value = null;
  // getData 返回存活对象引用，api 已改底层值；重新加载列表刷新渲染
  try {
    questions.value = await queryQuestions(currentCourseId());
  } catch (e) {
    console.error("刷新题库失败:", e);
  }
  getBridge().showMessage("题目已保存");
}

// ===== 批量操作 =====
const selectedIds = ref<Set<number>>(new Set());
const batchKpOpen = ref(false);

const selectedAll = computed(
  () => filteredQuestions.value.length > 0 && filteredQuestions.value.every((q) => selectedIds.value.has(q.id)),
);

function toggleSelect(id: number) {
  const next = new Set(selectedIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selectedIds.value = next;
}

function toggleSelectAll() {
  const filteredIds = new Set(filteredQuestions.value.map((q) => q.id));
  if (selectedAll.value) {
    selectedIds.value = new Set([...selectedIds.value].filter((id) => !filteredIds.has(id)));
  } else {
    selectedIds.value = new Set([...selectedIds.value, ...filteredIds]);
  }
}

async function batchDelete() {
  const ids = [...selectedIds.value];
  if (ids.length === 0) return;
  if (!(await confirm({ message: `确定删除选中的 ${ids.length} 道题？相关答题记录与错题将一并清理。`, danger: true, confirmText: "删除" }))) return;
  try {
    const removed = await deleteQuestions(ids);
    questions.value = questions.value.filter((q) => !new Set(ids).has(q.id));
    selectedIds.value = new Set();
    getBridge().showMessage(`已删除 ${removed} 道题`);
  } catch (e) {
    console.error("批量删除失败:", e);
    getBridge().showMessage(e instanceof Error ? e.message : "批量删除失败", 4000, "error");
  }
}

function exportMarkdown() {
  const list = filteredQuestions.value;
  if (list.length === 0) return;
  const md = exportQuestionsMarkdown(list, knowledgePoints.value, courseStore.currentCourse?.name ?? "题库");
  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  a.href = url;
  a.download = `题库-${courseStore.currentCourse?.name ?? "导出"}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.md`;
  a.click();
  URL.revokeObjectURL(url);
  getBridge().showMessage(`已导出 ${list.length} 题 Markdown`);
}

// ===== 真题导入 =====
const importOpen = ref(false);
const paperModalOpen = ref(false);

/** 真题试卷开刷：模拟考试语义，强制收口（全部答完再出解析） */
function beginPractice(questions: Question[]) {
  beginQuiz(shuffleList(questions), null, "afterAll");
}

async function onQuestionsImported(count: number) {
  importOpen.value = false;
  try {
    questions.value = await queryQuestions(currentCourseId());
    getBridge().showMessage(`已导入 ${count} 道真题，可用批量绑定补充知识点`);
  } catch (e) {
    console.error("刷新题库失败:", e);
  }
}

async function onBatchKpSaved(count: number) {
  try {
    questions.value = await queryQuestions(currentCourseId());
  } catch (e) {
    console.error("刷新题库失败:", e);
  }
  getBridge().showMessage(`已更新 ${count} 道题的知识点绑定`);
}

async function delQ(q: Question) {
  if (!(await confirm({ message: `确定删除题目「${q.title.slice(0, 20)}…」？`, danger: true, confirmText: "删除" }))) return;
  try {
    await deleteQuestion(q.id);
    questions.value = questions.value.filter((x) => x.id !== q.id);
  } catch (e) {
    console.error("删除题目失败:", e);
    getBridge().showMessage(e instanceof Error ? e.message : "删除题目失败", 4000, "error");
  }
}

watch(
  () => courseStore.currentCourseId,
  () => {
    // 切课程视为中断当前练习，避免继续答旧课程的题
    if (practicing.value) {
      endPractice();
      getBridge().showMessage("已切换课程，本次练习已结束");
    }
    genError.value = "";
    genCreated.value = [];
    selectedKpIds.value = [];
    filterType.value = "";
    selectedIds.value = new Set();
    selfTestKpId.value = null;
    void load();
  },
);

onMounted(async () => {
  await load();
  // 深链处理必须在数据加载成功后执行，否则题库为空会误清 query / 误起空练习
  if (error.value === "") {
    enterKpPractice();
    void enterPresetSet();
  }
  getSettings()
    .then((s) => {
      quizRevealDefault.value = s.quizRevealMode ?? "immediate";
    })
    .catch(() => {});
});

watch(
  () => route.query.kp,
  async (v) => {
    if (v == null || v === "") return;
    await load();
    if (error.value === "") enterKpPractice();
  },
);

watch(
  () => [route.query.set, route.query.exam] as const,
  async (v) => {
    if ((v[0] == null || v[0] === "") && (v[1] == null || v[1] === "")) return;
    await load();
    if (error.value === "") void enterPresetSet();
  },
);
</script>
