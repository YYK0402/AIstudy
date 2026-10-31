<template>
  <div class="page">
    <div class="hero">
      <div class="greet">{{ greeting }}，专心者<small>{{ courseStore.courses.length }} 门课程 · 点击课程卡片开始学习</small></div>
      <div class="hero-stats">
        <div class="streak"><div class="num">{{ streakDays }}</div><div class="lbl">连续学习天数</div></div>
        <div class="streak"><div class="num">{{ todayMin }}</div><div class="lbl">今日（分钟）</div></div>
        <div class="streak"><div class="num">{{ weekMin }}</div><div class="lbl">近 7 天（分钟）</div></div>
        <div class="mini-bars" title="近 7 天学习时长">
          <div v-for="d in trendDaily" :key="d.date" class="mb" :class="{ zero: d.seconds === 0 }" :style="{ height: trendBarH(d.seconds) }"></div>
        </div>
      </div>
    </div>

    <div class="section-head">
      <h2>我的课程</h2><span class="hint">点击卡片进入课程继续学习</span>
      <button class="btn sm" :disabled="importing" @click="triggerImport">
        <AppIcon name="upload" :size="13" /> {{ importing ? "导入中…" : "导入课程包" }}
      </button>
      <input ref="importInput" type="file" accept=".zip" style="display:none" @change="onImportFile" />
      <div class="filter-tabs">
        <button v-for="t in filterTabs" :key="t.key" class="ftab" :class="{ active: courseFilter === t.key }" @click="courseFilter = t.key">
          {{ t.label }}{{ t.count > 0 ? ` ${t.count}` : "" }}
        </button>
      </div>
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
          <div class="cc-icon" style="background:var(--as-accent-soft)" aria-hidden="true">{{ emojiOf(c.id) }}</div>
          <div><div class="cc-name">{{ c.name }}<span v-if="c.isSample" class="tag sample-tag" style="margin-left:6px">示例</span><span v-if="isArchived(c)" class="tag archived-tag" style="margin-left:6px">已归档</span></div><div class="cc-desc">{{ c.description || "尚未添加简介" }}</div></div>
        </div>
        <div class="cc-stats" style="margin-top:14px">
          <span>创建于 {{ formatDate(c.createTime) }}</span>
          <span v-if="courseStats[c.id]">{{ courseStats[c.id]!.kpTotal }} 个知识点 · 已掌握 {{ courseStats[c.id]!.mastered }}</span>
        </div>
        <div v-if="courseStats[c.id] && courseStats[c.id]!.kpTotal > 0" class="cc-progress">
          <ProgressBar :value="courseStats[c.id]!.mastered" :max="courseStats[c.id]!.kpTotal" tone="green" />
        </div>
        <div class="cc-foot">
          <span class="cc-todo t-faint">
            {{ isArchived(c) ? "已归档 · 只读" : courseStats[c.id] && courseStats[c.id]!.kpTotal > 0 ? "● 学习中" : "○ 暂无学习记录" }}
          </span>
          <button class="btn sm ghost card-archive-btn" @click.stop="toggleArchive(c)" :title="isArchived(c) ? '取消归档' : '归档课程（归档后仅可查看）'">
            <AppIcon :name="isArchived(c) ? 'refresh' : 'archive'" :size="12" /> {{ isArchived(c) ? "恢复" : "归档" }}
          </button>
          <span class="cc-go">{{ isArchived(c) ? "查看 →" : "开始学习 →" }}</span>
        </div>
      </div>
      <div v-if="showSampleCard" class="course-card sample" @click="addSampleCourse">
        <div class="sample-head">
          <span class="sample-ico" aria-hidden="true">✦</span>
          <span class="sample-title">试一试示例课</span>
          <span v-if="addingSample" class="sample-busy">添加中…</span>
        </div>
        <div class="sample-desc">无需上传资料、无需先配 AI，点一下就能开始学</div>
        <div class="sample-meta">中国近代史 · 4 章 12 知识点 · 含现成题目与两周计划</div>
        <div class="sample-cta">添加并开始学习 →</div>
      </div>
      <div class="course-card add" @click="modalStore.openNewCourse()">
        <span class="plus">＋</span>
        <span class="txt">新建一门课程</span>
      </div>
    </div>

    <div class="home-metrics">
      <div class="card metric-card" @click="router.push('/review')">
        <h3>复习预测<span class="metric-hint">未来 7 天到期复习量 · 点击进入复习计划</span></h3>
        <div v-if="forecastTotal === 0" class="metric-empty">近期无复习安排</div>
        <div v-else class="forecast-bars">
          <div v-for="d in forecast" :key="d.date" class="fb">
            <span class="fb-count">{{ d.count > 0 ? d.count : "" }}</span>
            <div class="fb-bar" :class="{ zero: d.count === 0 }" :style="{ height: forecastBarH(d.count) }"></div>
            <span class="fb-label">{{ d.label }}</span>
          </div>
        </div>
      </div>
      <div class="card metric-card" @click="router.push('/wrong')">
        <h3>错题快照<span class="metric-hint">点击进入错题本</span></h3>
        <div class="wrong-stats">
          <div class="ws"><div class="num">{{ wrongSnap.active }}</div><div class="lbl">在管</div></div>
          <div class="ws"><div class="num">{{ wrongSnap.weekNew }}</div><div class="lbl">本周新增</div></div>
          <div class="ws"><div class="num">{{ wrongSnap.nearGraduate }}</div><div class="lbl">快毕业</div></div>
        </div>
        <div class="metric-note">快毕业 = 再答对 1 次即毕业</div>
      </div>
    </div>

    <div class="section-head">
      <h2>今日任务</h2><span class="hint">按课程汇总 · 学习计划 + 到期间隔复习</span>
    </div>
    <div class="card">
      <SkeletonList v-if="loading && todayGroups.length === 0" :rows="4" />
      <LoadError
        v-else-if="loadError && todayGroups.length === 0"
        :message="loadError"
        @retry="load"
      />
      <div v-else-if="todayGroups.length === 0" class="empty-state">
        <span class="ico"><AppIcon name="folder" :size="28" /></span>
        暂无待办任务，生成学习计划或出现到期复习后会显示在这里
      </div>
      <div v-else class="today-groups">
        <div v-for="g in todayGroups" :key="g.courseId" class="today-group">
          <div class="today-course" @click="toggleCourse(g.courseId)">
            <span class="tc-emoji" aria-hidden="true">{{ emojiOf(g.courseId) }}</span>
            <span class="tc-name">{{ g.courseName }}</span>
            <span class="tc-sum">{{ g.tasks.length }} 个任务 · {{ groupSummary(g) }}</span>
            <span class="tc-prog">{{ g.doneCount }}/{{ g.tasks.length }} 完成</span>
            <ProgressBar :value="g.doneCount" :max="g.tasks.length" tone="green" sm />
            <button class="link-btn tc-tgl" @click.stop="toggleCourse(g.courseId)">
              {{ isCourseOpen(g.courseId) ? "收起" : "展开" }}
            </button>
          </div>
          <div v-if="isCourseOpen(g.courseId)" class="today-list">
            <StudyTaskRow
              v-for="task in g.tasks"
              :key="task.kind + '-' + task.id"
              :title="task.title"
              :task-type="task.taskType"
              :done="task.done"
              :checkable="task.kind === 'plan'"
              :busy="pendingTaskIds.has(task.id)"
              :action="taskAction(task)"
              dense
              @click="openTask(task)"
              @toggle="toggleTask(task)"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import AppIcon from "../components/AppIcon.vue";
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useCourseStore } from "../stores/course";
import { useDataSavedRefresh } from "../composables/useDataSaved";
import { useModalStore } from "../stores/modal";
import { emojiOf } from "../utils";
import StudyTaskRow from "../components/StudyTaskRow.vue";
import ProgressBar from "../components/ProgressBar.vue";
import SkeletonList from "../components/SkeletonList.vue";
import LoadError from "../components/LoadError.vue";
import { TASK_TYPES, TASK_TYPE_LABELS, taskAction } from "../constants/tasks";
import {
  getData,
  queryStudyPlans,
  queryStudyTasks,
  queryDueReviews,
  updateStudyTask,
  setCourseStatus,
  formatLocalDate,
  truncateText,
  importCourseZip,
  createSampleCourse,
} from "../api";
import type { Course } from "../api";
import { aggregateStudyTrend } from "../utils/studyTrend";
import type { StudyTrendDay } from "../utils/studyTrend";
import { studyStreak, reviewForecast, wrongSnapshot } from "../utils/studyStats";
import type { ReviewForecastDay, WrongSnapshot } from "../utils/studyStats";
import { useConfirm } from "../composables/useConfirm";

const router = useRouter();
const courseStore = useCourseStore();
const modalStore = useModalStore();
const { confirm } = useConfirm();

// ===== 试一试示例课（开箱即用）=====
const addingSample = ref(false);
/** 仅当数据中无示例课时显示卡片 */
const showSampleCard = computed(() => !courseStore.courses.some((c) => c.isSample === true));

async function addSampleCourse() {
  if (addingSample.value) return;
  addingSample.value = true;
  try {
    const res = await createSampleCourse();
    const c = res.counts;
    window.siyuanAiStudy.showMessage(
      `已添加示例课「${res.courseName}」：${c.chapters} 章 / ${c.kps} 知识点 / ${c.questions} 题 / ${c.cards} 闪卡，已生成两周学习计划`,
    );
    await courseStore.refresh().catch(() => undefined);
  } catch (e) {
    console.error("添加示例课失败:", e);
    window.siyuanAiStudy.showMessage(e instanceof Error ? e.message : "添加示例课失败", 4000, "error");
  } finally {
    addingSample.value = false;
  }
}

// ===== 导入课程包 =====
const importInput = ref<HTMLInputElement | null>(null);
const importing = ref(false);

function triggerImport() {
  if (importing.value) return;
  importInput.value?.click();
}

async function onImportFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = ""; // 允许重选同一文件
  if (!file || importing.value) return;
  importing.value = true;
  window.siyuanAiStudy.showMessage("正在导入课程包…");
  try {
    const res = await importCourseZip(file);
    const c = res.counts;
    const asset = res.assetFiles > 0 ? ` / ${res.assetFiles} 原始文件` : "";
    window.siyuanAiStudy.showMessage(`已导入「${res.courseName}」：${c.chapters} 章 / ${c.kps} 知识点 / ${c.materials} 资料 / ${c.questions} 题${asset}`);
    await courseStore.refresh().catch(() => undefined);
  } catch (err) {
    console.error("导入课程包失败:", err);
    window.siyuanAiStudy.showMessage(err instanceof Error ? err.message : "导入课程包失败", 4000, "error");
  } finally {
    importing.value = false;
  }
}

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
    const ok = await confirm({ message: `归档课程「${course.name}」？归档后生成计划 / 出题 / 上传资料等入口将隐藏，仅可查看。`, confirmText: "归档" });
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

// ===== 学习仪表盘：连续天数 / 时长趋势 / 复习预测 / 错题快照 =====
const streakDays = ref(0);
const trendDaily = ref<StudyTrendDay[]>([]);
const todaySec = ref(0);
const weekSec = ref(0);
const forecast = ref<ReviewForecastDay[]>([]);
const wrongSnap = reactive<WrongSnapshot>({ active: 0, weekNew: 0, nearGraduate: 0 });

const todayMin = computed(() => Math.round(todaySec.value / 60));
const weekMin = computed(() => Math.round(weekSec.value / 60));
const forecastTotal = computed(() => forecast.value.reduce((s, d) => s + d.count, 0));

function trendBarH(sec: number): string {
  const max = trendDaily.value.reduce((m, d) => Math.max(m, d.seconds), 0);
  if (max <= 0) return "2px";
  return `${Math.max(2, Math.round((sec / max) * 28))}px`;
}

function forecastBarH(count: number): string {
  const max = forecast.value.reduce((m, d) => Math.max(m, d.count), 0);
  if (max <= 0) return "2px";
  return `${Math.max(2, Math.round((count / max) * 56))}px`;
}

interface TodayTaskItem {
  id: number;
  courseId: number;
  /** plan=计划任务（可手动勾选）；review=到期 SM2 复习项（评级即完成，id 取负 schedule.id 防冲突） */
  kind: "plan" | "review";
  planId: number;
  chapterId: number | null;
  kpId: number | null;
  taskType: string;
  scheduledDate: string;
  sort: number;
  title: string;
  course: string;
  done: boolean;
}

const todayTasks = reactive<TodayTaskItem[]>([]);
const loading = ref(true);
const loadError = ref("");
/** 正在写入的任务：防止连点，勾选框显示转圈 */
const pendingTaskIds = ref<Set<number>>(new Set());

interface CourseDayGroup {
  courseId: number;
  courseName: string;
  tasks: TodayTaskItem[];
  counts: Record<string, number>;
  doneCount: number;
}

/** 今日任务按课程归组（组间保持课程原顺序，组内未完成在前） */
const todayGroups = computed<CourseDayGroup[]>(() => {
  const map = new Map<number, CourseDayGroup>();
  for (const t of todayTasks) {
    const g = map.get(t.courseId) ?? {
      courseId: t.courseId,
      courseName: t.course,
      tasks: [],
      counts: {},
      doneCount: 0,
    };
    g.tasks.push(t);
    g.counts[t.taskType] = (g.counts[t.taskType] ?? 0) + 1;
    if (t.done) g.doneCount += 1;
    map.set(t.courseId, g);
  }
  return [...map.values()];
});

function groupSummary(g: CourseDayGroup): string {
  return TASK_TYPES.filter((key) => g.counts[key])
    .map((key) => `${TASK_TYPE_LABELS[key]} ${g.counts[key]}`)
    .join(" · ");
}

/** 课程行展开状态：仅一门课程有任务时默认展开，多门默认收起 */
const expandedCourses = ref<Set<number>>(new Set());
let loadedGroupsKey = "";

function isCourseOpen(courseId: number): boolean {
  return expandedCourses.value.has(courseId);
}

function toggleCourse(courseId: number) {
  const next = new Set(expandedCourses.value);
  if (next.has(courseId)) next.delete(courseId);
  else next.add(courseId);
  expandedCourses.value = next;
}

function applyDefaultExpand() {
  const key = todayGroups.value
    .map((g) => `${g.courseId}:${g.tasks.map((t) => t.id).join(",")}`)
    .join("|");
  if (key === loadedGroupsKey) return;
  loadedGroupsKey = key;
  expandedCourses.value =
    todayGroups.value.length === 1 ? new Set([todayGroups.value[0].courseId]) : new Set();
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
  loading.value = true;
  loadError.value = "";
  try {
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
    const activeIds = new Set(activeCourses.map((c) => c.id));
    const kpCourse = new Map(data.knowledgePoints.map((k) => [k.id, k.courseId]));
    const qCourse = new Map(data.questions.map((q) => [q.id, q.courseId]));
    const cardCourse = new Map(data.flashCards.map((c) => [c.id, c.courseId]));
    /** 复习项/错题归属课程是否仍在学习（归档课程不计入仪表盘） */
    const inActiveCourse = (courseId: number | undefined): boolean => courseId != null && activeIds.has(courseId);
    // 学习仪表盘：时长趋势 / 连续天数（全量日志）+ 复习预测 / 错题快照（仅学习中的课程）
    const trend = aggregateStudyTrend(data.studyLogs, 7);
    trendDaily.value = trend.daily;
    todaySec.value = trend.daily[trend.daily.length - 1]?.seconds ?? 0;
    weekSec.value = trend.daily.reduce((s, d) => s + d.seconds, 0);
    streakDays.value = studyStreak(data.studyLogs);
    const activeSchedules = data.reviewSchedules.filter((s): boolean => {
      const cid =
        s.kpId != null ? kpCourse.get(s.kpId)
        : s.qId != null ? qCourse.get(s.qId)
        : s.cardId != null ? cardCourse.get(s.cardId)
        : undefined;
      return inActiveCourse(cid);
    });
    forecast.value = reviewForecast(activeSchedules, 7);
    Object.assign(wrongSnap, wrongSnapshot(data.wrongQuestions.filter((w) => inActiveCourse(qCourse.get(w.qId)))));
    const today = formatLocalDate();
  const items: TodayTaskItem[] = [];
  for (const c of activeCourses) {
    const plans = data.studyPlans.filter((p) => p.courseId === c.id && p.status !== "paused");
    for (const p of plans) {
      const tasks = data.studyTasks.filter((t) => t.planId === p.id && t.scheduledDate === today);
      for (const t of tasks) {
        items.push({
          id: t.id,
          courseId: c.id,
          kind: "plan",
          planId: t.planId,
          chapterId: t.chapterId,
          kpId: t.kpId ?? null,
          taskType: t.taskType,
          scheduledDate: t.scheduledDate,
          sort: t.sort,
          title: t.title,
          course: c.name,
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
      const card = item.flashcard;
      items.push({
        id: -item.schedule.id,
        courseId: c.id,
        kind: "review",
        planId: 0,
        chapterId: null,
        kpId: item.schedule.kpId,
        taskType: "review",
        scheduledDate: item.schedule.dueTime,
        sort: 0,
        title: kp ? `复习：${kp.name}` : q ? `错题复习：${q.title}` : card ? `闪卡：${truncateText(card.front, 24)}` : `复习 #${item.schedule.id}`,
        course: c.name,
        done: false,
      });
    }
  }
  items.sort((a, b) => Number(a.done) - Number(b.done));
  todayTasks.splice(0, todayTasks.length, ...items);
  applyDefaultExpand();
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : "加载失败";
    console.error("加载首页失败:", e);
  } finally {
    loading.value = false;
  }
}

function openTask(task: TodayTaskItem) {
  const action = taskAction(task);
  if (action) {
    router.push(action.to);
    return;
  }
  router.push("/plan");
  window.siyuanAiStudy.showMessage("该任务无绑定知识点，请在学习计划页处理");
}

async function toggleTask(task: TodayTaskItem) {
  if (pendingTaskIds.value.has(task.id)) return;
  pendingTaskIds.value = new Set(pendingTaskIds.value).add(task.id);
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
  } finally {
    const next = new Set(pendingTaskIds.value);
    next.delete(task.id);
    pendingTaskIds.value = next;
  }
}

useDataSavedRefresh(() => load().catch((e) => console.error("刷新首页失败:", e)));

onMounted(() => {
  load().catch((e) => console.error("加载首页失败:", e));
});
watch(
  () => courseStore.courses.length,
  () => load().catch((e) => console.error("刷新首页失败:", e)),
);
</script>

