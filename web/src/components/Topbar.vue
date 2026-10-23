<template>
  <div class="topbar">
    <div class="crumbs">研习 <span class="sep">/</span> <span class="cur">{{ title }}</span></div>
    <div class="spacer"></div>
    <div v-if="currentCourseId" class="topbar-today">
      <span class="dot"></span> 今日 <b>{{ todayTaskCount }}</b> 项任务 · <b>{{ dueReviewCount }}</b> 待复习 · <b>{{ wrongCount }}</b> 道错题
    </div>
    <button class="theme-toggle" title="切换明暗主题" @click="theme.toggle()">
      <svg class="ic-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="4.5" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
      <svg class="ic-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />
      </svg>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useThemeStore } from "../stores/theme";
import { useCourseStore } from "../stores/course";
import {
  queryStudyPlans,
  queryStudyTasks,
  queryDueReviews,
  queryWrongQuestions,
  formatLocalDate,
  DATA_SAVED_EVENT,
} from "../api";

const route = useRoute();
const theme = useThemeStore();
const courseStore = useCourseStore();

const currentCourseId = computed(() => courseStore.currentCourseId);

const todayTaskCount = ref(0);
const dueReviewCount = ref(0);
const wrongCount = ref(0);

const titleMap: Record<string, string> = {
  home: "学习首页",
  course: "课程主页",
  content: "课程内容",
  plan: "学习计划",
  study: "开始学习",
  quiz: "刷题练习",
  wrong: "错题本",
  review: "复习计划",
  graph: "知识图谱",
  report: "学习报告",
  settings: "模型配置",
};

const title = computed(() => titleMap[(route.name as string) ?? ""] ?? "学习首页");

/** 当前课程的今日待完成任务 / 到期复习 / 错题数量（未选课程时隐藏） */
async function loadStats() {
  const id = courseStore.currentCourseId;
  if (!id) {
    todayTaskCount.value = 0;
    dueReviewCount.value = 0;
    wrongCount.value = 0;
    return;
  }
  try {
    const today = formatLocalDate();
    const [plans, due, wrong] = await Promise.all([
      queryStudyPlans(id),
      queryDueReviews(id),
      queryWrongQuestions(id),
    ]);
    let tasks = 0;
    for (const p of plans) {
      if (p.status === "paused") continue;
      const ts = await queryStudyTasks(p.id);
      tasks += ts.filter((t) => t.scheduledDate === today && t.status !== "done").length;
    }
    todayTaskCount.value = tasks;
    dueReviewCount.value = due.length;
    wrongCount.value = wrong.length;
  } catch (e) {
    console.error("加载顶栏统计失败:", e);
  }
}

function onCourseChange() {
  loadStats();
}
function onDataSaved() {
  loadStats();
}

onMounted(() => {
  loadStats();
  window.addEventListener(DATA_SAVED_EVENT, onDataSaved);
});
onBeforeUnmount(() => {
  window.removeEventListener(DATA_SAVED_EVENT, onDataSaved);
});
watch(() => courseStore.currentCourseId, onCourseChange);
</script>
