<template>
  <div class="page">
    <div class="hero">
      <div class="greet">{{ greeting }}，专心者<small>{{ courseStore.courses.length }} 门课程 · 点击课程卡片开始学习</small></div>
      <div class="streak"><div class="num">{{ courseStore.courses.length }}</div><div class="lbl">我的课程</div></div>
    </div>

    <div class="section-head">
      <h2>我的课程</h2><span class="hint">点击卡片进入课程继续学习</span>
      <div class="filter-tabs">
        <button v-for="t in filterTabs" :key="t.key" class="ftab" :class="{ active: courseFilter === t.key }" @click="courseFilter = t.key">
          {{ t.label }}{{ t.count > 0 ? ` ${t.count}` : "" }}
        </button>
      </div>
      <button class="btn sm" @click="modalStore.openNewCourse()">＋ 新建课程</button>
    </div>
    <div class="course-grid">
      <div
        v-for="c in visibleCourses"
        :key="c.id"
        class="course-card"
        :class="{ archived: isArchived(c) }"
        @click="enterCourse(c)"
      >
        <div class="cc-top">
          <div class="cc-icon" style="background:var(--as-accent-soft)">{{ emojiOf(c.id) }}</div>
          <div><div class="cc-name">{{ c.name }}<span v-if="isArchived(c)" class="tag archived-tag" style="margin-left:6px">已归档</span></div><div class="cc-desc">{{ c.description || "尚未添加简介" }}</div></div>
        </div>
        <div class="cc-stats" style="margin-top:14px">
          <span>创建于 {{ formatDate(c.createTime) }}</span>
          <span v-if="courseStats[c.id]">{{ courseStats[c.id]!.kpTotal }} 个知识点 · 已掌握 {{ courseStats[c.id]!.mastered }}</span>
        </div>
        <div class="cc-foot">
          <span class="cc-todo" style="color:var(--as-text-faint)">
            {{ isArchived(c) ? "🗄️ 已归档 · 只读" : courseStats[c.id] && courseStats[c.id]!.kpTotal > 0 ? "● 学习中" : "○ 暂无学习记录" }}
          </span>
          <button class="btn sm ghost card-archive-btn" @click.stop="toggleArchive(c)" :title="isArchived(c) ? '取消归档' : '归档课程（归档后仅可查看）'">
            {{ isArchived(c) ? "↩ 恢复" : "🗄 归档" }}
          </button>
          <span class="cc-go">{{ isArchived(c) ? "查看 →" : "开始学习 →" }}</span>
        </div>
      </div>
      <div class="course-card add" @click="modalStore.openNewCourse()">
        <span class="plus">＋</span>
        <span class="txt">新建一门课程</span>
      </div>
    </div>

    <div class="section-head">
      <h2>今日任务</h2><span class="hint">跨课程汇总 · 学习计划 + 到期间隔复习</span>
    </div>
    <div class="card">
      <div v-if="todayTasks.length === 0" class="empty-state">
        <span class="ico">📭</span>
        暂无待办任务，生成学习计划或出现到期复习后会显示在这里
      </div>
      <div v-else class="today-list" style="padding:4px 0">
        <div v-for="task in todayTasks" :key="task.id" class="today-item" :class="{ done: task.done }" @click="onItemClick(task)">
          <div class="ico" :style="{ background: task.color }"><span style="font-size:14px">{{ task.icon }}</span></div>
          <div class="info"><div class="t">{{ task.title }}</div><div class="s">{{ task.sub }}</div></div>
          <router-link
            v-if="task.kind === 'plan' && (task.kpId != null || task.taskType === 'test')"
            class="task-act"
            :to="taskActionRoute(task)"
            @click.stop
          >{{ taskActionLabel(task) }}</router-link>
          <router-link
            v-else-if="task.kind === 'review'"
            class="task-act"
            :to="task.kpId != null ? { path: '/review', query: { kp: String(task.kpId) } } : '/review'"
            @click.stop
          >去复习</router-link>
          <span class="today-badge">{{ task.course }}</span>
          <div class="done"></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useCourseStore } from "../stores/course";
import { useModalStore } from "../stores/modal";
import { emojiOf } from "../utils";
import {
  getData,
  queryStudyPlans,
  queryStudyTasks,
  queryDueReviews,
  updateStudyTask,
  setCourseStatus,
  formatLocalDate,
  DATA_SAVED_EVENT,
} from "../api";
import type { Course } from "../api";

const router = useRouter();
const courseStore = useCourseStore();
const modalStore = useModalStore();

/** 课程看板筛选：全部 / 进行中 / 已归档 */
const courseFilter = ref<"all" | "active" | "archived">("all");

function isArchived(c: Course): boolean {
  return c.status === "archived";
}

const filterTabs = computed(() => [
  { key: "all" as const, label: "全部", count: courseStore.courses.length },
  { key: "active" as const, label: "进行中", count: courseStore.courses.filter((c) => !isArchived(c)).length },
  { key: "archived" as const, label: "已归档", count: courseStore.courses.filter((c) => isArchived(c)).length },
]);

const visibleCourses = computed(() => {
  if (courseFilter.value === "all") return courseStore.courses;
  return courseStore.courses.filter((c) => (courseFilter.value === "archived" ? isArchived(c) : !isArchived(c)));
});

async function toggleArchive(course: Course) {
  const next = isArchived(course) ? "active" : "archived";
  if (next === "archived") {
    const ok = window.confirm(`归档课程「${course.name}」？归档后生成计划 / 出题 / 上传资料等入口将隐藏，仅可查看。`);
    if (!ok) return;
  }
  try {
    await setCourseStatus(course.id, next);
    window.siyuanAiStudy.showMessage(next === "archived" ? "课程已归档" : "已取消归档");
    await courseStore.refresh().catch(() => undefined);
  } catch (e) {
    console.error("归档操作失败:", e);
    window.siyuanAiStudy.showMessage(e instanceof Error ? e.message : "归档操作失败", 4000, "error");
  }
}

const greeting = computed(() => {
  const h = new Date().getHours();
  if (h < 6) return "夜深了";
  if (h < 9) return "早上好";
  if (h < 12) return "上午好";
  if (h < 14) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
});

/** 每门课程的学习概览：知识点总数 / 已掌握（掌握+精通） */
const courseStats = reactive<Record<number, { kpTotal: number; mastered: number }>>({});

interface TodayTaskItem {
  id: number;
  /** plan=计划任务（可手动勾选）；review=到期 SM2 复习项（评级即完成，id 取负 schedule.id 防冲突） */
  kind: "plan" | "review";
  planId: number;
  chapterId: number | null;
  kpId: number | null;
  taskType: string;
  scheduledDate: string;
  sort: number;
  title: string;
  sub: string;
  course: string;
  icon: string;
  color: string;
  done: boolean;
}

const todayTasks = reactive<TodayTaskItem[]>([]);

const TASK_ICONS: Array<{ icon: string; color: string }> = [
  { icon: "📖", color: "var(--as-accent-soft)" },
  { icon: "✏️", color: "var(--as-blue-soft)" },
  { icon: "🔁", color: "var(--as-green-soft)" },
  { icon: "💡", color: "var(--as-red-soft)" },
];

const taskTypeLabel = (t: string): string => {
  const map: Record<string, string> = { learn: "新知", review: "复习", practice: "练习", test: "测评" };
  return map[t] ?? t;
};

/** 各类型专属去处：学→双栏学习 / 练→专项刷题 / 复→定向复习 / 测→章节组卷或结业模考 */
function taskActionRoute(task: TodayTaskItem): { path: string; query: Record<string, string> } {
  const kpQuery = { kp: String(task.kpId) };
  if (task.taskType === "practice") return { path: "/quiz", query: kpQuery };
  if (task.taskType === "review") return { path: "/review", query: kpQuery };
  if (task.taskType === "test") {
    return task.chapterId
      ? { path: "/quiz", query: { set: String(task.chapterId) } }
      : { path: "/quiz", query: { exam: "1" } };
  }
  return { path: "/study", query: kpQuery };
}

function taskActionLabel(task: TodayTaskItem): string {
  if (task.taskType === "practice") return "去刷题";
  if (task.taskType === "review") return "去复习";
  if (task.taskType === "test") return "去测评";
  return "去学习";
}

function enterCourse(course: Course) {
  courseStore.setCurrent(course.id);
  router.push("/course");
}

function formatDate(iso: string): string {
  if (!iso) {
    return "";
  }
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function load() {
  const data = await getData();
  // 课程卡片学习概览
  for (const c of data.courses) {
    const kps = data.knowledgePoints.filter((k) => k.courseId === c.id);
    courseStats[c.id] = {
      kpTotal: kps.length,
      mastered: kps.filter((k) => k.mastery === "mastered" || k.mastery === "proficient").length,
    };
  }
  // 清理已删除课程的统计
  for (const id of Object.keys(courseStats)) {
    if (!data.courses.some((c) => c.id === Number(id))) delete courseStats[Number(id)];
  }
    // 跨课程今日任务 = 计划任务（今天排期）+ 到期 SM2 复习项（合轨决策 A）
  // 已归档课程仅查看：其计划任务与到期复习不再浮现到今日任务
  const activeCourses = data.courses.filter((c) => c.status !== "archived");
  const today = formatLocalDate();
  const items: TodayTaskItem[] = [];
  for (const c of activeCourses) {
    const plans = data.studyPlans.filter((p) => p.courseId === c.id && p.status !== "paused");
    for (const p of plans) {
      const tasks = data.studyTasks.filter((t) => t.planId === p.id && t.scheduledDate === today);
      for (const t of tasks) {
        items.push({
          id: t.id,
          kind: "plan",
          planId: t.planId,
          chapterId: t.chapterId,
          kpId: t.kpId ?? null,
          taskType: t.taskType,
          scheduledDate: t.scheduledDate,
          sort: t.sort,
          title: t.title,
          sub: taskTypeLabel(t.taskType),
          course: c.name,
          icon: "📌",
          color: "var(--as-accent-soft)",
          done: t.status === "done",
        });
      }
    }
  }
  // 到期间隔复习项：完成 = 复习计划页评级（dueTime 推后后自动消失）
  for (const c of activeCourses) {
    for (const item of await queryDueReviews(c.id)) {
      const kp = item.knowledgePoint;
      const q = item.question;
      items.push({
        id: -item.schedule.id,
        kind: "review",
        planId: 0,
        chapterId: null,
        kpId: item.schedule.kpId,
        taskType: "review",
        scheduledDate: item.schedule.dueTime,
        sort: 0,
        title: kp ? `复习：${kp.name}` : q ? `错题复习：${q.title}` : `复习 #${item.schedule.id}`,
        sub: "间隔复习",
        course: c.name,
        icon: "🔁",
        color: "var(--as-green-soft)",
        done: false,
      });
    }
  }
  items.sort((a, b) => Number(a.done) - Number(b.done));
  for (let i = 0; i < items.length; i++) {
    if (items[i].kind !== "plan") continue;
    const style = TASK_ICONS[i % TASK_ICONS.length];
    items[i].icon = style.icon;
    items[i].color = style.color;
  }
  todayTasks.splice(0, todayTasks.length, ...items);
}

function onItemClick(task: TodayTaskItem) {
  if (task.kind === "review") {
    router.push("/review");
    return;
  }
  toggleTask(task);
}

async function toggleTask(task: TodayTaskItem) {
  try {
    await updateStudyTask({
      id: task.id,
      planId: task.planId,
      chapterId: task.chapterId,
      kpId: task.kpId,
      taskType: task.taskType,
      title: task.title,
      scheduledDate: task.scheduledDate,
      status: task.done ? "todo" : "done",
      sort: task.sort,
    });
    task.done = !task.done;
  } catch (e) {
    console.error("更新任务状态失败:", e);
    window.siyuanAiStudy.showMessage(e instanceof Error ? e.message : "更新任务状态失败", 4000, "error");
  }
}

function onDataSaved() {
  load().catch((e) => console.error("刷新首页失败:", e));
}

onMounted(() => {
  load().catch((e) => console.error("加载首页失败:", e));
  window.addEventListener(DATA_SAVED_EVENT, onDataSaved);
});
onBeforeUnmount(() => {
  window.removeEventListener(DATA_SAVED_EVENT, onDataSaved);
});
watch(
  () => courseStore.courses.length,
  () => load().catch((e) => console.error("刷新首页失败:", e)),
);
</script>
