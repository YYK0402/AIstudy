<template>
  <div class="page">
    <div class="page-title"><h1>错题本</h1><div class="desc">答错自动归集 · 反复训练</div></div>

    <div v-if="!currentCourseId()" class="card">
      <div class="empty-state"><span class="ico"><AppIcon name="folder" :size="28" /></span> 请先在「课程主页」选择或创建一个课程</div>
    </div>

    <div v-else class="card">
      <h3>错题列表
        <span style="margin-left:auto;font-size:11px;color:var(--as-text-faint)">共 {{ wrongList.length }} 题（已掌握 {{ graduatedCount }} 题）</span>
        <button class="btn ghost sm" :disabled="filteredWrong.length === 0" @click="exportMarkdown" style="margin-left:12px">导出</button>
      </h3>
      <SkeletonList v-if="loading && wrongList.length === 0" :rows="5" />
      <LoadError v-else-if="error && wrongList.length === 0" :message="error" @retry="load" />
      <EmptyState
        v-else-if="wrongList.length === 0"
        compact
        icon="alert"
        text="暂无错题。&#10;刷题时答错的题目会自动归集到这里。"
      >
        <router-link class="btn sm primary" to="/quiz">去刷题</router-link>
      </EmptyState>
      <template v-else>
        <div class="w-filter">
          <div class="filter-chips">
            <button class="chip" :class="{ on: filterType === '' }" @click="filterType = ''">全部题型</button>
            <button
              v-for="(label, key) in QUESTION_TYPE_LABELS"
              :key="key"
              class="chip"
              :class="{ on: filterType === key }"
              @click="filterType = filterType === key ? '' : String(key)"
            >{{ label }}</button>
          </div>
          <div class="filter-chips">
            <button class="chip" :class="{ on: filterErr === '' }" @click="filterErr = ''">全部类型</button>
            <button class="chip" :class="{ on: filterErr === 'none' }" @click="filterErr = filterErr === 'none' ? '' : 'none'">未标记</button>
            <button
              v-for="(label, key) in WRONG_ERROR_TYPE_LABELS"
              :key="key"
              class="chip"
              :class="{ on: filterErr === key }"
              @click="filterErr = filterErr === key ? '' : String(key)"
            >{{ label }}</button>
          </div>
          <div class="w-filter-selects">
            <select v-model="filterKp" aria-label="按知识点筛选">
              <option value="">全部知识点</option>
              <option v-for="kp in knowledgePoints" :key="kp.id" :value="kp.id">{{ kp.name }}</option>
            </select>
            <select v-model="filterTimes" aria-label="按错误次数筛选">
              <option value="">全部次数</option>
              <option value="2">答错 ≥ 2 次</option>
              <option value="3">答错 ≥ 3 次</option>
            </select>
          </div>
        </div>
        <div v-if="filteredWrong.length === 0" class="s" style="padding:18px 0;text-align:center">当前筛选无错题</div>
        <div v-else class="q-list">
          <div v-for="w in pagedWrong" :key="w.wrong.id" class="q-fixed">
            <div class="top">
              <span class="tag" :class="w.question.qType"><span class="d"></span>{{ QUESTION_TYPE_LABELS[w.question.qType as QuestionType] }}</span>
              <span class="src-tag">{{ questionSourceLabel(w.question.source) }}</span>
              <span class="wrong-times">答错 {{ w.wrong.reviewTimes }} 次</span>
            </div>
            <div class="title">{{ w.question.title }}</div>
            <div class="foot">
              <span>{{ formatTime(w.wrong.createTime) }}</span>
              <span class="werr-chips">
                <button
                  v-for="(label, key) in WRONG_ERROR_TYPE_LABELS"
                  :key="key"
                  class="chip chip--sm"
                  :class="{ on: w.wrong.errorType === key }"
                  @click="toggleErr(w, key)"
                >{{ label }}</button>
              </span>
              <span style="margin-left:auto"></span>
              <button class="btn sm ghost" @click="del(w)">移出</button>
            </div>
          </div>
        </div>
        <div v-if="wrongTotalPages > 1" class="pagination">
          <button class="btn sm ghost" :disabled="wrongPage === 1" @click="wrongPage--">‹ 上一页</button>
          <span class="pg-info">{{ wrongPage }} / {{ wrongTotalPages }}</span>
          <button class="btn sm ghost" :disabled="wrongPage === wrongTotalPages" @click="wrongPage++">下一页 ›</button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: "WrongView" });
import AppIcon from "../components/AppIcon.vue";
import { computed, onMounted, ref, watch } from "vue";
import EmptyState from "../components/EmptyState.vue";
import SkeletonList from "../components/SkeletonList.vue";
import LoadError from "../components/LoadError.vue";
import { useLoad } from "../composables/useLoad";
import { useCourseStore } from "../stores/course";
import {
  queryWrongQuestions,
  countGraduatedWrongQuestions,
  deleteWrongQuestion,
  markWrongErrorType,
  queryKnowledgePoints,
  parseQuestionKpIds,
  exportWrongQuestionsMarkdown,
  questionSourceLabel,
  QUESTION_TYPE_LABELS,
  WRONG_ERROR_TYPE_LABELS,
} from "../api";
import type { WrongQuestion, Question, QuestionType, KnowledgePoint, WrongErrorType } from "../api";
import { getBridge } from "@/bridge";

const courseStore = useCourseStore();
const currentCourseId = () => courseStore.currentCourseId;

const wrongList = ref<Array<{ wrong: WrongQuestion; question: Question }>>([]);
const knowledgePoints = ref<KnowledgePoint[]>([]);
/** 已毕业（已掌握）错题计数，列表默认隐藏这些条目 */
const graduatedCount = ref(0);

const filterType = ref("");
const filterErr = ref("");
const filterKp = ref("");
const filterTimes = ref("");

const filteredWrong = computed(() =>
  wrongList.value.filter(({ wrong, question }) => {
    if (filterType.value && question.qType !== filterType.value) return false;
    if (filterErr.value === "none" && wrong.errorType) return false;
    if (filterErr.value && filterErr.value !== "none" && wrong.errorType !== filterErr.value) return false;
    if (filterKp.value && !parseQuestionKpIds(question).includes(Number(filterKp.value))) return false;
    if (filterTimes.value && wrong.reviewTimes < Number(filterTimes.value)) return false;
    return true;
  }),
);

// 错题列表分页（50/页）
const WRONG_PAGE_SIZE = 50;
const wrongPage = ref(1);
const wrongTotalPages = computed(() => Math.max(1, Math.ceil(filteredWrong.value.length / WRONG_PAGE_SIZE)));
const pagedWrong = computed(() =>
  filteredWrong.value.slice((wrongPage.value - 1) * WRONG_PAGE_SIZE, wrongPage.value * WRONG_PAGE_SIZE),
);
// 筛选变化回第一页；移出导致当前页空时回落
watch([filterType, filterErr, filterKp, filterTimes], () => {
  wrongPage.value = 1;
});
watch(wrongPage, (p) => {
  if (p > wrongTotalPages.value) wrongPage.value = 1;
});

const { loading, error, load } = useLoad(async (ctx) => {
  if (!ctx.courseId) {
    wrongList.value = [];
    knowledgePoints.value = [];
    graduatedCount.value = 0;
    return;
  }
  const [list, kps, graduated] = await Promise.all([
    queryWrongQuestions(ctx.courseId),
    queryKnowledgePoints(ctx.courseId),
    countGraduatedWrongQuestions(ctx.courseId),
  ]);
  if (ctx.isStale()) return;
  wrongList.value = list;
  knowledgePoints.value = kps;
  graduatedCount.value = graduated;
});

async function del(w: { wrong: WrongQuestion }) {
  try {
    await deleteWrongQuestion(w.wrong.id);
    wrongList.value = wrongList.value.filter((x) => x.wrong.id !== w.wrong.id);
    if (currentCourseId()) graduatedCount.value = await countGraduatedWrongQuestions(currentCourseId());
  } catch (e) {
    console.error("移出错题失败:", e);
    getBridge().showMessage(e instanceof Error ? e.message : "移出错题失败", 4000, "error");
  }
}

async function toggleErr(w: { wrong: WrongQuestion; question: Question }, type: WrongErrorType) {
  const next = w.wrong.errorType === type ? null : type;
  try {
    await markWrongErrorType(w.wrong.id, next);
    // getData 返回存活对象引用，api 已改底层值；重新加载列表刷新渲染
    wrongList.value = await queryWrongQuestions(currentCourseId());
    if (currentCourseId()) graduatedCount.value = await countGraduatedWrongQuestions(currentCourseId());
  } catch (e) {
    console.error("标记错误类型失败:", e);
    getBridge().showMessage(e instanceof Error ? e.message : "标记失败", 4000, "error");
  }
}

async function exportMarkdown() {
  const list = filteredWrong.value;
  if (list.length === 0) return;
  try {
    const md = await exportWrongQuestionsMarkdown(list, knowledgePoints.value, courseStore.currentCourse?.name ?? "错题");
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    a.href = url;
    a.download = `错题-${courseStore.currentCourse?.name ?? "导出"}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.md`;
    a.click();
    URL.revokeObjectURL(url);
    getBridge().showMessage(`已导出 ${list.length} 道错题`);
  } catch (e) {
    console.error("导出错题失败:", e);
    getBridge().showMessage(e instanceof Error ? e.message : "导出错题失败", 4000, "error");
  }
}

function formatTime(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

watch(
  () => courseStore.currentCourseId,
  () => {
    filterType.value = "";
    filterErr.value = "";
    filterKp.value = "";
    filterTimes.value = "";
    void load();
  },
);

onMounted(() => void load());
</script>
