import { formatLocalDate } from "./format";

/** 计划天数：含开始日与目标日两端 */
export function countPlanDays(startDate: string, targetDate: string): number {
  return Math.max(
    1,
    Math.round((new Date(targetDate).getTime() - new Date(startDate).getTime()) / (24 * 60 * 60 * 1000)) + 1,
  );
}

/** 知识点按天均分；知识点少于天数时空日为 [] */
export function distributeKpsByDay<T>(
  kps: T[],
  days: number,
  startDate: string,
): Array<{ date: string; kps: T[] }> {
  const total = Math.max(1, Math.floor(days));
  const perDay = Math.ceil(kps.length / total);
  const out: Array<{ date: string; kps: T[] }> = [];
  for (let i = 0; i < total; i++) {
    const d = new Date(startDate + "T00:00:00");
    d.setDate(d.getDate() + i);
    out.push({ date: formatLocalDate(d), kps: kps.slice(i * perDay, (i + 1) * perDay) });
  }
  return out;
}
