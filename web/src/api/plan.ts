import type { AppData, Chapter, KnowledgePoint, StudyPlan, StudyTask } from "../types/appData";
import { getData, saveData } from "./storage";
import { formatLocalDate, nextId, now } from "./format";
import { findTaskBinding, callAi } from "./ai";
import { resolvePromptTemplate, renderPrompt } from "./promptTemplates";
import { startBgTask } from "./bgTask";
import { courseTaskId } from "../stores/notify";
import { appendWeakPointTaskInData, completeKpTasksInData, logStudyInData } from "./studyData";
import { hasActiveExtract } from "./extractState";
import { countPlanDays, distributeKpsByDay } from "./planSchedule";

// learn 骨架由系统确定性生成（100% 挂 kpId），AI 只负责穿插 review/practice 补充任务
interface AiPlanExtraItem {
  date: string;
  taskType: "review" | "practice";
  kpId: number;
  title: string;
}

interface StudyPlanWithTasks {
  plan: StudyPlan;
  tasks: StudyTask[];
}

function parseAiPlanExtraResponse(content: string): AiPlanExtraItem[] {
  const trimmed = content.trim();
  const jsonMatch =
    trimmed.match(/```(?:json)?\s*([\s\S]*?)```/) ||
    trimmed.match(/(\[[\s\S]*\])/);
  const candidate = (jsonMatch ? jsonMatch[1] : trimmed).trim();
  try {
    const parsed = JSON.parse(candidate);
    if (!Array.isArray(parsed)) return [];
    const valid: AiPlanExtraItem[] = [];
    for (const it of parsed) {
      if (!it || typeof it.date !== "string") continue;
      // 日期必须是合法的 YYYY-MM-DD，否则分组与过期判断会错乱
      if (!/^\d{4}-\d{2}-\d{2}$/.test(it.date) || Number.isNaN(new Date(it.date).getTime())) continue;
      const taskType = it.taskType;
      if (taskType !== "review" && taskType !== "practice") continue;
      const kpId = Number(it.kpId);
      valid.push({
        date: it.date,
        taskType,
        kpId: Number.isFinite(kpId) && kpId > 0 ? kpId : 0,
        title: typeof it.title === "string" ? it.title.trim() : "",
      });
    }
    return valid;
  } catch {
    return [];
  }
}

export async function queryStudyPlans(courseId: number): Promise<StudyPlan[]> {
  const data = await getData();
  return data.studyPlans
    .filter((p) => p.courseId === courseId)
    .sort((a, b) => b.id - a.id);
}

export async function queryStudyTasks(planId: number): Promise<StudyTask[]> {
  const data = await getData();
  return data.studyTasks
    .filter((t) => t.planId === planId)
    .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate) || a.sort - b.sort);
}

export async function updateStudyTask(task: StudyTask): Promise<void> {
  const data = await getData();
  const idx = data.studyTasks.findIndex((t) => t.id === task.id);
  if (idx >= 0) {
    const prev = data.studyTasks[idx];
    data.studyTasks[idx] = task;
    // 手动打卡（todo → done）：记一条 0 秒日志，让打卡动作进入时长趋势
    if (prev.status === "todo" && task.status === "done") {
      const plan = data.studyPlans.find((p) => p.id === task.planId);
      if (plan) {
        logStudyInData(data, { courseId: plan.courseId, kpId: task.kpId, taskId: task.id, action: "task_done", durationSec: 0 });
      }
    }
    await saveData(data);
  }
}

/** 批量设置任务状态：学习计划按知识点合并勾选时一次写盘，避免逐条 saveData */
export async function setStudyTasksStatus(ids: number[], status: "todo" | "done"): Promise<void> {
  if (ids.length === 0) return;
  const data = await getData();
  const idSet = new Set(ids);
  let changed = false;
  for (const t of data.studyTasks) {
    if (!idSet.has(t.id) || t.status === status) continue;
    // 手动打卡（todo → done）：记一条 0 秒日志，让打卡动作进入时长趋势
    if (status === "done") {
      const plan = data.studyPlans.find((p) => p.id === t.planId);
      if (plan) {
        logStudyInData(data, { courseId: plan.courseId, kpId: t.kpId, taskId: t.id, action: "task_done", durationSec: 0 });
      }
    }
    t.status = status;
    changed = true;
  }
  if (changed) {
    await saveData(data);
  }
}

export async function deleteStudyPlan(planId: number): Promise<void> {
  const data = await getData();
  data.studyPlans = data.studyPlans.filter((p) => p.id !== planId);
  data.studyTasks = data.studyTasks.filter((t) => t.planId !== planId);
  await saveData(data);
}

/** 当前课程今天排期的计划任务（含已完成），按 sort 排序；供「开始学习」页今日计划卡；暂停计划不计入 */
export async function queryTodayPlanTasks(courseId: number): Promise<StudyTask[]> {
  const data = await getData();
  const today = formatLocalDate();
  const planIds = new Set(
    data.studyPlans.filter((p) => p.courseId === courseId && p.status !== "paused").map((p) => p.id),
  );
  return data.studyTasks
    .filter((t) => planIds.has(t.planId) && t.scheduledDate === today)
    .sort((a, b) => a.sort - b.sort);
}


/** 日期 + N 天（YYYY-MM-DD） */
function addDaysToDate(date: string, n: number): string {
  const d = new Date(date + "T00:00:00");
  d.setDate(d.getDate() + n);
  return formatLocalDate(d);
}

/** 重排计划内各天的 sort（同日按 id 稳定排序），保证展示顺序不乱 */
function resyncTaskSort(data: AppData, planId: number): void {
  const byDate = new Map<string, StudyTask[]>();
  for (const t of data.studyTasks) {
    if (t.planId !== planId) continue;
    const list = byDate.get(t.scheduledDate) ?? [];
    list.push(t);
    byDate.set(t.scheduledDate, list);
  }
  for (const list of byDate.values()) {
    list.sort((a, b) => a.id - b.id);
    list.forEach((t, i) => (t.sort = i + 1));
  }
}

export async function setPlanStatus(planId: number, status: "active" | "paused"): Promise<StudyPlan> {
  const data = await getData();
  const plan = data.studyPlans.find((p) => p.id === planId);
  if (!plan) throw new Error("计划不存在");
  plan.status = status;
  await saveData(data);
  return { ...plan };
}

/** 延期 N 天：未完成任务 + 起止/目标日期整体 +N 天，已完成任务不动 */
export async function shiftPlan(planId: number, days: number): Promise<{ moved: number }> {
  if (!Number.isInteger(days) || days <= 0) throw new Error("请输入正整数天数");
  const data = await getData();
  const plan = data.studyPlans.find((p) => p.id === planId);
  if (!plan) throw new Error("计划不存在");
  let moved = 0;
  for (const t of data.studyTasks) {
    if (t.planId === planId && t.status === "todo") {
      t.scheduledDate = addDaysToDate(t.scheduledDate, days);
      moved++;
    }
  }
  plan.targetDate = addDaysToDate(plan.targetDate, days);
  if (plan.startDate) plan.startDate = addDaysToDate(plan.startDate, days);
  await saveData(data);
  return { moved };
}

/** 延长 N 天：目标日期 +N，剩余未完成 learn 任务在剩余天数（max(今天,开始日)→新目标日）重铺均分 */
export async function extendPlan(planId: number, days: number): Promise<{ redistributed: number }> {
  if (!Number.isInteger(days) || days <= 0) throw new Error("请输入正整数天数");
  const data = await getData();
  const plan = data.studyPlans.find((p) => p.id === planId);
  if (!plan) throw new Error("计划不存在");
  plan.targetDate = addDaysToDate(plan.targetDate, days);
  const today = formatLocalDate();
  const startRef = plan.startDate && plan.startDate > today ? plan.startDate : today;
  const remainDays = Math.max(1, Math.round((new Date(plan.targetDate).getTime() - new Date(startRef).getTime()) / (24 * 60 * 60 * 1000)) + 1);
  const remaining = data.studyTasks
    .filter((t) => t.planId === planId && t.taskType === "learn" && t.status === "todo")
    .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate) || a.id - b.id);
  if (remaining.length) {
    const perDay = Math.ceil(remaining.length / remainDays);
    for (let i = 0; i < remaining.length; i++) {
      remaining[i].scheduledDate = addDaysToDate(startRef, Math.floor(i / perDay));
    }
  }
  resyncTaskSort(data, planId);
  await saveData(data);
  return { redistributed: remaining.length };
}

/** 顺延过期任务：日期 < 今天且未完成的任务 → 今天；传 taskId 只顺延该条，否则顺延计划内全部过期任务 */
export async function postponeOverdueTasks(planId: number, taskId?: number): Promise<{ moved: number }> {
  const data = await getData();
  const plan = data.studyPlans.find((p) => p.id === planId);
  if (!plan) throw new Error("计划不存在");
  const today = formatLocalDate();
  let moved = 0;
  for (const t of data.studyTasks) {
    if (t.planId !== planId || t.status !== "todo") continue;
    if (t.scheduledDate >= today) continue;
    if (taskId != null && t.id !== taskId) continue;
    t.scheduledDate = today;
    moved++;
  }
  if (moved === 0) throw new Error("没有可顺延的过期任务");
  resyncTaskSort(data, planId);
  await saveData(data);
  return { moved };
}

/** 同步新知识点：计划未覆盖的课程 KP 各加一条 learn 任务，从今天起每天 1 条排到目标日（超出堆末日）；现有任务不动 */
export async function syncPlanKps(planId: number): Promise<{ added: number }> {
  const data = await getData();
  const plan = data.studyPlans.find((p) => p.id === planId);
  if (!plan) throw new Error("计划不存在");
  const covered = new Set(
    data.studyTasks.filter((t) => t.planId === planId && t.taskType === "learn" && t.kpId != null).map((t) => t.kpId),
  );
  const newKps = data.knowledgePoints
    .filter((k) => k.courseId === plan.courseId && !covered.has(k.id))
    .sort((a, b) => (a.chapterId ?? -1) - (b.chapterId ?? -1) || a.sort - b.sort || a.id - b.id);
  if (!newKps.length) return { added: 0 };
  const today = formatLocalDate();
  const startRef = today <= plan.targetDate ? today : plan.targetDate;
  const dayCount = Math.max(1, Math.round((new Date(plan.targetDate).getTime() - new Date(startRef).getTime()) / (24 * 60 * 60 * 1000)) + 1);
  for (let i = 0; i < newKps.length; i++) {
    const kp = newKps[i];
    const date = addDaysToDate(startRef, Math.min(i, dayCount - 1));
    const sort = data.studyTasks.filter((t) => t.planId === planId && t.scheduledDate === date).length + 1;
    data.studyTasks.push({
      id: nextId(data.studyTasks),
      planId,
      chapterId: kp.chapterId,
      kpId: kp.id,
      taskType: "learn",
      title: `学习：${kp.name}`,
      scheduledDate: date,
      status: "todo",
      sort,
    });
  }
  await saveData(data);
  return { added: newKps.length };
}

/** 测评来源：章节组卷（?set=<章节id>）→ 章末测评任务；结业模考（?exam=1）→ 结业模考任务 */
export type TestTaskContext =
  | { kind: "chapter-test"; chapterId: number }
  | { kind: "exam" };

/**
 * 测评完成勾选：章节组卷/结业模考全部答完后，勾掉该课程未暂停计划中
 * 「今天排期 + 未完成 + test」的任务。chapter-test 匹配 chapterId === context.chapterId
 * 的章末测评任务；exam 匹配 chapterId === null 的结业模考任务。
 * 无命中返回空数组且不写盘，不会误勾其他任务。
 */
export async function completeTestTasks(
  courseId: number,
  context: TestTaskContext,
): Promise<string[]> {
  const data = await getData();
  const today = formatLocalDate();
  const planIds = new Set(
    data.studyPlans.filter((p) => p.courseId === courseId && p.status !== "paused").map((p) => p.id),
  );
  const doneTitles: string[] = [];
  for (const t of data.studyTasks) {
    if (!planIds.has(t.planId)) continue;
    if (t.scheduledDate !== today || t.status !== "todo" || t.taskType !== "test") continue;
    const matched = context.kind === "chapter-test" ? t.chapterId === context.chapterId : t.chapterId === null;
    if (!matched) continue;
    t.status = "done";
    doneTitles.push(t.title);
  }
  if (doneTitles.length > 0) {
    await saveData(data);
  }
  return doneTitles;
}

export async function generateStudyPlan(
  courseId: number,
  input: { startDate: string; targetDate: string; dailyHour: string },
): Promise<StudyPlanWithTasks> {
  const data: AppData = await getData();
  const course = data.courses.find((c) => c.id === courseId);
  if (!course) {
    throw new Error("课程不存在");
  }
  // 与知识点抽取互斥：抽取进行中知识点集不稳定，生成计划会引用到错乱数据
  if (hasActiveExtract()) {
    throw new Error("知识点抽取进行中，暂不能生成学习计划，请等抽取完成后重试");
  }
  // 章节序知识点（无章节的排前）
  const kps = data.knowledgePoints
    .filter((k) => k.courseId === courseId)
    .sort((a, b) => (a.chapterId ?? -1) - (b.chapterId ?? -1) || a.sort - b.sort || a.id - b.id);
  if (kps.length === 0) {
    throw new Error("该课程尚无知识点，请先在「课程内容」页上传资料并抽取知识点");
  }
  // 无 AI 绑定时降级为纯骨架（仍可生成可用计划）
  const binding = findTaskBinding(data, "gen_plan", courseId);

  const today = formatLocalDate(new Date());
  if (input.targetDate < input.startDate) {
    throw new Error("目标日期不能早于开始日期");
  }
  const days = countPlanDays(input.startDate, input.targetDate);
  const kpsPerDay = Math.ceil(kps.length / days);
  const dayKps = distributeKpsByDay(kps, days, input.startDate);

  // AI 只穿插 review/practice 补充任务（非法条目丢弃，不阻断骨架）
  let aiContent = "";
  const extraItems: AiPlanExtraItem[] = [];
  if (binding) {
    // 铃铛：计划生成是单次长调用，无分段进度（total=0 不显示进度条）；纯骨架降级路径（无绑定）不进铃铛
    const planTask = startBgTask({
      taskId: courseTaskId(courseId, "gen_plan"),
      taskType: "gen_plan",
      label: course.name,
      courseId,
      message: `AI 生成学习计划中（${kps.length} 个知识点 → ${days} 天）…`,
    });
    try {
      const skeletonLines = dayKps
        .map(({ date, kps: dk }) => `${date}：${dk.map((k) => `${k.id}. ${k.name}`).join("、") || "（无）"}`)
        .join("\n");
      const planVars = {
        courseName: course.name,
        today,
        targetDate: input.targetDate,
        days: String(days),
        dailyHour: String(input.dailyHour),
        skeletonLines,
      };
      const planTpl = resolvePromptTemplate(data, "gen_plan");
      const res = await callAi({
        providerId: binding.providerId,
        modelId: binding.modelId,
        taskKey: "gen_plan",
        scope: "course-" + course.id,
        messages: [
          { role: "system", content: renderPrompt(planTpl.system, planVars) },
          { role: "user", content: renderPrompt(planTpl.user, planVars) },
        ],
      });
      aiContent = res.content;
      const validDates = new Set(dayKps.map((d) => d.date));
      const validKpIds = new Set(kps.map((k) => k.id));
      for (const item of parseAiPlanExtraResponse(res.content)) {
        if (!validDates.has(item.date)) continue;
        if (item.kpId !== 0 && !validKpIds.has(item.kpId)) continue;
        extraItems.push(item);
      }
      planTask.done(`学习计划已生成：共 ${days} 天，穿插 ${extraItems.length} 个 AI 补充任务`);
    } catch (e) {
      planTask.fail(e, "AI 学习计划生成失败");
      throw e;
    }
  }

  // 覆盖式：清除本课程旧计划及其任务
  const oldPlanIds = new Set(data.studyPlans.filter((p) => p.courseId === courseId).map((p) => p.id));
  data.studyPlans = data.studyPlans.filter((p) => !oldPlanIds.has(p.id));
  data.studyTasks = data.studyTasks.filter((t) => !oldPlanIds.has(t.planId));

  const plan: StudyPlan = {
    id: nextId(data.studyPlans),
    courseId,
    planContent:
      aiContent ||
      `确定性骨架：${kps.length} 个知识点均分 ${days} 天（每天 ${kpsPerDay} 个 learn 任务）+ 章末测评与结业模考${binding ? "" : "；未配置 gen_plan 模型，无 AI 补充任务"}`,
    status: "active",
    startDate: input.startDate,
    targetDate: input.targetDate,
    dailyHour: input.dailyHour,
    createTime: now(),
  };
  data.studyPlans.push(plan);

  const dateCounts: Record<string, number> = {};
  const bumpSort = (date: string): number => {
    const n = (dateCounts[date] ?? 0) + 1;
    dateCounts[date] = n;
    return n;
  };
  // 骨架：每知识点一条 learn 任务（100% 覆盖、100% 挂 kpId）
  for (const { date, kps: dk } of dayKps) {
    for (const kp of dk) {
      data.studyTasks.push({
        id: nextId(data.studyTasks),
        planId: plan.id,
        chapterId: kp.chapterId,
        kpId: kp.id,
        taskType: "learn",
        title: `学习：${kp.name}`,
        scheduledDate: date,
        status: "todo",
        sort: bumpSort(date),
      });
    }
  }
  // 章末测评 + 结业模考：系统确定性排期（章末=该章最后一个学习日；无模型配置也能出、位置精确）
  const courseChapters = data.chapters.filter((c) => c.courseId === courseId);
  const chapterById = new Map(courseChapters.map((c) => [c.id, c]));
  const chapterLastDay = new Map<number, string>();
  for (const { date, kps: dk } of dayKps) {
    for (const kp of dk) {
      if (kp.chapterId == null) continue;
      const node = chapterById.get(kp.chapterId);
      const chId = node?.level === "unit" && node.parentId != null ? node.parentId : kp.chapterId;
      chapterLastDay.set(chId, date);
    }
  }
  for (const ch of courseChapters.filter((c) => c.level === "chapter").sort((a, b) => a.sort - b.sort)) {
    const lastDate = chapterLastDay.get(ch.id);
    if (!lastDate) continue;
    data.studyTasks.push({
      id: nextId(data.studyTasks),
      planId: plan.id,
      chapterId: ch.id,
      kpId: null,
      taskType: "test",
      title: `测评：${ch.name} 章节测评`,
      scheduledDate: lastDate,
      status: "todo",
      sort: bumpSort(lastDate),
    });
  }
  data.studyTasks.push({
    id: nextId(data.studyTasks),
    planId: plan.id,
    chapterId: null,
    kpId: null,
    taskType: "test",
    title: "结业模考",
    scheduledDate: input.targetDate,
    status: "todo",
    sort: bumpSort(input.targetDate),
  });
  // AI 穿插的 review/practice
  for (const item of extraItems) {
    const kp = item.kpId ? kps.find((k) => k.id === item.kpId) : undefined;
    data.studyTasks.push({
      id: nextId(data.studyTasks),
      planId: plan.id,
      chapterId: kp?.chapterId ?? null,
      kpId: item.kpId || null,
      taskType: item.taskType,
      title: item.title || `${item.taskType === "review" ? "复习" : "练习"}${kp ? `：${kp.name}` : ""}`,
      scheduledDate: item.date,
      status: "todo",
      sort: bumpSort(item.date),
    });
  }

  await saveData(data);
  return { plan, tasks: await queryStudyTasks(plan.id) };
}

