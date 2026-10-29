<template>
  <div class="topbar">
    <div class="crumbs">研习 <span class="sep">/</span> <span class="cur">{{ title }}</span></div>
    <div class="spacer"></div>
    <div v-if="currentCourseId" class="topbar-today">
      <span class="dot"></span>
      <router-link class="metric" to="/">今日 <b>{{ todayTaskCount }}</b> 项任务</router-link>
      <span class="sep">·</span>
      <router-link class="metric" to="/review"><b>{{ dueReviewCount }}</b> 待复习</router-link>
      <span class="sep">·</span>
      <router-link class="metric" to="/wrong"><b>{{ wrongCount }}</b> 道错题</router-link>
    </div>
    <div class="notify-wrap" v-if="notifyStore.tasks.length > 0">
      <button class="theme-toggle notify-bell" title="任务通知" @click="togglePanel">
        <AppIcon name="bell" :size="17" />
        <span v-if="notifyStore.unreadCount > 0" class="notify-badge">{{ notifyStore.unreadCount > 99 ? "99+" : notifyStore.unreadCount }}</span>
      </button>
      <div v-if="notifyStore.panelOpen" class="notify-panel">
        <div class="notify-head">
          <b>任务通知</b>
          <div class="notify-head-actions">
            <button class="btn sm ghost" :disabled="notifyStore.doneCount === 0" @click="notifyStore.clearDone()">清除已完成</button>
            <button class="btn sm ghost" @click="notifyStore.clearAll()">清空</button>
          </div>
        </div>
        <div v-for="t in sortedTasks" :key="t.taskId" class="notify-item">
          <div class="notify-main">
            <div class="notify-name">
              <span class="notify-ico"><AppIcon :name="statusIcon(t.status)" :size="13" /></span>
              <span class="s">{{ taskTypeLabel(t.taskType) }}</span> {{ t.label }}
            </div>
            <div class="notify-msg">{{ t.message }}</div>
            <div v-if="t.status === 'running' && t.total > 0" class="notify-progress"><i :style="{ width: progressPct(t) }"></i></div>
          </div>
          <div class="notify-actions">
            <template v-if="t.materialId != null">
              <button v-if="t.status === 'done' && t.taskType === 'organize'" class="btn sm ghost" @click="viewToc(t)">查看目录</button>
              <button v-if="t.status === 'done'" class="btn sm ghost" @click="goContent(t)">资料</button>
              <button v-if="t.status === 'failed'" class="btn sm ghost" @click="retryTask(t)">重试</button>
              <button v-if="t.status === 'running'" class="btn sm ghost" @click="cancelTask(t)">取消</button>
            </template>
            <button class="btn sm ghost" @click="notifyStore.clearTask(t.taskId)">移除</button>
          </div>
        </div>
      </div>
    </div>
    <button class="theme-toggle" title="切换明暗主题" @click="theme.toggle()">
      <AppIcon class="ic-sun" name="sun" :size="17" />
      <AppIcon class="ic-moon" name="moon" :size="17" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { MODAL_OPEN_EVENT } from "../utils/modals";
import AppIcon from "./AppIcon.vue";
import { useRoute, useRouter } from "vue-router";
import { useThemeStore } from "../stores/theme";
import { useCourseStore } from "../stores/course";
import { useNotifyStore, type BgTaskState, type BgTaskType } from "../stores/notify";
import { useModalStore } from "../stores/modal";
import {
  aggregateCourseToc,
  queryStudyPlans,
  queryStudyTasks,
  queryDueReviews,
  queryWrongQuestions,
  formatLocalDate,
  startOrganizeTask,
  cancelOrganizeTask,
  startExtractTask,
  cancelExtractTask,
} from "../api";
import { useDataSavedRefresh } from "../composables/useDataSaved";

const route = useRoute();
const router = useRouter();
const theme = useThemeStore();
const courseStore = useCourseStore();
const notifyStore = useNotifyStore();
const modalStore = useModalStore();

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
  cards: "闪卡本",
  review: "复习计划",
  graph: "知识图谱",
  report: "学习报告",
  settings: "模型配置",
};

const title = computed(() => titleMap[(route.name as string) ?? ""] ?? "学习首页");

// ===== 任务通知面板 =====
// 进行中排最前，其余按结束时间倒序
const sortedTasks = computed(() =>
  [...notifyStore.tasks].sort((a, b) => {
    if (a.status === "running") return -1;
    if (b.status === "running") return 1;
    return (b.finishedAt ?? "").localeCompare(a.finishedAt ?? "");
  }),
);

const TASK_TYPE_LABELS: Record<BgTaskType, string> = {
  organize: "AI 梳理",
  extract: "知识点抽取",
  gen_question: "AI 出题",
  gen_flashcard: "AI 闪卡",
  gen_plan: "AI 学习计划",
};

function statusIcon(status: BgTaskState["status"]): import("../utils/icons").IconName {
  if (status === "running") return "refresh";
  if (status === "done") return "check";
  if (status === "failed") return "x";
  return "clock";
}

function taskTypeLabel(taskType: BgTaskType): string {
  return TASK_TYPE_LABELS[taskType];
}

function progressPct(t: BgTaskState): string {
  if (t.total <= 0) return "0%";
  return `${Math.min(100, Math.round((t.done / t.total) * 100))}%`;
}

function togglePanel() {
  notifyStore.panelOpen = !notifyStore.panelOpen;
  if (notifyStore.panelOpen) notifyStore.markAllRead();
}

// 点击面板外区域关闭
function onDocClick(e: MouseEvent) {
  const wrap = (e.currentTarget as Document).querySelector(".notify-wrap");
  if (notifyStore.panelOpen && wrap && !wrap.contains(e.target as Node)) {
    notifyStore.panelOpen = false;
  }
}

async function switchToCourse(t: BgTaskState) {
  if (courseStore.currentCourseId !== t.courseId) courseStore.setCurrent(t.courseId);
}

function goContent(t: BgTaskState) {
  void switchToCourse(t);
  router.push({ name: "content" });
  notifyStore.panelOpen = false;
}

// 查看目录：切课程 → 课程内容页 → 弹目录预览（聚合课程全部资料的标题）
async function viewToc(t: BgTaskState) {
  try {
    await switchToCourse(t);
    router.push({ name: "content" });
    const agg = await aggregateCourseToc(t.courseId);
    modalStore.openChapterPreview(t.courseId, agg.headings, t.materialId ?? null, agg.materialCount);
  } catch (e) {
    console.error("打开目录预览失败:", e);
  } finally {
    notifyStore.panelOpen = false;
  }
}

function retryTask(t: BgTaskState) {
  if (t.materialId == null) return;
  if (t.taskType === "extract") startExtractTask(t.materialId, t.courseId);
  else startOrganizeTask(t.materialId, t.courseId);
}

function cancelTask(t: BgTaskState) {
  if (t.materialId == null) return;
  if (t.taskType === "extract") cancelExtractTask(t.materialId);
  else cancelOrganizeTask(t.materialId);
}

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
/** 打开任何弹窗时收起通知面板，避免面板压住弹窗 */
function onModalOpen() {
  notifyStore.panelOpen = false;
}

// 顶栏统计按当前课程刷新（global 脏集兜底全量）
useDataSavedRefresh(loadStats);

onMounted(() => {
  loadStats();
  window.addEventListener(MODAL_OPEN_EVENT, onModalOpen);
  document.addEventListener("click", onDocClick);
});
onBeforeUnmount(() => {
  window.removeEventListener(MODAL_OPEN_EVENT, onModalOpen);
  document.removeEventListener("click", onDocClick);
});
watch(() => courseStore.currentCourseId, onCourseChange);
</script>
