// 学习数据保留策略：studyLogs/answerRecords 超保留期的记录归档为月度汇总（月粒度不可逆，
// 但趋势窗口 7/30 天、连续天数等统计不受影响；累计统计由 answerStatsMonthly 合并补全）。
// 在 commitData 落盘前原地修改 AppData（与 migrateProviderKeys 同模式），幂等。
import type { AnswerRecord, AppData, StudyLog } from "./data";

export const DEFAULT_RETENTION_DAYS = 90;

/** 保留天数：旧数据缺失按 90；非法值（负数/非数字）同样按 90；0 = 永久保留 */
export function getRetentionDays(settings: Partial<AppData["settings"]> | null | undefined): number {
  const n = settings?.studyRetentionDays;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_RETENTION_DAYS;
}

/** 本地日期 YYYY-MM-DD；非法时间返回 null（非法记录不归档，保留原样） */
export function localDateOfSafe(createTime: string): string | null {
  const d = new Date(createTime);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

interface LogAgg {
  courseId: number;
  month: string;
  seconds: number;
  actions: number;
  lastDay: string;
}

interface AnswerAgg {
  courseId: number;
  month: string;
  total: number;
  correct: number;
  essayTotalScore: number;
  essayCount: number;
}

function archiveStudyLogs(data: AppData, cutoffDay: string): number {
  const agg = new Map<string, LogAgg>();
  for (const e of data.studyLogMonthly) agg.set(`${e.courseId}|${e.month}`, e);
  const keep: StudyLog[] = [];
  let n = 0;
  for (const l of data.studyLogs) {
    const day = localDateOfSafe(l.createTime);
    if (day == null || day >= cutoffDay) {
      keep.push(l);
      continue;
    }
    const month = day.slice(0, 7);
    const k = `${l.courseId}|${month}`;
    let a = agg.get(k);
    if (!a) {
      a = { courseId: l.courseId, month, seconds: 0, actions: 0, lastDay: day };
      agg.set(k, a);
    }
    a.seconds += Number.isFinite(l.duration) && l.duration > 0 ? l.duration : 0;
    a.actions += 1;
    if (day > a.lastDay) a.lastDay = day;
    n += 1;
  }
  data.studyLogs = keep;
  data.studyLogMonthly = [...agg.values()];
  return n;
}

function parseScoreNum(score: string): number | null {
  const n = Number(score);
  return Number.isFinite(n) ? n : null;
}

function archiveAnswerRecords(data: AppData, cutoffDay: string): number {
  const qTypeById = new Map(data.questions.map((q) => [q.id, q.qType]));
  const agg = new Map<string, AnswerAgg>();
  for (const e of data.answerStatsMonthly) agg.set(`${e.courseId}|${e.month}`, e);
  const qCourse = new Map(data.questions.map((q) => [q.id, q.courseId]));
  const keep: AnswerRecord[] = [];
  let n = 0;
  for (const r of data.answerRecords) {
    const day = localDateOfSafe(r.createTime);
    if (day == null || day >= cutoffDay) {
      keep.push(r);
      continue;
    }
    const courseId = qCourse.get(r.qId);
    if (courseId == null) {
      // 题目已删的记录不归档也不保留：报表口径本就不统计（按现存题目过滤），
      // 删题级联本应已清掉，这里兜底旧数据
      continue;
    }
    const month = day.slice(0, 7);
    const k = `${courseId}|${month}`;
    let a = agg.get(k);
    if (!a) {
      a = { courseId, month, total: 0, correct: 0, essayTotalScore: 0, essayCount: 0 };
      agg.set(k, a);
    }
    a.total += 1;
    if (r.isCorrect) a.correct += 1;
    // 与 report 口径一致：仅统计现存题目且 qType=essay 的作答；题目已删（qId 查不到）按非简答计
    if (qTypeById.get(r.qId) === "essay") {
      const score = parseScoreNum(r.score);
      if (score != null) {
        a.essayTotalScore += score;
        a.essayCount += 1;
      }
    }
    n += 1;
  }
  data.answerRecords = keep;
  data.answerStatsMonthly = [...agg.values()];
  return n;
}

/**
 * 把超保留期的 studyLogs/answerRecords 归档为月度汇总，原地修改 data。
 * 边界：保留「cutoffDay 当天及以后」的记录（cutoffDay = 今天 - 保留天数，本地日期）。
 * 返回归档的记录条数（0 = 无需归档，幂等）。
 */
export function applyRetention(data: AppData, ref = new Date()): number {
  const days = getRetentionDays(data.settings);
  if (days === 0) return 0;
  const cutoff = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - days);
  return archiveStudyLogs(data, localDateOf(cutoff)) + archiveAnswerRecords(data, localDateOf(cutoff));
}

function localDateOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
