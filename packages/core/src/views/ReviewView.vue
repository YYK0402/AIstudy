<template>
  <div class="page">
    <div class="page-title"><h1>复习计划</h1><div class="desc">间隔重复 · 到期自动浮现 · 记忆保鲜</div></div>

    <div v-if="!currentCourseId()" class="card">
      <div class="empty-state"><span class="ico"><AppIcon name="folder" :size="28" /></span> 请先在「课程主页」选择或创建一个课程</div>
    </div>

    <!-- 定向复习：?kp= 进入，单知识点 回想→揭示→自评，评「牢固」自动勾掉计划对应复习任务 -->
    <div v-if="targetKp" class="card" style="margin-bottom:14px">
      <h3>
        定向复习
        <router-link class="link-btn" to="/review" style="margin-left:auto">返回列表</router-link>
      </h3>
      <div class="review-item">
        <div class="ri-head">
          <span class="chip chip--solid chip--sm on">{{ targetKp.name }}</span>
          <span v-if="targetKp.chapterName" class="ri-meta">{{ targetKp.chapterName }}</span>
        </div>
        <template v-if="!targetRevealed">
          <div class="recall-mask">先凭记忆回想这个知识点：它是什么？要点有哪些？</div>
          <button class="btn primary sm" @click="revealTarget">揭示</button>
        </template>
        <template v-else>
          <div v-if="targetKp.content" class="review-body">{{ targetKp.content }}</div>
          <div v-else class="recall-mask">（该知识点暂无参考描述，凭印象自评）</div>
          <div class="grade-row">
            <span class="grade-label">这次回想记得有多牢？</span>
            <button class="btn sm ghost rg bad" :disabled="targetBusy" @click="gradeTarget('forgotten')">忘了</button>
            <button class="btn sm ghost rg mid" :disabled="targetBusy" @click="gradeTarget('vague')">模糊</button>
            <button class="btn sm ghost rg good" :disabled="targetBusy" @click="gradeTarget('solid')">牢固</button>
          </div>
        </template>
      </div>
    </div>

    <div v-else-if="!targetKp && currentCourseId()" class="card">
      <h3>
        今日待复习
        <span style="margin-left:auto;display:flex;align-items:center;gap:8px">
          <span v-if="!reviewSuspended" style="font-size:11px;color:var(--as-text-faint)">{{ dueList.length }} 项</span>
          <button v-if="!archived" class="btn sm ghost" :disabled="reviewPausing" @click="toggleReviewPause">
            {{ courseStore.currentCourse?.reviewPaused ? "▶ 恢复复习" : "⏸ 暂停复习" }}
          </button>
        </span>
      </h3>

      <!-- 课程复习暂停：触点整体挂起，不列清单（SM-2 排期不动，恢复后自动恢复） -->
      <EmptyState
        v-if="reviewSuspended"
        compact
        icon="moon"
        :text="`课程复习已暂停，${suspendedCount} 个复习触点已挂起。&#10;间隔重复排期不变，恢复复习后自动浮现。`"
      >
        <button class="btn sm primary" :disabled="reviewPausing" @click="toggleReviewPause">恢复复习</button>
      </EmptyState>
      <SkeletonList v-else-if="loading && dueList.length === 0" :rows="4" />
      <LoadError v-else-if="error && dueList.length === 0" :message="error" @retry="load" />
      <EmptyState
        v-else-if="dueList.length === 0"
        compact
        icon="clock"
        text="今日无到期复习项。&#10;答错的题目、讲解达标的知识点和闪卡会自动进入复习计划。"
      >
        <router-link class="btn sm primary" to="/study">去学习</router-link>
      </EmptyState>
      <template v-else>
        <!-- 进度 + 类型构成 -->
        <div class="review-summary">
          <ProgressBar :value="doneCount" :max="initialCount" tone="green" sm />
          <span class="rs-text">{{ doneCount }}/{{ initialCount }} 完成</span>
          <span class="rs-chips">
            <span v-if="countQ > 0" class="chip chip--sm">错题 {{ countQ }}</span>
            <span v-if="countKp > 0" class="chip chip--sm">知识点 {{ countKp }}</span>
            <span v-if="countCard > 0" class="chip chip--sm">闪卡 {{ countCard }}</span>
          </span>
        </div>

        <!-- 按类型分组：错题 → 知识点 → 闪卡（0 项组隐藏，可折叠） -->
        <div v-for="g in reviewGroups" :key="g.key" class="review-group">
          <div class="rg-head" @click="toggleGroup(g.key)">
            <span class="rg-name">{{ g.label }}</span>
            <span class="rg-count">{{ g.items.length }}</span>
            <span class="rg-tgl">{{ collapsedGroups[g.key] ? "展开" : "收起" }}</span>
          </div>
          <template v-if="!collapsedGroups[g.key]">
            <div v-for="item in g.items" :key="item.schedule.id" class="review-item">
              <!-- 知识点触点 -->
              <template v-if="item.knowledgePoint">
                <div class="ri-head">
                  <span class="chip chip--solid chip--sm on">{{ item.knowledgePoint.name }}</span>
                  <span class="ri-meta">第 {{ item.schedule.stage }} 阶 · 间隔 {{ item.schedule.intervalDays }} 天 · 累计 {{ item.schedule.reviewTimes }} 次</span>
                </div>
                <template v-if="revealed[item.schedule.id] === undefined">
                  <div class="recall-mask">先凭记忆回想这个知识点：它是什么？要点有哪些？</div>
                  <button class="btn primary sm" @click="reveal(item.schedule.id)">揭示</button>
                </template>
                <template v-else>
                  <div v-if="item.knowledgePoint.content" class="review-body">{{ item.knowledgePoint.content }}</div>
                  <div v-else class="recall-mask">（该知识点暂无参考描述，凭印象自评）</div>
                  <div class="grade-row">
                    <span class="grade-label">这次回想记得有多牢？</span>
                    <button class="btn sm ghost rg bad" :disabled="busy[item.schedule.id]" @click="grade(item, 'forgotten')">忘了</button>
                    <button class="btn sm ghost rg mid" :disabled="busy[item.schedule.id]" @click="grade(item, 'vague')">模糊</button>
                    <button class="btn sm ghost rg good" :disabled="busy[item.schedule.id]" @click="grade(item, 'solid')">牢固</button>
                  </div>
                </template>
              </template>

              <!-- 题目触点（错题复习：关联错题本 meta） -->
              <template v-else-if="item.question">
                <div class="ri-head">
                  <span class="tag" :class="item.question.qType"><span class="d"></span>{{ QUESTION_TYPE_LABELS[item.question.qType as QuestionType] }}</span>
                  <span class="ri-meta">第 {{ item.schedule.stage }} 阶 · 间隔 {{ item.schedule.intervalDays }} 天 · 累计 {{ item.schedule.reviewTimes }} 次</span>
                </div>
                <div v-if="wrongOf(item)" class="ri-wrong">
                  错题本 · 第 {{ wrongOf(item)!.reviewTimes }} 次入本 · 连对 {{ wrongOf(item)!.correctStreak ?? 0 }}
                  <span v-if="wrongOf(item)!.errorType" class="tag err-type">{{ errorTypeLabel(wrongOf(item)!.errorType!) }}</span>
                </div>
                <template v-if="revealed[item.schedule.id] === undefined">
                  <div class="review-body q-title-mini">{{ item.question.title }}</div>
                  <button class="btn primary sm" @click="reveal(item.schedule.id)">揭示</button>
                </template>
                <template v-else>
                  <div v-if="item.question.qType !== 'essay'" class="review-body reveal-answer">
                    参考答案：{{ item.question.answer }}
                    <div v-if="item.question.analysis" class="review-analysis">{{ item.question.analysis }}</div>
                  </div>
                  <div v-else>
                    <div class="review-body reveal-answer">参考答案：{{ item.question.answer }}</div>
                    <textarea
                      class="essay-input"
                      rows="4"
                      v-model="essayAnswers[item.schedule.id]"
                      placeholder="仍想写一遍？写下你的回答让 AI 阅卷（可跳过）"
                    />
                  </div>
                    <div class="grade-row">
                    <span class="grade-label">按你的掌握情况自评：</span>
                    <button class="btn sm ghost rg bad" :disabled="busy[item.schedule.id]" @click="grade(item, 'forgotten')">忘了</button>
                    <button class="btn sm ghost rg mid" :disabled="busy[item.schedule.id]" @click="grade(item, 'vague')">模糊</button>
                    <button class="btn sm ghost rg good" :disabled="busy[item.schedule.id]" @click="grade(item, 'solid')">牢固</button>
                  </div>
                </template>
              </template>

              <!-- 闪卡触点（T3.4）：看问题回想 → 揭示答案要点 → 自评 -->
              <template v-else-if="item.flashcard">
                <div class="ri-head">
                  <span class="chip chip--solid chip--sm on">闪卡</span>
                  <span class="ri-meta">第 {{ item.schedule.stage }} 阶 · 间隔 {{ item.schedule.intervalDays }} 天 · 累计 {{ item.schedule.reviewTimes }} 次</span>
                </div>
                <template v-if="revealed[item.schedule.id] === undefined">
                  <div class="review-body q-title-mini">{{ item.flashcard.front }}</div>
                  <div class="recall-mask" style="margin-top:8px">先凭记忆回想这张卡的答案要点</div>
                  <button class="btn primary sm" @click="reveal(item.schedule.id)">揭示答案</button>
                </template>
                <template v-else>
                  <div class="review-body reveal-answer">答案要点：{{ item.flashcard.back }}</div>
                  <div class="grade-row">
                    <span class="grade-label">这次回想记得有多牢？</span>
                    <button class="btn sm ghost rg bad" :disabled="busy[item.schedule.id]" @click="grade(item, 'forgotten')">忘了</button>
                    <button class="btn sm ghost rg mid" :disabled="busy[item.schedule.id]" @click="grade(item, 'vague')">模糊</button>
                    <button class="btn sm ghost rg good" :disabled="busy[item.schedule.id]" @click="grade(item, 'solid')">牢固</button>
                  </div>
                </template>
              </template>
            </div>
          </template>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import AppIcon from "../components/AppIcon.vue";
import { computed, onMounted, reactive, ref, watch } from "vue";
import SkeletonList from "../components/SkeletonList.vue";
import LoadError from "../components/LoadError.vue";
import EmptyState from "../components/EmptyState.vue";
import ProgressBar from "../components/ProgressBar.vue";
import { useLoad } from "../composables/useLoad";
import { useRoute, useRouter } from "vue-router";
import { useCourseStore } from "../stores/course";
import { useConfirm } from "../composables/useConfirm";
import {
  queryDueReviews,
  queryStudyPlans,
  queryKnowledgePoints,
  queryWrongQuestions,
  submitReview,
  submitKpReview,
  submitAnswer,
  setPlanStatus,
  setCourseReviewPaused,
  QUESTION_TYPE_LABELS,
} from "../api";
import type { ReviewDueItem, QuestionType, KnowledgePoint, WrongQuestion } from "../api";
import { capStudySec } from "../constants/study";
import { getBridge } from "@/bridge";

const courseStore = useCourseStore();
const currentCourseId = () => courseStore.currentCourseId;
const archived = computed(() => courseStore.currentCourse?.status === "archived");
const route = useRoute();
const router = useRouter();
const { confirmWithChoice } = useConfirm();

// ===== 定向复习（?kp= 由计划「去复习」进入） =====
const targetKp = ref<KnowledgePoint | null>(null);
const targetRevealed = ref(false);
const targetBusy = ref(false);
const targetStartAt = ref(0);

async function loadTarget() {
  const q = Number(route.query.kp);
  targetRevealed.value = false;
  targetStartAt.value = 0;
  if (!Number.isInteger(q) || q <= 0 || !currentCourseId()) {
    targetKp.value = null;
    return;
  }
  const kps = await queryKnowledgePoints(currentCourseId());
  targetKp.value = kps.find((k) => k.id === q) ?? null;
}

function revealTarget() {
  targetStartAt.value = Date.now();
  targetRevealed.value = true;
}

async function gradeTarget(g: "forgotten" | "vague" | "solid") {
  if (!targetKp.value || targetBusy.value) return;
  targetBusy.value = true;
  try {
    const durationSec = targetStartAt.value ? capStudySec((Date.now() - targetStartAt.value) / 1000) : 0;
    await submitKpReview(targetKp.value.id, g, durationSec);
    getBridge().showMessage(g === "solid" ? "复习完成，间隔已推后（当天复习任务若有则已勾掉）" : "复习完成，已按记忆强度重排间隔");
    router.replace({ path: "/review" });
  } catch (e) {
    console.error("定向复习评分失败:", e);
    getBridge().showMessage(e instanceof Error ? e.message : "定向复习评分失败", 4000, "error");
  } finally {
    targetBusy.value = false;
  }
}

const dueList = ref<ReviewDueItem[]>([]);
/** 展开/揭示状态：未展开 undefined；false=揭示；true=已作答或已评分（本实现评分后同步移除） */
const revealed = reactive<Record<number, boolean | undefined>>({});
const busy = reactive<Record<number, boolean | undefined>>({});
const essayAnswers = reactive<Record<number, string | undefined>>({});
/** 揭示时刻（毫秒）：评分时算实际耗时，写入学习时长日志 */
const itemStartAt = reactive<Record<number, number>>({});

function reveal(id: number) {
  itemStartAt[id] = Date.now();
  revealed[id] = false;
}

const reviewSuspended = ref(false);
const suspendedCount = ref(0);
const reviewPausing = ref(false);

// ===== 进度与构成 =====
/** 进入时到期项快照（进度分母；本会话内评分只减不增，保持口径稳定） */
const initialCount = ref(0);
const doneCount = ref(0);
/** 错题本关联：qId → 在管记录（复习项展示入本次数/连对/错误类型） */
const wrongMap = reactive<Map<number, WrongQuestion>>(new Map());

const countQ = computed(() => dueList.value.filter((i) => i.question).length);
const countKp = computed(() => dueList.value.filter((i) => i.knowledgePoint).length);
const countCard = computed(() => dueList.value.filter((i) => i.flashcard).length);

/** 分组：错题 → 知识点 → 闪卡（0 项组不渲染） */
const reviewGroups = computed(() => [
  { key: "q", label: "错题复习", items: dueList.value.filter((i) => i.question) },
  { key: "kp", label: "知识点复习", items: dueList.value.filter((i) => i.knowledgePoint) },
  { key: "card", label: "闪卡复习", items: dueList.value.filter((i) => i.flashcard) },
].filter((g) => g.items.length > 0));

const collapsedGroups = reactive<Record<string, boolean>>({});

function toggleGroup(key: string) {
  collapsedGroups[key] = !collapsedGroups[key];
}

function wrongOf(item: ReviewDueItem): WrongQuestion | null {
  return item.question ? wrongMap.get(item.question.id) ?? null : null;
}

const ERROR_TYPE_LABELS: Record<string, string> = { concept: "概念不清", memory: "记忆遗漏", careless: "粗心" };
function errorTypeLabel(t: string): string {
  return ERROR_TYPE_LABELS[t] ?? t;
}

const { loading, error, load } = useLoad(async (ctx) => {
  if (!ctx.courseId) {
    dueList.value = [];
    return;
  }
  const [due, wrongs] = await Promise.all([queryDueReviews(ctx.courseId), queryWrongQuestions(ctx.courseId)]);
  if (ctx.isStale()) return;
  reviewSuspended.value = courseStore.currentCourse?.reviewPaused === true;
  suspendedCount.value = reviewSuspended.value ? due.length : 0;
  dueList.value = reviewSuspended.value ? [] : due;
  initialCount.value = due.length;
  doneCount.value = 0;
  wrongMap.clear();
  for (const { wrong } of wrongs) wrongMap.set(wrong.qId, wrong);
});

/** 课程级复习暂停/恢复（与学习计划解耦）；对方存在可联动状态时弹窗提醒（可取消勾选） */
async function toggleReviewPause() {
  const course = courseStore.currentCourse;
  if (!course || reviewPausing.value) return;
  reviewPausing.value = true;
  try {
    const plans = await queryStudyPlans(course.id);
    if (!course.reviewPaused) {
      const activePlans = plans.filter((p) => (p.status ?? "active") !== "paused");
      let withPlans = false;
      if (activePlans.length > 0) {
        const r = await confirmWithChoice({
          title: "暂停复习",
          message: "暂停后到期复习项不再浮现（首页/徽标同步归零）。间隔重复排期不变，恢复复习后自动浮现。",
          checkbox: { label: `同时暂停该课程的学习计划（${activePlans.length} 个进行中）`, defaultChecked: true },
          confirmText: "确认暂停",
        });
        if (!r.ok) return;
        withPlans = r.checked;
      }
      await setCourseReviewPaused(course.id, true);
      if (withPlans) {
        for (const p of activePlans) await setPlanStatus(p.id, "paused");
      }
      await courseStore.refresh();
      getBridge().showMessage(withPlans ? "已暂停复习，学习计划已同步暂停" : "已暂停复习，到期复习项不再浮现");
    } else {
      const pausedPlans = plans.filter((p) => p.status === "paused");
      let withPlans = false;
      if (pausedPlans.length > 0) {
        const r = await confirmWithChoice({
          title: "恢复复习",
          message: "恢复后到期复习项重新浮现。",
          checkbox: { label: `同时恢复该课程已暂停的学习计划（${pausedPlans.length} 个，未完成任务顺延）`, defaultChecked: true },
          confirmText: "确认恢复",
        });
        if (!r.ok) return;
        withPlans = r.checked;
      }
      await setCourseReviewPaused(course.id, false);
      if (withPlans) {
        for (const p of pausedPlans) await setPlanStatus(p.id, "active");
      }
      await courseStore.refresh();
      getBridge().showMessage(withPlans ? "已恢复复习，学习计划已同步恢复" : "已恢复复习");
    }
    await load();
  } catch (e) {
    console.error("更新复习暂停状态失败:", e);
    getBridge().showMessage(e instanceof Error ? e.message : "更新复习暂停状态失败", 4000, "error");
  } finally {
    reviewPausing.value = false;
  }
}

async function grade(item: ReviewDueItem, g: "forgotten" | "vague" | "solid") {
  const id = item.schedule.id;
  if (busy[id]) return;
  busy[id] = true;
  try {
    // 题目触点若填了简答也可提交作答记录（不阻塞评分）；fromReview=true 避免与下方牢固评分重复计连对
    // 该重答入口只在「揭示」答案之后出现（textarea 在 revealed 分支内），按受助口径标记
    const answer = essayAnswers[id];
    if (item.question && item.question.qType === "essay" && answer && answer.trim()) {
      try {
        await submitAnswer(item.question, answer.trim(), 0, { fromReview: true, assisted: true });
      } catch (e) {
        console.error("复习中提交作答失败:", e);
        getBridge().showMessage(e instanceof Error ? e.message : "作答提交失败", 4000, "error");
      }
    }
    const startAt = itemStartAt[id];
    const durationSec = startAt ? capStudySec((Date.now() - startAt) / 1000) : 0;
    await submitReview(item.schedule, g, durationSec);
    dueList.value = dueList.value.filter((x) => x.schedule.id !== id);
    doneCount.value += 1;
    delete revealed[id];
    delete busy[id];
    delete essayAnswers[id];
    delete itemStartAt[id];
  } catch (e) {
    console.error("提交复习评分失败:", e);
    getBridge().showMessage(e instanceof Error ? e.message : "提交复习评分失败", 4000, "error");
  } finally {
    busy[id] = false;
  }
}

watch(
  () => courseStore.currentCourseId,
  () => {
    for (const k of Object.keys(revealed)) delete revealed[Number(k)];
    for (const k of Object.keys(busy)) delete busy[Number(k)];
    for (const k of Object.keys(essayAnswers)) delete essayAnswers[Number(k)];
    for (const k of Object.keys(itemStartAt)) delete itemStartAt[Number(k)];
    for (const k of Object.keys(collapsedGroups)) delete collapsedGroups[k];
    void load();
    loadTarget();
  },
);

watch(() => route.query.kp, () => loadTarget());

onMounted(() => {
  void load();
  loadTarget();
});
</script>
