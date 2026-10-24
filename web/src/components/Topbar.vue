<template>
  <div class="topbar">
    <div class="crumbs">研习 <span class="sep">/</span> <span class="cur">{{ title }}</span></div>
    <div class="spacer"></div>
    <div v-if="currentCourseId" class="topbar-today">
      <span class="dot"></span> 今日 <b>{{ todayTaskCount }}</b> 项任务 · <b>{{ dueReviewCount }}</b> 待复习 · <b>{{ wrongCount }}</b> 道错题
    </div>
    <div class="notify-wrap" v-if="notifyStore.tasks.length > 0">
      <button class="theme-toggle notify-bell" title="任务通知" @click="togglePanel">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 01-3.4 0" />
        </svg>
        <span v-if="notifyStore.unreadCount > 0" class="notify-badge">{{ notifyStore.unreadCount > 99 ? "99+" : notifyStore.unreadCount }}</span>
      </button>
      <div v-if="notifyStore.panelOpen" class="notify-panel">
        <div class="notify-head">
          <b>任务通知</b>
          <button class="btn sm ghost" @click="notifyStore.clearAll()">清空</button>
        </div>
        <div v-for="t in sortedTasks" :key="`${t.materialId}-${t.taskType}`" class="notify-item">
          <div class="notify-main">
            <div class="notify-name">
              <span class="notify-ico">{{ statusIcon(t.status) }}</span>
              <span class="muted">{{ taskTypeLabel(t.taskType) }}</span> {{ t.materialName }}
            </div>
            <div class="notify-msg">{{ t.message }}</div>
            <div v-if="t.status === 'running' && t.total > 0" class="notify-progress"><i :style="{ width: progressPct(t) }"></i></div>
          </div>
          <div class="notify-actions">
            <button v-if="t.status === 'done' && t.taskType === 'organize'" class="btn sm ghost" @click="viewToc(t)">查看目录</button>
            <button v-if="t.status === 'done'" class="btn sm ghost" @click="goContent(t)">资料</button>
            <button v-if="t.status === 'failed'" class="btn sm ghost" @click="retryTask(t)">重试</button>
            <button v-if="t.status === 'running'" class="btn sm ghost" @click="cancelTask(t)">取消</button>
            <button class="btn sm ghost" @click="notifyStore.clearTask(t.materialId, t.taskType)">移除</button>
          </div>
        </div>
      </div>
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
import { useRoute, useRouter } from "vue-router";
import { useThemeStore } from "../stores/theme";
import { useCourseStore } from "../stores/course";
import { useNotifyStore, type OrgTaskState } from "../stores/notify";
import { useModalStore } from "../stores/modal";
import type { ParsedHeading } from "../utils/documentParser";
import {
  queryStudyPlans,
  queryStudyTasks,
  queryDueReviews,
  queryWrongQuestions,
  queryMaterials,
  formatLocalDate,
  startOrganizeTask,
  cancelOrganizeTask,
  startExtractTask,
  cancelExtractTask,
  DATA_SAVED_EVENT,
} from "../api";

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

function statusIcon(status: OrgTaskState["status"]): string {
  if (status === "running") return "🔄";
  if (status === "done") return "✅";
  if (status === "failed") return "❌";
  return "⏹️";
}

function taskTypeLabel(taskType: OrgTaskState["taskType"]): string {
  return taskType === "extract" ? "知识点抽取" : "AI 梳理";
}

function progressPct(t: OrgTaskState): string {
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

async function switchToCourse(t: OrgTaskState) {
  if (courseStore.currentCourseId !== t.courseId) courseStore.setCurrent(t.courseId);
}

function goContent(t: OrgTaskState) {
  void switchToCourse(t);
  router.push({ name: "content" });
  notifyStore.panelOpen = false;
}

// 查看目录：切课程 → 课程内容页 → 弹目录预览（用该资料最新标题）
async function viewToc(t: OrgTaskState) {
  try {
    await switchToCourse(t);
    router.push({ name: "content" });
    const mats = await queryMaterials(t.courseId);
    const mat = mats.find((m) => m.id === t.materialId);
    const headings = (mat ? JSON.parse(mat.headings || "[]") : []) as ParsedHeading[];
    modalStore.openChapterPreview(t.courseId, headings.filter((h) => h && h.text));
  } catch (e) {
    console.error("打开目录预览失败:", e);
  } finally {
    notifyStore.panelOpen = false;
  }
}

function retryTask(t: OrgTaskState) {
  if (t.taskType === "extract") startExtractTask(t.materialId, t.courseId);
  else startOrganizeTask(t.materialId, t.courseId);
}

function cancelTask(t: OrgTaskState) {
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
function onDataSaved() {
  loadStats();
}

onMounted(() => {
  loadStats();
  window.addEventListener(DATA_SAVED_EVENT, onDataSaved);
  document.addEventListener("click", onDocClick);
});
onBeforeUnmount(() => {
  window.removeEventListener(DATA_SAVED_EVENT, onDataSaved);
  document.removeEventListener("click", onDocClick);
});
watch(() => courseStore.currentCourseId, onCourseChange);
</script>
