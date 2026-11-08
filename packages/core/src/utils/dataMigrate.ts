import type { AppData } from "../types/appData";

/** 读时数据升级（幂等）：旧版 chapter.level "chapter"|"unit" → number（1/2）；补 tocMappings 默认值 */
export function normalizeAppDataShape(data: AppData): void {
  for (const ch of data.chapters) {
    const lv = ch.level as unknown;
    if (lv === "chapter") ch.level = 1;
    else if (lv === "unit") ch.level = 2;
  }
  if (!Array.isArray(data.tocMappings)) data.tocMappings = [];
}
