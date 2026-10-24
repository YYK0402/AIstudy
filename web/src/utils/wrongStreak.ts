import type { WrongQuestion } from "../types/appData";

/** 错题毕业阈值：连续答对/牢固 N 次 */
export const WRONG_GRADUATE_STREAK = 2;

/**
 * 错题结果状态机（原地修改 wrongList，返回被触碰的条目或 null）。
 * wrong：不存在则新建 active/streak0/reviewTimes1；存在（含已毕业）则重新激活 active/streak0 并 reviewTimes++。
 * correct：不存在则忽略返回 null；已毕业则忽略返回 null；active 则 streak+1，达到阈值转 graduated 并记 graduatedAt。
 */
export function recordWrongResult(
  wrongList: WrongQuestion[],
  qId: number,
  outcome: "wrong" | "correct",
  nowIso: string,
): WrongQuestion | null {
  const existing = wrongList.find((w) => w.qId === qId);

  if (outcome === "wrong") {
    if (existing) {
      existing.status = "active";
      existing.correctStreak = 0;
      existing.graduatedAt = null;
      existing.reviewTimes++;
      return existing;
    }
    const created: WrongQuestion = {
      id: wrongList.reduce((max, w) => Math.max(max, w.id), 0) + 1,
      recordId: null,
      qId,
      reviewTimes: 1,
      createTime: nowIso,
      status: "active",
      correctStreak: 0,
      graduatedAt: null,
    };
    wrongList.push(created);
    return created;
  }

  if (!existing) return null;
  if (existing.status === "graduated") return null;
  const streak = (existing.correctStreak ?? 0) + 1;
  if (streak >= WRONG_GRADUATE_STREAK) {
    existing.status = "graduated";
    existing.correctStreak = streak;
    existing.graduatedAt = nowIso;
  } else {
    existing.status = "active";
    existing.correctStreak = streak;
  }
  return existing;
}
