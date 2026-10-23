// 后台任务通知：AI 梳理任务状态，localStorage 持久化（切页/刷新不丢）
import { defineStore } from "pinia";
import { computed, ref } from "vue";

export type OrgTaskStatus = "running" | "done" | "failed" | "canceled";

export interface OrgTaskState {
  materialId: number;
  materialName: string;
  courseId: number;
  status: OrgTaskStatus;
  /** 已完成段数（进行中时展示进度） */
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
      .map((t) =>
        // 页面刷新/页签重开后，进行中的任务已无法继续：标记失败供重试
        t.status === "running"
          ? { ...t, status: "failed" as const, message: "任务中断（页面刷新或关闭），请重试" }
          : t,
      );
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

  /** 按 materialId upsert（一份资料同一时刻最多一个梳理任务） */
  function upsertTask(t: OrgTaskState) {
    const idx = tasks.value.findIndex((x) => x.materialId === t.materialId);
    if (idx >= 0) tasks.value[idx] = t;
    else tasks.value.push(t);
    save();
  }

  function patchTask(materialId: number, patch: Partial<OrgTaskState>) {
    const t = tasks.value.find((x) => x.materialId === materialId);
    if (!t) return;
    Object.assign(t, patch);
    save();
  }

  function taskOf(materialId: number): OrgTaskState | null {
    return tasks.value.find((x) => x.materialId === materialId) ?? null;
  }

  function markAllRead() {
    for (const t of tasks.value) t.unread = false;
    save();
  }

  function clearTask(materialId: number) {
    tasks.value = tasks.value.filter((t) => t.materialId !== materialId);
    save();
  }

  function clearAll() {
    tasks.value = [];
    save();
  }

  return { tasks, panelOpen, unreadCount, upsertTask, patchTask, taskOf, markAllRead, clearTask, clearAll };
});
