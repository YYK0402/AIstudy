<template>
  <div class="page">
    <div class="hero">
      <div class="greet">
        {{ courseName }}<small>{{ courseDesc || "暂无简介" }}</small>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button v-if="courseStore.currentCourse" class="btn sm" @click="openEdit"><AppIcon name="pencil" :size="13" /> 编辑课程信息</button>
          <button v-if="courseStore.currentCourse" class="btn sm" @click="exportOpen = true"><AppIcon name="download" :size="13" /> 导出课程包</button>
          <button v-if="!archived && questionCount > 0" class="btn sm primary" @click="startFinalExam"><AppIcon name="quiz" :size="13" /> 结业模考</button>
        </div>
      </div>
      <div class="streak"><div class="num">{{ masteredCount }}</div><div class="lbl">已掌握知识点</div></div>
    </div>

    <div v-if="archived" class="archived-banner">
      <span>本课程已归档 · 内容只读（生成计划 / 出题 / 上传资料等入口已隐藏）</span>
      <button class="btn sm" @click="unarchive">取消归档</button>
    </div>

    <SkeletonList v-if="loading && !stats" :rows="4" />
    <LoadError v-else-if="error && !stats" :message="error" @retry="load" />
    <template v-else>
    <div class="stat-grid">
      <div class="stat"><div class="k"><span class="dot" style="background:var(--as-green)"></span>已掌握知识点</div><div class="v">{{ masteredCount }}<span> / {{ stats?.kp.total ?? 0 }}</span></div></div>
      <div class="stat"><div class="k"><span class="dot" style="background:var(--as-accent)"></span>待复习</div><div class="v">{{ dueReviewCount }}</div></div>
      <div class="stat"><div class="k"><span class="dot" style="background:var(--as-red)"></span>错题待攻克</div><div class="v">{{ stats?.quiz.wrongCount ?? 0 }}</div></div>
      <div class="stat"><div class="k"><span class="dot" style="background:var(--as-blue)"></span>题目总数</div><div class="v">{{ questionCount }}</div></div>
    </div>

    <div v-if="stats?.lastStudyTime" class="s last-study t-faint" style="margin-top:10px">
      最近学习：{{ formatFullTime(stats.lastStudyTime) }}
    </div>

    <div class="two-col">
      <div class="card">
        <h3>本课程今日任务</h3>
        <div v-if="todayTasks.length === 0" class="empty-state">
          <span class="ico"><AppIcon name="folder" :size="28" /></span>
          {{ stats && stats.kp.total > 0 ? "今天没有学习任务" : "暂无学习任务，先生成学习计划" }}
        </div>
        <div v-else class="course-today-list">
          <StudyTaskRow
            v-for="t in todayTasks"
            :key="t.id"
            :title="t.title"
            :task-type="t.taskType"
            :done="t.status === 'done'"
            :disabled="archived"
            :busy="pendingTaskIds.has(t.id)"
            dense
            @click="openTask(t)"
            @toggle="toggleTask(t)"
          />
        </div>
      </div>
      <div class="card">
        <h3>掌握度分布</h3>
        <div v-if="!stats || stats.kp.total === 0" class="empty-state">
          <span class="ico"><AppIcon name="spark" :size="28" /></span>
          暂无知识点，上传资料后由 AI 解析生成
        </div>
        <div v-else class="dist-list">
          <div v-for="row in distributionRows" :key="row.key" class="dist-row">
            <span class="tag" :class="row.key"><span class="d"></span>{{ row.label }}</span>
            <div class="dist-track"><div class="dist-fill" :style="{ width: row.pct + '%', background: row.color }"></div></div>
            <span class="dist-num">{{ row.count }}</span>
          </div>
        </div>
      </div>
      </div>
    </template>
    <CoursePackageExportModal :course-id="courseStore.currentCourseId" :open="exportOpen" @close="exportOpen = false" />
  </div>
</template>

<script setup lang="ts">
import AppIcon from "../components/AppIcon.vue";
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useCourseStore } from "../stores/course";
import { useDataSavedRefresh } from "../composables/useDataSaved";
import { useModalStore } from "../stores/modal";
import {
  queryCourseStats,
  queryDueReviews,
  queryQuestions,
  queryTodayPlanTasks,
  setCourseStatus,
  updateStudyTask,
} from "../api";
import type { CourseStats, StudyTask, Mastery } from "../api";
import StudyTaskRow from "../components/StudyTaskRow.vue";
import CoursePackageExportModal from "../components/CoursePackageExportModal.vue";
import { taskAction } from "../constants/tasks";
import SkeletonList from "../components/SkeletonList.vue";
import LoadError from "../components/LoadError.vue";
import { useLoad } from "../composables/useLoad";

const courseStore = useCourseStore();
const modalStore = useModalStore();
const router = useRouter();

const courseName = computed(() => courseStore.currentCourse?.name ?? "课程");
const courseDesc = computed(() => courseStore.currentCourse?.description ?? "");
const archived = computed(() => courseStore.currentCourse?.status === "archived");

const stats = ref<CourseStats | null>(null);
const dueReviewCount = ref(0);
const questionCount = ref(0);
const todayTasks = ref<StudyTask[]>([]);
/** 正在写入的任务：防止连点，勾选框显示转圈 */
const pendingTaskIds = ref<Set<number>>(new Set());
const exportOpen = ref(false);

const masteredCount = computed(
  () => (stats.value?.kp.distribution.mastered ?? 0) + (stats.value?.kp.distribution.proficient ?? 0),
);

const MASTERY_ROWS: Array<{ key: Mastery; label: string; color: string }> = [
  { key: "proficient", label: "精通", color: "var(--as-green)" },
  { key: "mastered", label: "掌握", color: "var(--as-blue)" },
  { key: "known", label: "了解", color: "var(--as-accent)" },
  { key: "unlearn", label: "未学", color: "var(--as-text-faint)" },
];

const distributionRows = computed(() => {
  const s = stats.value;
  if (!s) return [];
  const total = s.kp.total || 1;
  return MASTERY_ROWS.map((row) => ({
    ...row,
    count: s.kp.distribution[row.key],
    pct: Math.round((s.kp.distribution[row.key] / total) * 100),
  }));
});

function openTask(t: StudyTask) {
  const action = taskAction(t);
  if (action) router.push(action.to);
}

async function toggleTask(t: StudyTask) {
  if (archived.value || pendingTaskIds.value.has(t.id)) return;
  pendingTaskIds.value = new Set(pendingTaskIds.value).add(t.id);
  try {
    await updateStudyTask({ ...t, status: t.status === "done" ? "todo" : "done" });
    t.status = t.status === "done" ? "todo" : "done";
  } catch (e) {
    console.error("更新任务状态失败:", e);
    window.siyuanAiStudy.showMessage(e instanceof Error ? e.message : "更新任务状态失败", 4000, "error");
  } finally {
    const next = new Set(pendingTaskIds.value);
    next.delete(t.id);
    pendingTaskIds.value = next;
  }
}

function openEdit() {
  const course = courseStore.currentCourse;
  if (course) {
    modalStore.openEditCourse(course);
  }
}

/** 结业模考：跳刷题页组卷面板，预填全课程知识点 */
function startFinalExam() {
  router.push({ path: "/quiz", query: { exam: "1" } });
}

function formatFullTime(iso: string): string {
  if (!iso) {
    return "";
  }
  return new Date(iso).toLocaleString("zh-CN");
}

async function unarchive() {
  const course = courseStore.currentCourse;
  if (!course) return;
  try {
    await setCourseStatus(course.id, "active");
    await courseStore.refresh().catch(() => undefined);
    window.siyuanAiStudy.showMessage("已取消归档");
  } catch (e) {
    console.error("取消归档失败:", e);
    window.siyuanAiStudy.showMessage(e instanceof Error ? e.message : "取消归档失败", 4000, "error");
  }
}

const { loading, error, load } = useLoad(async (ctx) => {
  if (!ctx.courseId) {
    stats.value = null;
    return;
  }
  const [s, due, questions, tasks] = await Promise.all([
    queryCourseStats(ctx.courseId),
    queryDueReviews(ctx.courseId),
    queryQuestions(ctx.courseId),
    queryTodayPlanTasks(ctx.courseId),
  ]);
  if (ctx.isStale()) return;
  stats.value = s;
  dueReviewCount.value = due.length;
  questionCount.value = questions.length;
  todayTasks.value = tasks;
});

useDataSavedRefresh(() => void load());

// 切换课程时立即重置并重新加载，避免展示旧课程的统计/任务
watch(
  () => courseStore.currentCourseId,
  () => {
    stats.value = null;
    dueReviewCount.value = 0;
    questionCount.value = 0;
    todayTasks.value = [];
    pendingTaskIds.value = new Set();
    void load();
  },
);

onMounted(() => {
  void load();
});
</script>
