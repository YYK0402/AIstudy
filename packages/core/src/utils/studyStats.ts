import type { ReviewSchedule, StudyLog, WrongQuestion } from "../api";
import { localDateOf } from "./studyTrend";
import { WRONG_GRADUATE_STREAK } from "./wrongStreak";

/**
 * 连续学习天数：学习日 = 当天存在至少一条学习日志（含 0 秒打卡动作）。
 * 今天暂无记录时从昨天起算（当天尚未学习不算断档）。
 */
export function studyStreak(logs: StudyLog[], ref = new Date()): number {
  const days = new Set<string>();
  for (const l of logs) {
    const d = new Date(l.createTime);
    if (!Number.isNaN(d.getTime())) days.add(localDateOf(d));
  }
  if (days.size === 0) return 0;
  const refDay = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  let cursor = days.has(localDateOf(refDay)) ? refDay : new Date(refDay.getTime() - 86400000);
  let streak = 0;
  while (days.has(localDateOf(cursor))) {
    streak += 1;
    cursor = new Date(cursor.getTime() - 86400000);
  }
  return streak;
}

export interface ReviewForecastDay {
  /** 本地日期 YYYY-MM-DD */
  date: string;
  /** 今天 / 明天 / 周一… */
  label: string;
  /** 当日到期复习量 */
  count: number;
}

const WEEK_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** 未来 days 天（含今天）每日到期复习量；已过期与超窗口的不计 */
export function reviewForecast(schedules: ReviewSchedule[], days = 7, ref = new Date()): ReviewForecastDay[] {
  const refDay = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const out: ReviewForecastDay[] = [];
  const idxByKey = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const d = new Date(refDay.getTime() + i * 86400000);
    const key = localDateOf(d);
    idxByKey.set(key, i);
    out.push({ date: key, label: i === 0 ? "今天" : i === 1 ? "明天" : WEEK_LABELS[d.getDay()], count: 0 });
  }
  for (const s of schedules) {
    // dueTime 为纯本地日期（YYYY-MM-DD）：前 10 位直接作键，
    // 避免 new Date() 把纯日期按 UTC 解析（UTC 负偏移时区会错到前一天）
    const key = s.dueTime.slice(0, 10);
    const idx = idxByKey.get(key);
    if (idx !== undefined) out[idx].count += 1;
  }
  return out;
}

export interface WrongSnapshot {
  /** 在管错题（active） */
  active: number;
  /** 近 7 天新增（任意状态） */
  weekNew: number;
  /** 接近毕业：active 且再答对 1 次即毕业 */
  nearGraduate: number;
}

export function wrongSnapshot(wrongs: WrongQuestion[], ref = new Date()): WrongSnapshot {
  const refDayStart = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate()).getTime();
  const weekAgo = refDayStart - 7 * 86400000;
  let active = 0;
  let weekNew = 0;
  let nearGraduate = 0;
  for (const w of wrongs) {
    const isActive = (w.status ?? "active") === "active";
    if (isActive) active += 1;
    const t = new Date(w.createTime).getTime();
    if (!Number.isNaN(t) && t >= weekAgo) weekNew += 1;
    if (isActive && (w.correctStreak ?? 0) >= WRONG_GRADUATE_STREAK - 1) nearGraduate += 1;
  }
  return { active, weekNew, nearGraduate };
}
