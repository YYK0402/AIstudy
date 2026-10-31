import type { Mastery } from "../types/appData";

/** 掌握度四级阶梯（低 → 高） */
export const MASTERY_LADDER: Mastery[] = ["unlearn", "known", "mastered", "proficient"];

export const MASTERY_LABELS: Record<Mastery, string> = {
  unlearn: "未学习",
  known: "了解",
  mastered: "掌握",
  proficient: "精通",
};

/** 按阶梯升降 delta 档（钳制两端）；未变化返回 null */
export function nextMastery(current: Mastery, delta: number): Mastery | null {
  const idx = MASTERY_LADDER.indexOf(current);
  if (idx < 0) return null;
  const next = MASTERY_LADDER[Math.max(0, Math.min(MASTERY_LADDER.length - 1, idx + delta))];
  return next === current ? null : next;
}

/** 掌握度变化说明（「了解 → 掌握」）；无变化返回 null */
export function masteryChangeText(from: Mastery, to: Mastery | null): string | null {
  if (!to || to === from) return null;
  return `${MASTERY_LABELS[from]} → ${MASTERY_LABELS[to]}`;
}
