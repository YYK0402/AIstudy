import { ref } from "vue";
import { useCourseStore } from "../stores/course";

export interface LoadContext {
  /** 发起请求时的当前课程 id（0 = 无当前课程） */
  courseId: number;
  /** true = 已有更新的请求发起（含切课后的重载），视图在 await 之后写 state 前应检查并丢弃过期结果 */
  isStale: () => boolean;
}

/**
 * 视图数据加载：三态（loading/error/空）+ 切课竞态防护。
 * - load 内部统一 try/catch，消除 unhandled rejection，error 可驱动 LoadError 重试
 * - 每次请求递增序号；视图在 await 之后写 state 前检查 ctx.isStale()，快速 A→B 切课不会闪现/残留 A 的数据
 */
export function useLoad(loadFn: (ctx: LoadContext) => Promise<void>) {
  const courseStore = useCourseStore();
  const loading = ref(false);
  const error = ref("");
  let seq = 0;

  async function load(): Promise<void> {
    const mySeq = ++seq;
    const courseId = courseStore.currentCourseId;
    error.value = "";
    loading.value = true;
    try {
      await loadFn({ courseId, isStale: () => mySeq !== seq });
    } catch (e) {
      if (mySeq === seq) {
        error.value = e instanceof Error ? e.message : String(e);
      }
    } finally {
      if (mySeq === seq) {
        loading.value = false;
      }
    }
  }

  return { loading, error, load };
}
