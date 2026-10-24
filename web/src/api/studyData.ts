import type { AppData } from "../types/appData";
import { formatLocalDate, nextId, now } from "./format";

/** 追加一条学习时长日志（答题/讲解/复习实际耗时） */
export function logStudyInData(
  data: AppData,
  entry: { courseId: number; kpId: number | null; taskId: number | null; action: string; durationSec: number },
): void {
  data.studyLogs.push({
    id: nextId(data.studyLogs),
    courseId: entry.courseId,
    kpId: entry.kpId,
    taskId: entry.taskId,
    action: entry.action,
    duration: Math.max(0, Math.round(entry.durationSec)),
    createTime: now(),
  });
}

/** 把薄弱知识点补进最近计划（同类型 7 天内不重复加） */
export function appendWeakPointTaskInData(
  data: AppData,
  courseId: number,
  kpId: number,
  taskType: "practice" | "review",
): void {
  const plan = data.studyPlans.filter((p) => p.courseId === courseId).sort((a, b) => b.id - a.id)[0];
  if (!plan) return;
  const kp = data.knowledgePoints.find((k) => k.id === kpId);
  if (!kp) return;
  const today = formatLocalDate();
  const weekAgoDate = new Date();
  weekAgoDate.setDate(weekAgoDate.getDate() - 6);
  const weekAgo = formatLocalDate(weekAgoDate);
  const exists = data.studyTasks.some(
    (t) => t.planId === plan.id && (t.kpId ?? null) === kpId && t.taskType === taskType && t.scheduledDate >= weekAgo,
  );
  if (exists) return;
  const dayCount = data.studyTasks.filter((t) => t.planId === plan.id && t.scheduledDate === today).length;
  data.studyTasks.push({
    id: nextId(data.studyTasks),
    planId: plan.id,
    chapterId: kp.chapterId,
    kpId,
    taskType,
    title: `${taskType === "practice" ? "薄弱练习" : "薄弱复习"}：${kp.name}`,
    scheduledDate: today,
    status: "todo",
    sort: dayCount + 1,
  });
}

/** 勾掉某知识点当天指定类型的未完成任务，返回被勾掉的任务标题 */
export function completeKpTasksInData(data: AppData, kpId: number, types: string[]): string[] {
  const today = formatLocalDate();
  const doneTitles: string[] = [];
  for (const t of data.studyTasks) {
    if ((t.kpId ?? null) === kpId && t.scheduledDate === today && t.status === "todo" && types.includes(t.taskType)) {
      t.status = "done";
      doneTitles.push(t.title);
    }
  }
  return doneTitles;
}
