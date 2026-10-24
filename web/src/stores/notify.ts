// 后台任务通知：AI 梳理 / 知识点抽取任务状态，localStorage 持久化（切页/刷新不丢）
import { defineStore } from "pinia";
import { computed, ref } from "vue";

export type OrgTaskStatus = "running" | "done" | "failed" | "canceled";
export type OrgTaskType = "organize" | "extract";

export interface OrgTaskState {
  materialId: number;
  materialName: string;
  courseId: number;
  /** 任务类型（旧数据无此字段，按 organize 兼容） */
  taskType: OrgTaskType;
  status: OrgTaskStatus;
  /** 已完成段数/块数（进行中时展示进度） */
  done: number;
  total: number;
  message: string;
  unread: boolean;
  startedAt: string;
  finishedAt: string | null;
}

const STORAGE_KEY = "ai-study:org-tasks";

function loadPersisted(): OrgTaskState[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as OrgTaskState[];
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((t) => t && typeof t.materialId === "number" && typeof t.status === "string")
      .map((t) => {
        // 旧数据无 taskType 字段，按 organize 兼容
        const taskType: OrgTaskType = t.taskType === "extract" ? "extract" : "organize";
        // 页面刷新/页签重开后，进行中的任务已无法继续：标记失败供重试
        return t.status === "running"
          ? { ...t, taskType, status: "failed" as const, message: "任务中断（页面刷新或关闭），请重试" }
          : { ...t, taskType };
      });
  } catch {
    return [];
  }
}

function persist(tasks: OrgTaskState[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  } catch {
    // 存储不可用时通知降级为纯内存，不阻塞主流程
  }
}

export const useNotifyStore = defineStore("notify", () => {
  const tasks = ref<OrgTaskState[]>(loadPersisted());
  const panelOpen = ref(false);

  const unreadCount = computed(() => tasks.value.filter((t) => t.unread).length);

  function save() {
    persist(tasks.value);
  }

  /** 按 (materialId, taskType) upsert（一份资料同类任务同一时刻最多一个） */
  function upsertTask(t: OrgTaskState) {
    const idx = tasks.value.findIndex((x) => x.materialId === t.materialId && x.taskType === t.taskType);
    if (idx >= 0) tasks.value[idx] = t;
    else tasks.value.push(t);
    save();
  }

  function patchTask(materialId: number, taskType: OrgTaskType, patch: Partial<OrgTaskState>) {
    const t = tasks.value.find((x) => x.materialId === materialId && x.taskType === taskType);
    if (!t) return;
    Object.assign(t, patch);
    save();
  }

  function taskOf(materialId: number, taskType: OrgTaskType): OrgTaskState | null {
    return tasks.value.find((x) => x.materialId === materialId && x.taskType === taskType) ?? null;
  }

  function markAllRead() {
    for (const t of tasks.value) t.unread = false;
    save();
  }

  function clearTask(materialId: number, taskType: OrgTaskType) {
    tasks.value = tasks.value.filter((t) => !(t.materialId === materialId && t.taskType === taskType));
    save();
  }

  function clearAll() {
    tasks.value = [];
    save();
  }

  return { tasks, panelOpen, unreadCount, upsertTask, patchTask, taskOf, markAllRead, clearTask, clearAll };
});
