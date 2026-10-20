<template>
  <div class="page">
    <div class="page-title"><h1>复习计划</h1><div class="desc">间隔重复 · 到期自动浮现 · 记忆保鲜</div></div>

    <div v-if="!currentCourseId" class="card">
      <div class="empty-state"><span class="ico">📭</span> 请先在「课程主页」选择或创建一个课程</div>
    </div>

    <div v-else class="card">
      <h3>今日待复习
        <span style="margin-left:auto;font-size:11px;color:var(--as-text-faint)">
          {{ dueList.length }} 项
        </span>
      </h3>
      <div v-if="dueList.length === 0" class="empty-state" style="padding:24px 0">
        <span class="ico">☀️</span> 今日无到期复习项<br />答错的题目和讲解达标的知识点会自动进入复习计划
      </div>
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
              <button class="btn primary sm" @click="revealed[item.schedule.id] = false">揭示</button>
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
              <button class="btn primary sm" @click="revealed[item.schedule.id] = false">揭示</button>
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
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref, watch } from "vue";
import { useCourseStore } from "../stores/course";
import { queryDueReviews, submitReview, submitAnswer, QUESTION_TYPE_LABELS } from "../api";
import type { ReviewDueItem, QuestionType } from "../api";

const courseStore = useCourseStore();
const currentCourseId = () => courseStore.currentCourseId;

const dueList = ref<ReviewDueItem[]>([]);
/** 展开/揭示状态：未展开 undefined；false=揭示；true=已作答或已评分（本实现评分后同步移除） */
const revealed = reactive<Record<number, boolean | undefined>>({});
const busy = reactive<Record<number, boolean | undefined>>({});
const essayAnswers = reactive<Record<number, string | undefined>>({});

async function load() {
  if (!currentCourseId()) {
    dueList.value = [];
    return;
  }
  dueList.value = await queryDueReviews(currentCourseId());
}

async function grade(item: ReviewDueItem, g: "forgotten" | "vague" | "solid") {
  const id = item.schedule.id;
  if (busy[id]) return;
  busy[id] = true;
  try {
    // 题目触点若填了简答也可提交作答记录（不阻塞评分）
    const answer = essayAnswers[id];
    if (item.question && item.question.qType === "essay" && answer && answer.trim()) {
      try {
        await submitAnswer(item.question, answer.trim());
      } catch (e) {
        console.error("复习中提交作答失败:", e);
      }
    }
    await submitReview(item.schedule, g);
    dueList.value = dueList.value.filter((x) => x.schedule.id !== id);
    delete revealed[id];
    delete busy[id];
    delete essayAnswers[id];
  } catch (e) {
    console.error("提交复习评分失败:", e);
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
    load();
  },
);

onMounted(load);
</script>
