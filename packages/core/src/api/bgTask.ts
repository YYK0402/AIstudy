import { useNotifyStore, type BgTaskType } from "../stores/notify";

export interface BgTaskStart {
  taskId: string;
  taskType: BgTaskType;
  label: string;
  courseId: number;
  materialId?: number;
  message: string;
  total?: number;
}

export interface BgTaskReporter {
  progress(patch: { done?: number; total?: number; message?: string }): void;
  done(message: string): void;
  fail(error: unknown, fallback: string): void;
  failWith(message: string): void;
  canceled(message?: string): void;
}

function stamp(): string {
  return new Date().toISOString();
}

/**
 * 统一后台 AI 任务的通知样板：开始 → 进度 → 完成/失败/取消。
 * 任务本身仍由调用方执行，这里只负责铃铛状态，避免五处重复 upsert/patch。
 */
export function startBgTask(init: BgTaskStart): BgTaskReporter {
  const store = useNotifyStore();
  store.upsertTask({
    taskId: init.taskId,
    taskType: init.taskType,
    label: init.label,
    courseId: init.courseId,
    materialId: init.materialId,
    status: "running",
    done: 0,
    total: init.total ?? 0,
    message: init.message,
    unread: false,
    startedAt: stamp(),
    finishedAt: null,
  });
  return {
    progress(patch) {
      store.patchTask(init.taskId, patch);
    },
    done(message) {
      store.patchTask(init.taskId, { status: "done", unread: true, finishedAt: stamp(), message });
    },
    fail(error, fallback) {
      store.patchTask(init.taskId, {
        status: "failed",
        unread: true,
        finishedAt: stamp(),
        message: error instanceof Error ? error.message : fallback,
      });
    },
    failWith(message) {
      store.patchTask(init.taskId, { status: "failed", unread: true, finishedAt: stamp(), message });
    },
    canceled(message = "任务已取消") {
      store.patchTask(init.taskId, { status: "canceled", unread: true, finishedAt: stamp(), message });
    },
  };
}
