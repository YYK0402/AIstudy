import { onBeforeUnmount, onMounted } from "vue";
import { DATA_SAVED_EVENT, type DataSavedPayload } from "../api/storage";
import { useCourseStore } from "../stores/course";

export interface DataSavedRefreshOptions {
  /** course=global 或当前课程脏集时刷新（默认）；global=仅全局变化刷新；any=任何变化刷新 */
  scope?: "course" | "global" | "any";
  /** 防抖窗口（ms）：连续保存（如闪卡分批落盘）合并为一次刷新 */
  debounceMs?: number;
}

/**
 * DATA_SAVED 选择性刷新：按事件脏集只刷新职责命中的组件，并防抖合并。
 * 无 detail 的旧事件 / 外部变更事件按全量刷新处理（兜底兼容）。
 */
export function useDataSavedRefresh(refresh: () => void, options: DataSavedRefreshOptions = {}) {
  const { scope = "course", debounceMs = 200 } = options;
  const courseStore = useCourseStore();
  let timer: number | undefined;

  function hit(payload: DataSavedPayload | undefined): boolean {
    if (!payload || scope === "any") return true;
    if (payload.global) return true;
    if (scope === "global") return false;
    return payload.courseIds.includes(courseStore.currentCourseId);
  }

  function onSaved(e: Event) {
    if (!hit((e as CustomEvent<DataSavedPayload>).detail)) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(refresh, debounceMs);
  }

  onMounted(() => {
    window.addEventListener(DATA_SAVED_EVENT, onSaved);
  });
  onBeforeUnmount(() => {
    window.clearTimeout(timer);
    window.removeEventListener(DATA_SAVED_EVENT, onSaved);
  });
}
