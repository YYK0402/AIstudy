<template>
  <div class="page">
    <div class="page-title"><h1>学习计划</h1><div class="desc">按章节拆分每日任务 · 支持手动调整</div></div>

    <div v-if="!currentCourseId()" class="card">
      <div class="empty-state"><span class="ico">📭</span> 请先在「课程主页」选择或创建一个课程</div>
    </div>

    <template v-else>
      <div class="card">
        <h3>
          {{ plan ? "当前计划参数" : "生成学习计划" }}
          <button v-if="plan" class="btn primary sm" :disabled="generating" @click="regenerate" style="margin-left:auto">
            {{ generating ? "生成中…" : "⚡ 重新生成" }}
          </button>
        </h3>
        <div class="plan-form">
          <div class="field">
            <label>目标日期</label>
            <input type="date" v-model="targetDate" :min="today" :disabled="generating" />
          </div>
          <div class="field">
            <label>每日学习时长</label>
            <select v-model="dailyHour" :disabled="generating">
              <option value="1">1 小时</option>
              <option value="2">2 小时</option>
              <option value="3">3 小时</option>
              <option value="4">4 小时</option>
            </select>
          </div>
          <button v-if="!plan" class="btn primary" :disabled="generating || !targetDate" @click="generate" style="align-self:flex-start">
            {{ generating ? "生成中…" : "⚡ 生成学习计划" }}
          </button>
        </div>
        <div v-if="generateError" class="s" style="color:var(--as-red);margin-top:10px">✗ {{ generateError }}</div>
        <div v-if="plan" class="plan-meta">
          每日 {{ plan.dailyHour }} 小时 · 目标 {{ plan.targetDate }} · 生成于 {{ formatTime(plan.createTime) }}
        </div>
      </div>

      <div v-if="plan && groupedTasks.length" class="card" style="margin-top:14px">
        <h3>任务列表
          <span style="margin-left:auto;font-size:11px;color:var(--as-text-faint)">
            共 {{ tasks.length }} 条 · 已完成 {{ doneCount }} 条
          </span>
        </h3>
        <div v-for="g in groupedTasks" :key="g.date" class="task-group">
          <div class="task-date" :class="{ overdue: g.date < today, today: g.date === today }">{{ g.date }}</div>
          <div class="task-list">
            <div v-for="t in g.tasks" :key="t.id" class="task-row" :class="{ done: t.status === 'done' }">
              <button class="task-check" :title="t.status === 'done' ? '撤销完成' : '标记完成'" @click="toggleTask(t)">
                {{ t.status === "done" ? "✓" : "" }}
              </button>
              <div class="task-main">
                <div class="task-title">{{ t.title }}</div>
                <div class="task-meta">
                  <span class="tag" :class="t.taskType">
                    <span class="d"></span>{{ taskTypeLabel(t.taskType) }}
                  </span>
                  <span v-if="t.chapterId && chapterName(t.chapterId)" class="s">《{{ chapterName(t.chapterId) }}》</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useCourseStore } from "../stores/course";
import {
  generateStudyPlan,
  queryStudyPlans,
  queryStudyTasks,
  updateStudyTask,
  queryChapters,
} from "../api";
import type { StudyPlan, StudyTask, Chapter } from "../api";

const courseStore = useCourseStore();
const currentCourseId = () => courseStore.currentCourseId;

const plan = ref<StudyPlan | null>(null);
const tasks = ref<StudyTask[]>([]);
const chapters = ref<Chapter[]>([]);
const targetDate = ref("");
const dailyHour = ref("2");
const generating = ref(false);
const generateError = ref("");

const today = new Date().toISOString().slice(0, 10);

const doneCount = computed(() => tasks.value.filter((t) => t.status === "done").length);

interface TaskGroup {
  date: string;
  tasks: StudyTask[];
}

const groupedTasks = computed<TaskGroup[]>(() => {
  const map = new Map<string, StudyTask[]>();
  for (const t of tasks.value) {
    const list = map.get(t.scheduledDate) ?? [];
    list.push(t);
    map.set(t.scheduledDate, list);
  }
  return [...map.entries()]
    .map(([date, list]) => ({ date, tasks: list }))
    .sort((a, b) => b.date.localeCompare(a.date));
});

const taskTypeLabel = (t: string): string => {
  const map: Record<string, string> = { learn: "学习", review: "复习", practice: "练习" };
  return map[t] ?? t;
};

function chapterName(id: number): string {
  return chapters.value.find((c) => c.id === id)?.name ?? "";
}

function formatTime(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

async function load() {
  if (!currentCourseId()) {
    plan.value = null;
    tasks.value = [];
    chapters.value = [];
    return;
  }
  const plans = await queryStudyPlans(currentCourseId());
  plan.value = plans[0] ?? null;
  tasks.value = plan.value ? await queryStudyTasks(plan.value.id) : [];
  chapters.value = await queryChapters(currentCourseId());
}

async function generate() {
  if (!currentCourseId() || !targetDate.value) return;
  generating.value = true;
  generateError.value = "";
  try {
    const { plan: newPlan, tasks: newTasks } = await generateStudyPlan(currentCourseId(), {
      targetDate: targetDate.value,
      dailyHour: dailyHour.value,
    });
    plan.value = newPlan;
    tasks.value = newTasks;
  } catch (e) {
    generateError.value = e instanceof Error ? e.message : String(e);
  } finally {
    generating.value = false;
  }
}

async function regenerate() {
  // 重新生成沿用表单参数，可能被用户修改
  await generate();
}

async function toggleTask(t: StudyTask) {
  try {
    await updateStudyTask({ ...t, status: t.status === "done" ? "todo" : "done" });
    t.status = t.status === "done" ? "todo" : "done";
  } catch (e) {
    console.error("更新任务状态失败:", e);
  }
}

watch(
  () => courseStore.currentCourseId,
  () => {
    generateError.value = "";
    load();
  },
);

onMounted(load);
</script>
