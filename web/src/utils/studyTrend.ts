import type { StudyLog } from "../api";

export interface StudyTrendDay {
  /** 本地日期 YYYY-MM-DD */
  date: string;
  /** 当日累计学习时长（秒） */
  seconds: number;
  /** 当日学习动作数（答题/讲解/复习/打卡） */
  actions: number;
}

export interface StudyTrend {
  totalSeconds: number;
  /** 近 N 天（含今天）按日升序，无记录日补 0 */
  daily: StudyTrendDay[];
}

/** 本地日期 YYYY-MM-DD（与计划任务日期同一口径） */
export function localDateOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * 按本地日期聚合学习日志，返回最近 days 天（含 ref 当天）的时长趋势。
 * duration 仅累加正数（手动打卡 0 秒只计动作）；非法 createTime 跳过。
 */
export function aggregateStudyTrend(logs: StudyLog[], days = 30, ref = new Date()): StudyTrend {
  const refDay = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const byDay = new Map<string, StudyTrendDay>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(refDay.getTime() - i * 86400000);
    const key = localDateOf(d);
    byDay.set(key, { date: key, seconds: 0, actions: 0 });
  }
  let totalSeconds = 0;
  for (const l of logs) {
    const d = new Date(l.createTime);
    if (Number.isNaN(d.getTime())) continue;
    const day = byDay.get(localDateOf(d));
    if (!day) continue;
    const sec = Number.isFinite(l.duration) && l.duration > 0 ? l.duration : 0;
    day.seconds += sec;
    day.actions += 1;
    totalSeconds += sec;
  }
  return { totalSeconds, daily: [...byDay.values()] };
}

/** 秒 → 人类可读时长：<60s 显秒，<1h 显分钟（四舍五入），否则 X 小时 Y 分 */
export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s} 秒`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm === 0 ? `${h} 小时` : `${h} 小时 ${rm} 分`;
}
