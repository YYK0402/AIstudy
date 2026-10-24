<template>
  <div class="page">
    <div class="page-title"><h1>学习计划</h1><div class="desc">按天安排 · 点开查看当天知识点</div></div>

    <div v-if="!currentCourseId()" class="card">
      <div class="empty-state"><span class="ico"><AppIcon name="folder" :size="28" /></span> 请先在「课程主页」选择或创建一个课程</div>
    </div>

    <template v-else>
      <div class="card">
        <h3>
          {{ plan ? (editing ? "重新生成学习计划" : "当前计划") : "生成学习计划" }}
          <span v-if="archived" class="tag paused" style="margin-left:6px">已归档 · 只读</span>
          <template v-if="plan && !editing && !archived">
            <button class="btn primary sm" @click="startEdit"><AppIcon name="spark" :size="14" /> 重新生成</button>
          </template>
          <template v-else-if="plan && editing">
            <button class="btn sm ghost" :disabled="generating" @click="editing = false">取消</button>
            <button class="btn primary sm" :disabled="generating || !targetDate" @click="regenerate">
              <AppIcon name="spark" :size="14" /> {{ generating ? "生成中…" : "确认重新生成" }}
            </button>
          </template>
        </h3>
        <div v-if="(!plan || editing) && !archived" class="plan-form">
          <div class="field">
            <label>开始日期</label>
            <input type="date" v-model="startDate" :min="today" :max="targetDate || undefined" :disabled="generating" />
          </div>
          <div class="field">
            <label>目标日期</label>
            <input type="date" v-model="targetDate" :min="startDate" :disabled="generating" />
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
          <button
            v-if="!plan"
            class="btn primary"
            :disabled="generating || !targetDate"
            :title="targetDate ? '' : '请先选择目标日期'"
            @click="generate"
            style="align-self:flex-start"
          >
            <AppIcon name="spark" :size="14" /> {{ generating ? "生成中…" : "生成学习计划" }}
          </button>
        </div>
        <div v-if="generating" class="s" style="color:var(--as-accent-strong);margin-top:10px">
          ⏳ 生成中… AI 正在根据章节与知识点规划任务，通常需要数十秒，请稍候
        </div>
        <div v-if="generateError" class="s" style="color:var(--as-red);margin-top:10px">✗ {{ generateError }}</div>
        <div v-if="plan && !editing" class="plan-summary">
          <span>{{ plan.dailyHour }} 小时/天</span>
          <span class="sep">·</span>
          <span>{{ plan.startDate }} → {{ plan.targetDate }}</span>
          <template v-for="s in planTypeStats" :key="s.label">
            <span class="sep">·</span>
            <span>{{ s.label }} {{ s.count }}</span>
          </template>
          <span v-if="overdueTasks.length" class="tag overdue">过期 {{ overdueTasks.length }}</span>
          <span class="gen-at">生成于 {{ formatTime(plan.createTime) }}</span>
        </div>
        <div v-if="plan && !editing && !archived" class="plan-ops">
          <button class="btn sm ghost" @click="togglePause">{{ plan.status === "paused" ? "▶ 恢复" : "⏸ 暂停" }}</button>
          <span v-if="plan.status === 'paused'" class="tag paused"><span class="d"></span>已暂停</span>
          <button class="btn sm ghost" :disabled="!!daysOp" @click="openDaysOp('shift')">延期 N 天</button>
          <button class="btn sm ghost" :disabled="!!daysOp" @click="openDaysOp('extend')">延长 N 天</button>
          <button class="btn sm ghost" :disabled="!!daysOp || unscheduledCount === 0" @click="doSync">
            {{ unscheduledCount ? `同步新知识点（${unscheduledCount}）` : "同步新知识点" }}
          </button>
          <template v-if="daysOp">
            <input v-model.number="daysInput" type="number" min="1" step="1" class="days-input" @keyup.enter="applyDaysOp" />
            <button class="btn primary sm" :disabled="!daysInput || daysInput < 1" @click="applyDaysOp">
              {{ daysOp === "shift" ? "确认延期" : "确认延长" }}
            </button>
            <button class="btn sm ghost" @click="daysOp = null">取消</button>
          </template>
        </div>
      </div>

      <div v-if="plan && displayDays.length" class="card" style="margin-top:14px">
        <h3>
          任务列表
          <span class="day-total">共 {{ tasks.length }} 条 · 已完成 {{ doneCount }} 条</span>
        </h3>
        <div
          v-for="d in displayDays"
          :key="d.date"
          class="day-group"
          :class="{ past: d.date !== 'overdue' && d.date < today }"
        >
          <div
            class="day-head"
            :class="{ overdue: d.date === 'overdue', today: d.date === today }"
            @click="d.date !== 'overdue' && toggleDay(d.date)"
          >
            <template v-if="d.date === 'overdue'">
              <span>⚠ 过期 {{ d.tasks.length }} 条 · 未按时完成</span>
              <button
                v-if="!archived"
                class="btn sm primary"
                style="margin-left:auto"
                :disabled="overdueBusy"
                @click.stop="postponeAll"
              >全部顺延到今天</button>
            </template>
            <template v-else>
              <span class="d">{{ d.date }}</span>
              <span class="dow">{{ weekdayOf(d.date) }}</span>
              <span class="day-sum">{{ d.summary }}</span>
              <span class="day-prog">{{ d.doneCount }}/{{ d.tasks.length }} 完成</span>
              <span class="day-prog-wrap"><ProgressBar :value="d.doneCount" :max="d.tasks.length" tone="green" sm /></span>
              <button class="link-btn day-tgl" @click.stop="toggleDay(d.date)">
                {{ isDayOpen(d.date) ? "收起" : "展开" }}
              </button>
            </template>
          </div>
          <div v-if="isDayOpen(d.date)" class="day-body">
            <template v-for="(r, i) in d.rows" :key="i">
              <div v-if="r.kind === 'chapter'" class="day-ch">{{ r.label }}</div>
              <div v-else-if="r.kind === 'unit'" class="day-unit">{{ r.label }}</div>
              <div v-else-if="r.kind === 'kp'" class="kp-row" :class="{ done: r.line.doneAll }">
                <button
                  class="task-check"
                  :disabled="archived || lineBusy(r.line)"
                  :title="archived ? '课程已归档，任务只读' : lineBusy(r.line) ? '保存中…' : r.line.doneAll ? '撤销完成' : '标记完成'"
                  @click.stop="toggleTasks(r.line.tasks)"
                >
                  <span v-if="lineBusy(r.line)" class="task-check-spinner" />
                  <template v-else>{{ r.line.doneAll ? "✓" : r.line.partial ? "–" : "" }}</template>
                </button>
                <span class="kp-name">{{ r.line.name }}</span>
                <span class="kp-types">
                  <span v-for="ty in r.line.types" :key="ty" class="tag" :class="ty">
                    <span class="d"></span>{{ taskTypeLabel(ty) }}
                  </span>
                </span>
                <span class="kp-acts">
                  <router-link
                    v-for="a in lineActions(r.line)"
                    :key="a.label"
                    class="kp-act"
                    :to="a.to"
                  >{{ a.label }} →</router-link>
                  <button
                    v-if="d.date === 'overdue' && !archived"
                    class="btn sm ghost"
                    :disabled="overdueBusy"
                    @click.stop="postponeTasks(r.line.tasks)"
                  >顺延</button>
                </span>
              </div>
              <StudyTaskRow
                v-else
                :title="r.task.title"
                :task-type="r.task.taskType"
                :done="r.task.status === 'done'"
                :disabled="archived"
                :busy="pendingTaskIds.has(r.task.id)"
                :kp-id="r.task.kpId"
                :chapter-id="r.task.chapterId"
                dense
                @toggle="toggleTasks([r.task])"
              >
                <template #extra>
                  <button
                    v-if="d.date === 'overdue' && !archived"
                    class="btn sm ghost"
                    :disabled="overdueBusy"
                    @click.stop="postponeTasks([r.task])"
                  >顺延</button>
                </template>
              </StudyTaskRow>
            </template>
            <template v-if="d.date === today && dueReviews.length">
              <div class="day-ch">间隔复习</div>
              <div v-for="item in dueReviews" :key="'rev' + item.schedule.id" class="kp-row">
                <span class="task-check" style="visibility:hidden"></span>
                <span class="kp-name">{{ reviewLabel(item) }}</span>
                <span class="kp-types"><span class="tag review"><span class="d"></span>复习</span></span>
                <span class="kp-acts">
                  <router-link
                    class="kp-act"
                    :to="item.schedule.kpId != null ? { path: '/review', query: { kp: String(item.schedule.kpId) } } : '/review'"
                  >去复习 →</router-link>
                </span>
              </div>
            </template>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import AppIcon from "../components/AppIcon.vue";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useCourseStore } from "../stores/course";
import {
  generateStudyPlan,
  queryStudyPlans,
  queryStudyTasks,
  setStudyTasksStatus,
  queryChapters,
  queryKnowledgePoints,
  queryDueReviews,
  setPlanStatus,
  shiftPlan,
  extendPlan,
  syncPlanKps,
  postponeOverdueTasks,
  formatLocalDate,
  DATA_SAVED_EVENT,
} from "../api";
import StudyTaskRow from "../components/StudyTaskRow.vue";
import ProgressBar from "../components/ProgressBar.vue";
import { taskTypeLabel } from "../constants/tasks";
import type { StudyPlan, StudyTask, Chapter, KnowledgePoint, ReviewDueItem } from "../api";

const courseStore = useCourseStore();
const currentCourseId = () => courseStore.currentCourseId;
/** 课程归档后计划只读：隐藏生成 / 重生成 / 暂停 / 延期 / 同步入口 */
const archived = computed(() => courseStore.currentCourse?.status === "archived");

const plan = ref<StudyPlan | null>(null);
const tasks = ref<StudyTask[]>([]);
const chapters = ref<Chapter[]>([]);
const knowledgePoints = ref<KnowledgePoint[]>([]);
const dueReviews = ref<ReviewDueItem[]>([]);

const startDate = ref(formatLocalDate());
// 默认目标日期 = 今天 + 30 天，保证首次进入生成按钮即可用
const targetDate = ref(formatLocalDate(new Date(Date.now() + 30 * 86400000)));
const dailyHour = ref("2");
const daysOp = ref<"shift" | "extend" | null>(null);
const daysInput = ref(1);
const generating = ref(false);
const generateError = ref("");
// 已生成计划时默认折叠参数区，点「重新生成」才展开
const editing = ref(false);

// 用本地时区（与 API 层一致），避免 UTC 偏移在凌晨导致日期错一天
const today = formatLocalDate();

const doneCount = computed(() => tasks.value.filter((t) => t.status === "done").length);

interface TaskGroup {
  date: string;
  tasks: StudyTask[];
}

interface KpLine {
  kpId: number;
  name: string;
  chapterId: number | null;
  sort: number;
  types: string[];
  tasks: StudyTask[];
  doneAll: boolean;
  partial: boolean;
}

type DayRow =
  | { kind: "chapter"; label: string }
  | { kind: "unit"; label: string }
  | { kind: "kp"; line: KpLine }
  | { kind: "task"; task: StudyTask };

interface DayView extends TaskGroup {
  rows: DayRow[];
  summary: string;
  doneCount: number;
}

/** 过期任务：未完成且排期早于今天（从历史组中抽出，单独置顶处置） */
const overdueTasks = computed(() => tasks.value.filter((t) => t.status === "todo" && t.scheduledDate < today));

const groupedTasks = computed<TaskGroup[]>(() => {
  const overdueIds = new Set(overdueTasks.value.map((t) => t.id));
  const map = new Map<string, StudyTask[]>();
  for (const t of tasks.value) {
    if (overdueIds.has(t.id)) continue;
    const list = map.get(t.scheduledDate) ?? [];
    list.push(t);
    map.set(t.scheduledDate, list);
  }
  return [...map.entries()]
    .map(([date, list]) => ({ date, tasks: list }))
    .sort((a, b) => a.date.localeCompare(b.date));
});

/** 展示分组：过期组置顶（date 哨兵值 "overdue"），其后按日期升序 */
const displayGroups = computed<TaskGroup[]>(() => {
  if (!overdueTasks.value.length) return groupedTasks.value;
  return [{ date: "overdue", tasks: overdueTasks.value }, ...groupedTasks.value];
});

const overdueBusy = ref(false);
/** 正在写入的任务：防止连点，勾选框显示转圈 */
const pendingTaskIds = ref<Set<number>>(new Set());

function lineBusy(line: { tasks: StudyTask[] }): boolean {
  return line.tasks.some((t) => pendingTaskIds.value.has(t.id));
}

async function postponeAll() {
  if (!plan.value) return;
  overdueBusy.value = true;
  try {
    const { moved } = await postponeOverdueTasks(plan.value.id);
    await load();
    window.siyuanAiStudy.showMessage(`已将 ${moved} 条过期任务顺延到今天`);
  } catch (e) {
    failMsg(e, "顺延过期任务失败");
  } finally {
    overdueBusy.value = false;
  }
}

/** 未排期知识点数：课程 KP 中无 learn 任务覆盖的数量（与 syncPlanKps 口径一致） */
const unscheduledCount = computed(() => {
  const covered = new Set(tasks.value.filter((t) => t.taskType === "learn" && t.kpId != null).map((t) => t.kpId));
  return knowledgePoints.value.filter((kp) => !covered.has(kp.id)).length;
});

/** 日摘要行：默认全部收起（今日除外），任务集变化时重置（nextId 按列表算，重新生成的计划可能复用旧 id，故不能只按 planId 判重） */
const collapsedDays = ref<Set<string>>(new Set());
let loadedTasksKey = "";

function isDayOpen(date: string): boolean {
  return date === "overdue" || !collapsedDays.value.has(date);
}

function toggleDay(date: string) {
  const s = new Set(collapsedDays.value);
  if (s.has(date)) {
    s.delete(date);
  } else {
    s.add(date);
  }
  collapsedDays.value = s;
}

function tasksKey(): string {
  if (!plan.value) return "";
  const ids = [...tasks.value].map((t) => t.id).sort((a, b) => a - b).join(",");
  return `${plan.value.id}:${ids}`;
}

function applyDefaultCollapse() {
  const key = tasksKey();
  if (key === loadedTasksKey) return;
  loadedTasksKey = key;
  const dates = new Set(tasks.value.map((t) => t.scheduledDate));
  collapsedDays.value = new Set([...dates].filter((d) => d !== today));
}

function weekdayOf(date: string): string {
  return "周" + "日一二三四五六"[new Date(date + "T00:00:00").getDay()];
}

/** 任务类型展示顺序（学 → 练 → 复 → 测） */
const TYPE_ORDER = ["learn", "practice", "review", "test"];

/** 有知识点的任务按「知识点+类型」去重；无知识点的任务（测评/整体复习）按条数计 */
function countTaskTypes(list: StudyTask[]): Record<string, number> {
  const seen = new Set<string>();
  const counts: Record<string, number> = { learn: 0, practice: 0, review: 0, test: 0 };
  for (const t of list) {
    if (t.kpId == null) {
      counts[t.taskType] = (counts[t.taskType] ?? 0) + 1;
      continue;
    }
    const key = `${t.kpId}:${t.taskType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    counts[t.taskType] = (counts[t.taskType] ?? 0) + 1;
  }
  return counts;
}

function summaryText(list: StudyTask[]): string {
  const c = countTaskTypes(list);
  const parts: string[] = [];
  if (c.learn) parts.push(`新知 ${c.learn}`);
  if (c.practice) parts.push(`练习 ${c.practice}`);
  if (c.review) parts.push(`复习 ${c.review}`);
  if (c.test) parts.push(`测评 ${c.test}`);
  return parts.join(" · ") || "无任务";
}

/** 同日同知识点的任务合并成一行（勾选即整行完成/撤销） */
function buildKpLines(list: StudyTask[]): KpLine[] {
  const map = new Map<number, StudyTask[]>();
  for (const t of list) {
    if (t.kpId == null) continue;
    const bucket = map.get(t.kpId) ?? [];
    bucket.push(t);
    map.set(t.kpId, bucket);
  }
  return [...map.entries()].map(([kpId, bucket]) => {
    const kp = knowledgePoints.value.find((k) => k.id === kpId) ?? null;
    const done = bucket.filter((t) => t.status === "done").length;
    return {
      kpId,
      name: kp ? kp.name : `#${kpId}（已删除）`,
      chapterId: kp?.chapterId ?? null,
      sort: kp?.sort ?? 0,
      types: [...new Set(bucket.map((t) => t.taskType))].sort(
        (a, b) => TYPE_ORDER.indexOf(a) - TYPE_ORDER.indexOf(b),
      ),
      tasks: bucket,
      doneAll: done === bucket.length,
      partial: done > 0 && done < bucket.length,
    };
  });
}

/** 当日详情行：章 → 节 → 知识点（教材序），末尾单列无知识点的测评任务 */
function buildDayRows(list: StudyTask[]): DayRow[] {
  const lines = buildKpLines(list);
  const topLevel = chapters.value.filter((c) => c.level === "chapter").sort((a, b) => a.sort - b.sort);
  const rows: DayRow[] = [];
  const covered = new Set<number>();
  for (const ch of topLevel) {
    const unitNodes = chapters.value.filter((c) => c.parentId === ch.id).sort((a, b) => a.sort - b.sort);
    const inCh = lines.filter(
      (n) => n.chapterId != null && (n.chapterId === ch.id || unitNodes.some((u) => u.id === n.chapterId)),
    );
    if (!inCh.length) continue;
    rows.push({ kind: "chapter", label: ch.name });
    for (const u of unitNodes) {
      const kps = inCh.filter((n) => n.chapterId === u.id).sort((a, b) => a.sort - b.sort);
      if (!kps.length) continue;
      rows.push({ kind: "unit", label: u.name });
      for (const line of kps) rows.push({ kind: "kp", line });
    }
    for (const line of inCh.filter((n) => n.chapterId === ch.id).sort((a, b) => a.sort - b.sort)) {
      rows.push({ kind: "kp", line });
    }
    inCh.forEach((n) => covered.add(n.kpId));
  }
  for (const line of lines.filter((n) => !covered.has(n.kpId)).sort((a, b) => a.sort - b.sort)) {
    rows.push({ kind: "kp", line });
  }
  // 无知识点的任务单独归组：整体复习/练习 → 「其他任务」，测评 → 「测评」
  const noKp = list.filter((t) => t.kpId == null).sort((a, b) => a.sort - b.sort);
  const others = noKp.filter((t) => t.taskType !== "test");
  const tests = noKp.filter((t) => t.taskType === "test");
  if (others.length) {
    rows.push({ kind: "chapter", label: "其他任务" });
    for (const t of others) rows.push({ kind: "task", task: t });
  }
  if (tests.length) {
    rows.push({ kind: "chapter", label: "测评" });
    for (const t of tests) rows.push({ kind: "task", task: t });
  }
  return rows;
}

/** 展示用天视图：预计算详情行/摘要/完成数，模板只做渲染 */
const displayDays = computed<DayView[]>(() =>
  displayGroups.value.map((g) => ({
    ...g,
    rows: buildDayRows(g.tasks),
    summary: summaryText(g.tasks),
    doneCount: g.tasks.filter((t) => t.status === "done").length,
  })),
);

/** 计划整体规模：按知识点+类型去重（测评按任务条数） */
const planTypeStats = computed(() => {
  const c = countTaskTypes(tasks.value);
  return [
    { label: "新知", count: c.learn },
    { label: "练习", count: c.practice },
    { label: "复习", count: c.review },
    { label: "测评", count: c.test },
  ].filter((x) => x.count > 0);
});

/** 知识点行操作入口：每种当日任务类型给一个跳转 */
function lineActions(line: KpLine): { to: { path: string; query: Record<string, string> }; label: string }[] {
  const map: Record<string, { path: string; label: string }> = {
    learn: { path: "/study", label: "去学习" },
    practice: { path: "/quiz", label: "去刷题" },
    review: { path: "/review", label: "去复习" },
  };
  return line.types
    .filter((ty) => map[ty])
    .map((ty) => ({ to: { path: map[ty].path, query: { kp: String(line.kpId) } }, label: map[ty].label }));
}

function reviewLabel(item: ReviewDueItem): string {
  if (item.knowledgePoint) return `复习：${item.knowledgePoint.name}`;
  if (item.question) return `错题复习：${item.question.title}`;
  return `复习 #${item.schedule.id}`;
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
    knowledgePoints.value = [];
    dueReviews.value = [];
    return;
  }
  const plans = await queryStudyPlans(currentCourseId());
  plan.value = plans[0] ?? null;
  tasks.value = plan.value ? await queryStudyTasks(plan.value.id) : [];
  applyDefaultCollapse();
  [chapters.value, knowledgePoints.value, dueReviews.value] = await Promise.all([
    queryChapters(currentCourseId()),
    queryKnowledgePoints(currentCourseId()),
    queryDueReviews(currentCourseId()),
  ]);
}

async function generate() {
  if (!currentCourseId()) return;
  if (!startDate.value || !targetDate.value) {
    window.siyuanAiStudy.showMessage("请先选择开始与目标日期", 4000, "error");
    return;
  }
  // 覆盖式生成会清除旧计划任务，有任务时先确认
  if (plan.value && tasks.value.length > 0) {
    const done = tasks.value.filter((t) => t.status === "done").length;
    const msg = `重新生成将清除现有 ${tasks.value.length} 条任务（含已完成 ${done} 条），确定继续？`;
    if (!window.confirm(msg)) return;
  }
  generating.value = true;
  generateError.value = "";
  try {
    const { plan: newPlan, tasks: newTasks } = await generateStudyPlan(currentCourseId(), {
      startDate: startDate.value,
      targetDate: targetDate.value,
      dailyHour: dailyHour.value,
    });
    plan.value = newPlan;
    tasks.value = newTasks;
    applyDefaultCollapse();
    editing.value = false;
  } catch (e) {
    generateError.value = e instanceof Error ? e.message : String(e);
  } finally {
    generating.value = false;
  }
}

function startEdit() {
  // 展开参数区，并以当前计划值初始化（参数此前被折叠，需可见来源）
  if (plan.value) {
    startDate.value = plan.value.startDate ?? formatLocalDate();
    targetDate.value = plan.value.targetDate;
    dailyHour.value = String(plan.value.dailyHour);
  }
  editing.value = true;
}

async function regenerate() {
  // 重新生成沿用表单参数，可能被用户修改
  await generate();
}

function openDaysOp(op: "shift" | "extend") {
  daysOp.value = op;
  daysInput.value = 1;
}

function failMsg(e: unknown, fallback: string) {
  console.error(fallback + ":", e);
  window.siyuanAiStudy.showMessage(e instanceof Error ? e.message : fallback, 4000, "error");
}

async function togglePause() {
  if (!plan.value) return;
  const next: "active" | "paused" = plan.value.status === "paused" ? "active" : "paused";
  try {
    plan.value = await setPlanStatus(plan.value.id, next);
  } catch (e) {
    failMsg(e, "更新计划状态失败");
  }
}

async function applyDaysOp() {
  if (!plan.value || !daysOp.value) return;
  const op = daysOp.value;
  const n = daysInput.value;
  try {
    let msg: string;
    if (op === "shift") {
      const { moved } = await shiftPlan(plan.value.id, n);
      msg = `已延期 ${n} 天：${moved} 条未完成任务后移`;
    } else {
      const { redistributed } = await extendPlan(plan.value.id, n);
      msg = `已延长 ${n} 天：${redistributed} 条学习任务重铺`;
    }
    daysOp.value = null;
    await load();
    window.siyuanAiStudy.showMessage(msg);
  } catch (e) {
    failMsg(e, op === "shift" ? "延期失败" : "延长失败");
  }
}

async function doSync() {
  if (!plan.value) return;
  try {
    const { added } = await syncPlanKps(plan.value.id);
    if (added === 0) {
      window.siyuanAiStudy.showMessage("没有需要同步的新知识点");
      return;
    }
    await load();
    window.siyuanAiStudy.showMessage(`已同步 ${added} 个新知识点到计划`);
  } catch (e) {
    failMsg(e, "同步新知识点失败");
  }
}

/** 整行勾选：未全完成 → 全部标记完成；已全完成 → 全部撤销 */
async function toggleTasks(list: StudyTask[]) {
  if (!list.length || archived.value) return;
  if (list.some((t) => pendingTaskIds.value.has(t.id))) return;
  const next: "todo" | "done" = list.every((t) => t.status === "done") ? "todo" : "done";
  const ids = list.filter((t) => t.status !== next).map((t) => t.id);
  if (ids.length === 0) return;
  pendingTaskIds.value = new Set([...pendingTaskIds.value, ...list.map((t) => t.id)]);
  // setStudyTasksStatus 会就地改后端对象，失败时必须把行状态恢复回点击前
  const snapshot = list.map((t) => ({ task: t, status: t.status }));
  try {
    await setStudyTasksStatus(ids, next);
    for (const t of list) t.status = next;
  } catch (e) {
    for (const { task, status } of snapshot) task.status = status;
    console.error("更新任务状态失败:", e);
    window.siyuanAiStudy.showMessage(e instanceof Error ? e.message : "更新任务状态失败", 4000, "error");
  } finally {
    const nextPending = new Set(pendingTaskIds.value);
    for (const t of list) nextPending.delete(t.id);
    pendingTaskIds.value = nextPending;
  }
}

/** 过期行顺延：逐条调用（同知识点可能有多条过期任务） */
async function postponeTasks(list: StudyTask[]) {
  if (!plan.value || !list.length) return;
  overdueBusy.value = true;
  try {
    for (const t of list) {
      if (t.status === "todo" && t.scheduledDate < today) {
        await postponeOverdueTasks(plan.value.id, t.id);
      }
    }
    await load();
    window.siyuanAiStudy.showMessage("已顺延到今天");
  } catch (e) {
    failMsg(e, "顺延失败");
  } finally {
    overdueBusy.value = false;
  }
}

watch(
  () => courseStore.currentCourseId,
  () => {
    generateError.value = "";
    editing.value = false;
    load();
  },
);

function onDataSaved() {
  load().catch((e) => console.error("刷新学习计划失败:", e));
}

onMounted(() => {
  load();
  window.addEventListener(DATA_SAVED_EVENT, onDataSaved);
});
onBeforeUnmount(() => {
  window.removeEventListener(DATA_SAVED_EVENT, onDataSaved);
});
</script>
