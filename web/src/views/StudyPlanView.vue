<template>
  <div class="page">
    <div class="page-title"><h1>学习计划</h1><div class="desc">按章节拆分每日任务 · 支持手动调整</div></div>

    <div v-if="!currentCourseId()" class="card">
      <div class="empty-state"><span class="ico">📭</span> 请先在「课程主页」选择或创建一个课程</div>
    </div>

    <template v-else>
      <div class="card">
        <h3>
          {{ plan ? (editing ? "重新生成学习计划" : "当前计划") : "生成学习计划" }}
          <span v-if="archived" class="tag paused" style="margin-left:6px">已归档 · 只读</span>
          <template v-if="plan && !editing && !archived">
            <span class="s" style="font-weight:400">{{ plan.dailyHour }} 小时/天 · 目标 {{ plan.targetDate }}</span>
            <span v-if="overdueTasks.length" class="tag overdue" style="margin-left:6px">过期 {{ overdueTasks.length }}</span>
            <button class="btn primary sm" @click="startEdit">⚡ 重新生成</button>
          </template>
          <template v-else-if="plan && editing">
            <button class="btn sm ghost" :disabled="generating" @click="editing = false">取消</button>
            <button class="btn primary sm" :disabled="generating || !targetDate" @click="regenerate">
              {{ generating ? "生成中…" : "确认重新生成" }}
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
            {{ generating ? "生成中…" : "⚡ 生成学习计划" }}
          </button>
        </div>
        <div v-if="generating" class="s" style="color:var(--as-accent-strong);margin-top:10px">
          ⏳ 生成中… AI 正在根据章节与知识点规划任务，通常需要数十秒，请稍候
        </div>
        <div v-if="generateError" class="s" style="color:var(--as-red);margin-top:10px">✗ {{ generateError }}</div>
        <div v-if="plan && !editing" class="plan-meta">
          {{ plan.startDate ? `${plan.startDate} → ` : "" }}生成于 {{ formatTime(plan.createTime) }}
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

      <div v-if="plan && displayGroups.length" class="card" style="margin-top:14px">
        <h3>任务列表
          <span style="margin-left:auto;font-size:11px;color:var(--as-text-faint)">
            共 {{ tasks.length }} 条 · 已完成 {{ doneCount }} 条
          </span>
        </h3>
        <div v-for="g in displayGroups" :key="g.date" class="task-group" :class="{ past: g.date !== 'overdue' && g.date < today }">
          <div
            class="task-date"
            :class="{ overdue: g.date === 'overdue', dim: g.date !== 'overdue' && g.date < today, today: g.date === today, open: isDayOpen(g.date) }"
            @click="g.date !== 'overdue' && toggleDay(g.date)"
          >
            <template v-if="g.date === 'overdue'">⚠ 过期 {{ g.tasks.length }} 条 · 未按时完成</template>
            <template v-else>
              <span class="d">{{ g.date }}</span>
              <span class="dow">{{ weekdayOf(g.date) }}</span>
              <span class="sum">学{{ countType(g, "learn") }} · 练{{ countType(g, "practice") }} · 复{{ countType(g, "review") }} · 测{{ countType(g, "test") }}</span>
              <span class="prog">{{ doneOf(g) }}/{{ g.tasks.length }} 完成</span>
              <button class="link-btn" @click.stop="kpPanelDay = kpPanelDay === g.date ? null : g.date">
                涉及知识点 ({{ kpsOfGroup(g).count }}) {{ kpPanelDay === g.date ? "▾" : "▸" }}
              </button>
              <span class="task-chev">{{ isDayOpen(g.date) ? "▾" : "▸" }}</span>
            </template>
            <button
              v-if="g.date === 'overdue' && !archived"
              class="btn sm primary"
              :disabled="overdueBusy"
              @click.stop="postponeAll"
            >全部顺延到今天</button>
          </div>
          <div v-if="kpPanelDay === g.date" class="kp-involved">
            <template v-for="ch in kpsOfGroup(g).chapters" :key="ch.name">
              <div class="ki-ch">{{ ch.name }}</div>
              <template v-for="u in ch.units" :key="u.name">
                <div class="ki-unit">{{ u.name }}</div>
                <div v-for="n in u.kps" :key="n.kpId" class="ki-kp">
                  <span>{{ n.name }}</span>
                  <span class="ki-types">{{ n.types.map(taskTypeLabel).join(" · ") }}</span>
                </div>
              </template>
              <div v-for="n in ch.direct" :key="'d' + n.kpId" class="ki-kp">
                <span>{{ n.name }}</span>
                <span class="ki-types">{{ n.types.map(taskTypeLabel).join(" · ") }}</span>
              </div>
            </template>
            <div v-for="n in kpsOfGroup(g).loose" :key="'l' + n.kpId" class="ki-kp ki-loose">
              <span>{{ n.name }}</span>
              <span class="ki-types">{{ n.types.map(taskTypeLabel).join(" · ") }}</span>
            </div>
          </div>
          <div v-if="isDayOpen(g.date)" class="task-list">
            <template v-for="t in g.tasks" :key="t.id">
              <div class="task-item">
                <div
                  class="task-row"
                  :class="{ done: t.status === 'done', overdue: g.date === 'overdue', expanded: expandedTaskId === t.id }"
                  @click="toggleExpand(t)"
                >
                  <button class="task-check" :disabled="archived" :title="archived ? '课程已归档，任务只读' : t.status === 'done' ? '撤销完成' : '标记完成'" @click.stop="toggleTask(t)">
                    {{ t.status === "done" ? "✓" : "" }}
                  </button>
                  <div class="task-main">
                    <div class="task-title">{{ t.title }}</div>
                    <div class="task-meta">
                      <span class="tag" :class="t.taskType">
                        <span class="d"></span>{{ taskTypeLabel(t.taskType) }}
                      </span>
                      <span v-if="t.chapterId && chapterName(t.chapterId)" class="s">《{{ chapterName(t.chapterId) }}》</span>
                      <span v-if="g.date === 'overdue'" class="s overdue-s">原定 {{ t.scheduledDate }}</span>
                    </div>
                  </div>
                  <button
                    v-if="g.date === 'overdue' && !archived"
                    class="btn sm ghost"
                    :disabled="overdueBusy"
                    @click.stop="postponeOne(t)"
                  >顺延到今天</button>
                  <router-link
                    v-if="taskAction(t)"
                    class="task-act"
                    :to="taskAction(t)!.to"
                    @click.stop
                  >{{ taskAction(t)!.label }}</router-link>
                  <span class="task-chev">{{ expandedTaskId === t.id ? "▾" : "▸" }}</span>
                </div>
                <div v-if="expandedTaskId === t.id" class="task-detail">
                  <div><span class="k">章节</span>{{ taskDetail(t).chapter }}</div>
                  <div><span class="k">知识点</span>{{ taskDetail(t).kpName }}</div>
                  <div v-if="taskDetail(t).kpContent" class="task-detail-content">{{ taskDetail(t).kpContent }}</div>
                  <div><span class="k">排期</span>{{ t.scheduledDate }}</div>
                </div>
              </div>
            </template>
            <template v-if="g.date === today">
              <div v-for="item in dueReviews" :key="'rev' + item.schedule.id" class="task-row review-due-row">
                <span class="task-check" style="visibility:hidden"></span>
                <div class="task-main">
                  <div class="task-title">
                    {{ item.knowledgePoint ? `复习：${item.knowledgePoint.name}` : item.question ? `错题复习：${item.question.title}` : `复习 #${item.schedule.id}` }}
                  </div>
                  <div class="task-meta">
                    <span class="tag review"><span class="d"></span>间隔复习</span>
                  </div>
                </div>
                <router-link
                  class="task-act"
                  :to="item.schedule.kpId != null ? { path: '/review', query: { kp: String(item.schedule.kpId) } } : '/review'"
                >去复习</router-link>
              </div>
            </template>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useCourseStore } from "../stores/course";
import {
  generateStudyPlan,
  queryStudyPlans,
  queryStudyTasks,
  updateStudyTask,
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

const expandedTaskId = ref<number | null>(null);
function toggleExpand(t: StudyTask) {
  expandedTaskId.value = expandedTaskId.value === t.id ? null : t.id;
}

/** 任务下钻详情：章节 / 知识点（名称+内容） */
function taskDetail(t: StudyTask) {
  const kp = t.kpId != null ? knowledgePoints.value.find((k) => k.id === t.kpId) ?? null : null;
  return {
    chapter: t.chapterId && chapterName(t.chapterId) ? `《${chapterName(t.chapterId)}》` : "未分章",
    kpName: kp ? kp.name : t.kpId != null ? `#${t.kpId}（已删除）` : "全课程",
    kpContent: kp?.content ?? "",
  };
}

const overdueBusy = ref(false);

async function postponeOne(t: StudyTask) {
  if (!plan.value) return;
  try {
    await postponeOverdueTasks(plan.value.id, t.id);
    await load();
    window.siyuanAiStudy.showMessage("已顺延到今天");
  } catch (e) {
    failMsg(e, "顺延失败");
  }
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

const taskTypeLabel = (t: string): string => {
  const map: Record<string, string> = { learn: "新知", review: "复习", practice: "练习", test: "测评" };
  return map[t] ?? t;
};

/** 任务行专属去处：学→双栏学习 / 练→专项刷题 / 复→定向复习 / 测→章节组卷或结业模考 */
function taskAction(t: StudyTask): { to: { path: string; query: Record<string, string> }; label: string } | null {
  if (t.taskType === "learn" && t.kpId != null) {
    return { to: { path: "/study", query: { kp: String(t.kpId) } }, label: "去学习" };
  }
  if (t.taskType === "practice" && t.kpId != null) {
    return { to: { path: "/quiz", query: { kp: String(t.kpId) } }, label: "去刷题" };
  }
  if (t.taskType === "review" && t.kpId != null) {
    return { to: { path: "/review", query: { kp: String(t.kpId) } }, label: "去复习" };
  }
  if (t.taskType === "test") {
    const query: Record<string, string> = t.chapterId ? { set: String(t.chapterId) } : { exam: "1" };
    return { to: { path: "/quiz", query }, label: "去测评" };
  }
  return null;
}

/** 日摘要行：默认全部收起（今日除外），任务集变化时重置（nextId 按列表算，重新生成的计划可能复用旧 id，故不能只按 planId 判重） */
const collapsedDays = ref<Set<string>>(new Set());
const kpPanelDay = ref<string | null>(null);
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
  kpPanelDay.value = null;
}

function weekdayOf(date: string): string {
  return "周" + "日一二三四五六"[new Date(date + "T00:00:00").getDay()];
}

function countType(g: TaskGroup, type: string): number {
  return g.tasks.filter((t) => t.taskType === type).length;
}

function doneOf(g: TaskGroup): number {
  return g.tasks.filter((t) => t.status === "done").length;
}

interface KpInvolvedNode {
  kpId: number;
  name: string;
  types: string[];
  sort: number;
}

interface KpUnitNode {
  name: string;
  kps: KpInvolvedNode[];
}

interface KpChapterNode {
  name: string;
  units: KpUnitNode[];
  direct: KpInvolvedNode[];
}

/** 该日任务涉及的知识点，按 章→节→知识点（教材序）归组，附任务类型徽标 */
function kpsOfGroup(g: TaskGroup): { chapters: KpChapterNode[]; loose: KpInvolvedNode[]; count: number } {
  const typeMap = new Map<number, Set<string>>();
  for (const t of g.tasks) {
    if (t.kpId == null) continue;
    const s = typeMap.get(t.kpId) ?? new Set<string>();
    s.add(t.taskType);
    typeMap.set(t.kpId, s);
  }
  const kpNodes: (KpInvolvedNode & { chapterId: number | null })[] = [...typeMap.entries()].map(([id, types]) => {
    const kp = knowledgePoints.value.find((k) => k.id === id) ?? null;
    return {
      kpId: id,
      name: kp ? kp.name : `#${id}（已删除）`,
      types: [...types],
      sort: kp?.sort ?? 0,
      chapterId: kp?.chapterId ?? null,
    };
  });
  const topLevel = chapters.value.filter((c) => c.level === "chapter").sort((a, b) => a.sort - b.sort);
  const out: KpChapterNode[] = [];
  const covered = new Set<number>();
  for (const ch of topLevel) {
    const unitNodes = chapters.value.filter((c) => c.parentId === ch.id).sort((a, b) => a.sort - b.sort);
    const inCh = kpNodes.filter(
      (n) => n.chapterId != null && (n.chapterId === ch.id || unitNodes.some((u) => u.id === n.chapterId)),
    );
    if (!inCh.length) continue;
    const units: KpUnitNode[] = [];
    for (const u of unitNodes) {
      const kps = inCh.filter((n) => n.chapterId === u.id).sort((a, b) => a.sort - b.sort);
      if (kps.length) units.push({ name: u.name, kps });
    }
    const direct = inCh.filter((n) => n.chapterId === ch.id).sort((a, b) => a.sort - b.sort);
    out.push({ name: ch.name, units, direct });
    inCh.forEach((n) => covered.add(n.kpId));
  }
  const loose = kpNodes.filter((n) => !covered.has(n.kpId)).sort((a, b) => a.sort - b.sort);
  return { chapters: out, loose, count: kpNodes.length };
}

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

async function toggleTask(t: StudyTask) {
  try {
    await updateStudyTask({ ...t, status: t.status === "done" ? "todo" : "done" });
    t.status = t.status === "done" ? "todo" : "done";
  } catch (e) {
    console.error("更新任务状态失败:", e);
    window.siyuanAiStudy.showMessage(e instanceof Error ? e.message : "更新任务状态失败", 4000, "error");
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
