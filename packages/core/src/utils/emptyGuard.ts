// 「纯空结构」判定与「空覆盖非空」写盘守卫。
// 背景：多设备同步时新 mtime 胜出——若新设备首启把空结构写盘，会以新 mtime
// 覆盖其他设备的真数据（2026-11-07 事故）。守卫确保"空状态"永远不会覆盖"非空状态"。
import type { AppData } from "../types/appData";
import { createEmptyData } from "../types/appData";

/** 全局视图中的全部数组字段（含孤儿实体键，splitAppData 会把归属不到的实体留在 global 下） */
const ARRAY_KEYS = [
  "providers",
  "models",
  "taskModels",
  "logs",
  "courses",
  "chapters",
  "knowledgePoints",
  "materials",
  "materialChapters",
  "tocMappings",
  "questions",
  "examPapers",
  "answerRecords",
  "questionAsks",
  "wrongQuestions",
  "studyPlans",
  "studyTasks",
  "explainRecords",
  "reviewSchedules",
  "flashCards",
  "studyLogs",
  "studyLogMonthly",
  "answerStatsMonthly",
] as const;

/** 判定全局视图是否为「纯空结构」：所有集合为空、settings 为默认值、无任何使用痕迹。
 *  合法操作永远产不出纯空结构（settings 恒存在且用户动过就会偏离默认值），
 *  因此"非空状态被纯空结构覆盖"必然是异常路径。 */
export function isEffectivelyEmptyGlobal(global: AppData | null | undefined): boolean {
  if (!global || typeof global !== "object" || Array.isArray(global)) return true;
  for (const key of ARRAY_KEYS) {
    const arr = global[key];
    if (Array.isArray(arr) && arr.length > 0) return false;
  }
  // settings 缺失视为"无内容"；只有"存在且偏离默认值"才算使用痕迹
  if (global.settings && JSON.stringify(global.settings) !== JSON.stringify(createEmptyData().settings)) return false;
  if (global.promptTemplates && Object.keys(global.promptTemplates).length > 0) return false;
  if (global.cryptoKeyMaterial) return false;
  if (global.reminders && Object.values(global.reminders).some((v) => v != null && v !== "")) return false;
  if (global.docRegions && Object.keys(global.docRegions).length > 0) return false;
  if (global.conversationsDocs && Object.keys(global.conversationsDocs).length > 0) return false;
  return true;
}

/** 判定一次全局文件写入是否为「空覆盖非空」异常：
 *  新状态是纯空结构，且已写盘基线（最后一次已知的磁盘状态）不是纯空结构。
 *  基线缺失（从未写盘，如新设备首启）→ 无覆盖对象，不拒绝。 */
export function shouldRejectEmptyOverwrite(
  newGlobal: AppData,
  baselineSerialized: string | undefined,
): boolean {
  if (!isEffectivelyEmptyGlobal(newGlobal)) return false;
  if (baselineSerialized == null) return false;
  let baseline: AppData | null;
  try {
    baseline = JSON.parse(baselineSerialized) as AppData;
  } catch {
    // 基线是我们自己 JSON.stringify 写入的，解析失败属异常：fail-closed 拒绝
    return true;
  }
  return !isEffectivelyEmptyGlobal(baseline);
}
