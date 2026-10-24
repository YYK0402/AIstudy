// 底层数据读写：直接调用主窗口暴露的 Plugin 实例 API
import type { AppData } from "../types/appData";

/** 数据持久化成功后派发的全局信号，供 Topbar / Sidebar 等全局组件刷新 */
export const DATA_SAVED_EVENT = "siyuan-ai-study:data-saved";

export async function getData(): Promise<AppData> {
  return window.siyuanAiStudy.getData();
}

// 模块级串行队列：并发写盘按调用顺序执行，避免互相覆盖；
// 队列链吞掉失败（saveChain 永不 reject），单次失败不阻断后续保存
let saveChain: Promise<unknown> = Promise.resolve();

export function saveData(data: AppData): Promise<void> {
  const run = saveChain.then(async () => {
    const res = await window.siyuanAiStudy.saveData(data);
    if (res.code !== 0) {
      throw new Error(`数据保存失败${res.msg ? `：${res.msg}` : ""}`);
    }
  });
  saveChain = run.catch(() => undefined);
  // 失败时不派发 DATA_SAVED_EVENT（run reject 则不进 then 回调）
  return run.then(() => {
    window.dispatchEvent(new Event(DATA_SAVED_EVENT));
  });
}
