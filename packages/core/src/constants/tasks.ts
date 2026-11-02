import type { IconName } from "../utils/icons";

export const TASK_TYPES = ["learn", "practice", "review", "test"] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  learn: "新知",
  practice: "练习",
  review: "复习",
  test: "测评",
};

export const TASK_TYPE_ICONS: Record<TaskType, IconName> = {
  learn: "book",
  practice: "pencil",
  review: "refresh",
  test: "check-square",
};

export function isTaskType(value: string): value is TaskType {
  return (TASK_TYPES as readonly string[]).includes(value);
}

export function taskTypeLabel(taskType: string): string {
  return isTaskType(taskType) ? TASK_TYPE_LABELS[taskType] : taskType;
}

export function taskTypeIcon(taskType: string): IconName {
  return isTaskType(taskType) ? TASK_TYPE_ICONS[taskType] : "book";
}

export interface TaskAction {
  to: { path: string; query: Record<string, string> };
  label: string;
}

/** 学习任务的统一去处：学→学习页 / 练→刷题 / 复→复习 / 测→章节组卷或模考 */
export function taskAction(t: {
  taskType: string;
  kpId?: number | null;
  chapterId?: number | null;
}): TaskAction | null {
  if (t.taskType === "learn" && t.kpId != null) {
    return { to: { path: "/study", query: { kp: String(t.kpId) } }, label: "去学习" };
  }
  if (t.taskType === "practice") {
    return { to: { path: "/quiz", query: t.kpId != null ? { kp: String(t.kpId) } : {} }, label: "去刷题" };
  }
  if (t.taskType === "review") {
    return { to: { path: "/review", query: t.kpId != null ? { kp: String(t.kpId) } : {} }, label: "去复习" };
  }
  if (t.taskType === "test") {
    return {
      to: { path: "/quiz", query: t.chapterId != null ? { set: String(t.chapterId) } : { exam: "1" } },
      label: "去测评",
    };
  }
  return null;
}

/** 今日任务组摘要：按任务类型计数（"新知 2 · 复习 1"），类型顺序固定按 TASK_TYPES */
export function taskCountsSummary(counts: Record<string, number>): string {
  return TASK_TYPES.filter((key) => counts[key])
    .map((key) => `${TASK_TYPE_LABELS[key]} ${counts[key]}`)
    .join(" · ");
}
