// 底层数据读写：直接调用主窗口暴露的 Plugin 实例 API
import type { AppData } from "../types/appData";

/** 数据持久化成功后派发的全局信号，携带本次保存的脏集，供订阅方选择性刷新 */
export const DATA_SAVED_EVENT = "siyuan-ai-study:data-saved";

/** 本次保存的脏集：global=true 表示全局文件有变化（课程列表/设置等），courseIds 为有变化的课程文件 id */
export interface DataSavedPayload {
  global: boolean;
  courseIds: number[];
}

// 兜底脏集：插件响应缺 dirty（旧版插件/测试 mock）时按全量变化处理，保证所有订阅方完整刷新
const FULL_REFRESH: DataSavedPayload = { global: true, courseIds: [] };

function dispatchSaved(payload: DataSavedPayload) {
  invalidateSnapshot();
  window.dispatchEvent(new CustomEvent(DATA_SAVED_EVENT, { detail: payload }));
}

// 外部数据变更（其他思源窗口写入 / 跨设备同步合并）：主进程已刷新内存视图，
// 复用 DATA_SAVED 机制让已挂载视图重新拉取最新数据（来源未知，按全量刷新）
const DATA_EXTERNAL_EVENT = "siyuan-ai-study:data-external";
window.addEventListener(DATA_EXTERNAL_EVENT, () => {
  dispatchSaved(FULL_REFRESH);
});

// 内存快照：插件 getData 返回活引用，快照的价值是"一次 load 周期内引用稳定"
// （保存失败回滚会替换内存对象，旧引用即失效），DATA_SAVED 后统一失效
let snapshot: AppData | null = null;

export function invalidateSnapshot(): void {
  snapshot = null;
}

export async function getDataSnapshot(): Promise<AppData> {
  if (!snapshot) snapshot = await getData();
  return snapshot;
}

export async function getData(): Promise<AppData> {
  return window.siyuanAiStudy.getData();
}

// 模块级串行队列：并发写盘按调用顺序执行，避免互相覆盖；
// 队列链吞掉失败（saveChain 永不 reject），单次失败不阻断后续保存
let saveChain: Promise<unknown> = Promise.resolve();

export function saveData(data: AppData): Promise<void> {
  let payload: DataSavedPayload = FULL_REFRESH;
  const run = saveChain.then(async () => {
    const res = await window.siyuanAiStudy.saveData(data);
    if (res.code !== 0) {
      throw new Error(`数据保存失败${res.msg ? `：${res.msg}` : ""}`);
    }
    payload = res.dirty ?? FULL_REFRESH;
  });
  saveChain = run.catch(() => undefined);
  // 失败时不派发 DATA_SAVED_EVENT（run reject 则不进 then 回调）
  return run.then(() => {
    dispatchSaved(payload);
  });
}
