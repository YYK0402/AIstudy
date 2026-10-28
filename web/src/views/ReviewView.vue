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
          <span class="kp-chip mini on">{{ targetKp.name }}</span>
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
      <h3>今日待复习
        <span style="margin-left:auto;font-size:11px;color:var(--as-text-faint)">
          {{ dueList.length }} 项
        </span>
      </h3>
        <SkeletonList v-if="loading && dueList.length === 0" :rows="4" />
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
        <div v-for="item in dueList" :key="item.schedule.id" class="review-item">
          <!-- 知识点触点 -->
          <template v-if="item.knowledgePoint">
            <div class="ri-head">
              <span class="kp-chip mini on">{{ item.knowledgePoint.name }}</span>
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

          <!-- 题目触点 -->
          <template v-else-if="item.question">
            <div class="ri-head">
              <span class="tag" :class="item.question.qType"><span class="d"></span>{{ QUESTION_TYPE_LABELS[item.question.qType as QuestionType] }}</span>
              <span class="ri-meta">第 {{ item.schedule.stage }} 阶 · 间隔 {{ item.schedule.intervalDays }} 天 · 累计 {{ item.schedule.reviewTimes }} 次</span>
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
              <span class="kp-chip mini on">闪卡</span>
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
  </div>
</template>

<script setup lang="ts">
import AppIcon from "../components/AppIcon.vue";
import { onMounted, reactive, ref, watch } from "vue";
import SkeletonList from "../components/SkeletonList.vue";
import LoadError from "../components/LoadError.vue";
import { useLoad } from "../composables/useLoad";
import EmptyState from "../components/EmptyState.vue";
import { useRoute, useRouter } from "vue-router";
import { useCourseStore } from "../stores/course";
import { queryDueReviews, queryKnowledgePoints, submitReview, submitKpReview, submitAnswer, QUESTION_TYPE_LABELS } from "../api";
import type { ReviewDueItem, QuestionType, KnowledgePoint } from "../api";
import { capStudySec } from "../constants/study";

const courseStore = useCourseStore();
const currentCourseId = () => courseStore.currentCourseId;
const route = useRoute();
const router = useRouter();

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
    window.siyuanAiStudy.showMessage(g === "solid" ? "复习完成，间隔已推后（当天复习任务若有则已勾掉）" : "复习完成，已按记忆强度重排间隔");
    router.replace({ path: "/review" });
  } catch (e) {
    console.error("定向复习评分失败:", e);
    window.siyuanAiStudy.showMessage(e instanceof Error ? e.message : "定向复习评分失败", 4000, "error");
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

const { loading, error, load } = useLoad(async (ctx) => {
  if (!ctx.courseId) {
    dueList.value = [];
    return;
  }
  const due = await queryDueReviews(ctx.courseId);
  if (ctx.isStale()) return;
  dueList.value = due;
});

async function grade(item: ReviewDueItem, g: "forgotten" | "vague" | "solid") {
  const id = item.schedule.id;
  if (busy[id]) return;
  busy[id] = true;
  try {
    // 题目触点若填了简答也可提交作答记录（不阻塞评分）；fromReview=true 避免与下方牢固评分重复计连对
    const answer = essayAnswers[id];
    if (item.question && item.question.qType === "essay" && answer && answer.trim()) {
      try {
        await submitAnswer(item.question, answer.trim(), 0, { fromReview: true });
      } catch (e) {
        console.error("复习中提交作答失败:", e);
        window.siyuanAiStudy.showMessage(e instanceof Error ? e.message : "作答提交失败", 4000, "error");
      }
    }
    const startAt = itemStartAt[id];
    const durationSec = startAt ? capStudySec((Date.now() - startAt) / 1000) : 0;
    await submitReview(item.schedule, g, durationSec);
    dueList.value = dueList.value.filter((x) => x.schedule.id !== id);
    delete revealed[id];
    delete busy[id];
    delete essayAnswers[id];
    delete itemStartAt[id];
  } catch (e) {
    console.error("提交复习评分失败:", e);
    window.siyuanAiStudy.showMessage(e instanceof Error ? e.message : "提交复习评分失败", 4000, "error");
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
