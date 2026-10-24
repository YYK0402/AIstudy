// 后台任务通知：长时 AI 任务状态（AI 梳理 / 知识点抽取 / AI 出题 / AI 闪卡生成），localStorage 持久化（切页/刷新不丢）
import { defineStore } from "pinia";
import { computed, ref } from "vue";

export type BgTaskStatus = "running" | "done" | "failed" | "canceled";
export type BgTaskType = "organize" | "extract" | "gen_question" | "gen_flashcard";

export interface BgTaskState {
  /** 唯一键：organize-{materialId} / extract-{materialId} / gen_question-{courseId} / gen_flashcard-{courseId} */
  taskId: string;
  taskType: BgTaskType;
  /** 显示目标名（资料名 / 课程名） */
  label: string;
  courseId: number;
  /** 仅资料任务有，供「查看目录 / 资料」导航 */
  materialId?: number;
  status: BgTaskStatus;
  /** 已完成段数/批次数（total > 0 时进行中显示进度条） */
  done: number;
  total: number;
  message: string;
  unread: boolean;
  startedAt: string;
  finishedAt: string | null;
}

/** 资料级任务键（AI 梳理 / 知识点抽取） */
export function materialTaskId(materialId: number, taskType: "organize" | "extract"): string {
  return `${taskType}-${materialId}`;
}

/** 课程级任务键（AI 出题 / AI 闪卡生成） */
export function courseTaskId(courseId: number, taskType: "gen_question" | "gen_flashcard"): string {
  return `${taskType}-${courseId}`;
}

const STORAGE_KEY = "ai-study:org-tasks";

type LegacyTask = Partial<BgTaskState> & { materialName?: string };

function loadPersisted(): BgTaskState[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as LegacyTask[];
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((t) => t && typeof t.status === "string")
      .map((t, i) => {
        // 旧数据兼容：无 taskId/label 字段，按 taskType + materialId 派生
        const taskType: BgTaskType =
          t.taskType === "extract"
            ? "extract"
            : t.taskType === "gen_question"
              ? "gen_question"
              : t.taskType === "gen_flashcard"
                ? "gen_flashcard"
                : "organize";
        const base: BgTaskState = {
          taskId:
            typeof t.taskId === "string" && t.taskId
              ? t.taskId
              : typeof t.materialId === "number"
                ? materialTaskId(t.materialId, taskType === "extract" ? "extract" : "organize")
                : `legacy-${taskType}-${i}`,
          taskType,
          label: typeof t.label === "string" ? t.label : (t.materialName ?? ""),
          courseId: typeof t.courseId === "number" ? t.courseId : 0,
          materialId: typeof t.materialId === "number" ? t.materialId : undefined,
          status: t.status as BgTaskStatus,
          done: typeof t.done === "number" ? t.done : 0,
          total: typeof t.total === "number" ? t.total : 0,
          message: typeof t.message === "string" ? t.message : "",
          unread: !!t.unread,
          startedAt: typeof t.startedAt === "string" ? t.startedAt : "",
          finishedAt: t.finishedAt ?? null,
        };
        // 页面刷新/页签重开后，进行中的任务已无法继续：标记失败供重试
        return base.status === "running"
          ? { ...base, status: "failed" as const, message: "任务中断（页面刷新或关闭），请重试" }
          : base;
      });
  } catch {
    return [];
  }
}

function persist(tasks: BgTaskState[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  } catch {
    // 存储不可用时通知降级为纯内存，不阻塞主流程
  }
}

export const useNotifyStore = defineStore("notify", () => {
  const tasks = ref<BgTaskState[]>(loadPersisted());
  const panelOpen = ref(false);

  const unreadCount = computed(() => tasks.value.filter((t) => t.unread).length);
  const doneCount = computed(() => tasks.value.filter((t) => t.status === "done").length);

  function save() {
    persist(tasks.value);
  }

  function upsertTask(t: BgTaskState) {
    const idx = tasks.value.findIndex((x) => x.taskId === t.taskId);
    if (idx >= 0) tasks.value[idx] = t;
    else tasks.value.push(t);
    save();
  }

  function patchTask(taskId: string, patch: Partial<BgTaskState>) {
    const t = tasks.value.find((x) => x.taskId === taskId);
    if (!t) return;
    Object.assign(t, patch);
    save();
  }

  function taskOf(taskId: string): BgTaskState | null {
    return tasks.value.find((x) => x.taskId === taskId) ?? null;
  }

  function markAllRead() {
    for (const t of tasks.value) t.unread = false;
    save();
  }

  function clearTask(taskId: string) {
    tasks.value = tasks.value.filter((t) => t.taskId !== taskId);
    save();
  }

  /** 移除所有已完成任务（进行中/失败/取消保留） */
  function clearDone() {
    tasks.value = tasks.value.filter((t) => t.status !== "done");
    save();
  }

  function clearAll() {
    tasks.value = [];
    save();
  }

  return { tasks, panelOpen, unreadCount, doneCount, upsertTask, patchTask, taskOf, markAllRead, clearTask, clearDone, clearAll };
});
