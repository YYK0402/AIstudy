// 薄弱知识点排行（T2.17 报告页清单 / T3.2 排行共用）
// 得分 = 掌握度基础分 + 低分讲解惩罚 + 高频错题惩罚；分越高越薄弱
import type { KnowledgePoint, Mastery } from "../api";

export interface WeakKpEntry {
  kpId: number;
  name: string;
  mastery: Mastery;
  score: number;
  reasons: string[];
}

/** 掌握度基础分：越未掌握基础分越高 */
const MASTERY_BASE: Record<Mastery, number> = {
  unlearn: 40,
  known: 25,
  mastered: 10,
  proficient: 0,
};

const EXPLAIN_PENALTY_RATIO = 0.4; // (100 - 最低讲解分) × 0.4
const WRONG_PER_COUNT = 8; // 每条错题 +8
const WRONG_CAP = 5; // 错题惩罚封顶 5 条

export function rankWeakKps(args: {
  kps: KnowledgePoint[];
  /** 讲解记录（仅需 kpId + aiScore） */
  explainScores: Array<{ kpId: number; aiScore: string }>;
  /** kpId → 未移出错题条数 */
  wrongKpCounts: Map<number, number>;
  topN?: number;
}): WeakKpEntry[] {
  const { kps, explainScores, wrongKpCounts, topN = 5 } = args;
  const byKp = new Map<number, number[]>();
  for (const r of explainScores) {
    const s = Number(r.aiScore);
    if (!Number.isFinite(s)) continue;
    const list = byKp.get(r.kpId) ?? [];
    list.push(s);
    byKp.set(r.kpId, list);
  }
  const entries: WeakKpEntry[] = [];
  for (const kp of kps) {
    const reasons: string[] = [];
    let score = MASTERY_BASE[kp.mastery] ?? 0;
    const scores = byKp.get(kp.id);
    if (scores && scores.length > 0) {
      const min = Math.min(...scores);
      score += Math.round((100 - min) * EXPLAIN_PENALTY_RATIO);
      if (min < 60) reasons.push(`讲解低分 ${Math.round(min)}`);
    }
    const wc = wrongKpCounts.get(kp.id) ?? 0;
    if (wc > 0) {
      score += Math.min(wc, WRONG_CAP) * WRONG_PER_COUNT;
      reasons.push(`错题 ${wc} 题`);
    }
    if (kp.mastery === "unlearn" && reasons.length === 0) reasons.push("未学习");
    if (score > 0) {
      entries.push({ kpId: kp.id, name: kp.name, mastery: kp.mastery, score: Math.round(score), reasons });
    }
  }
  entries.sort((a, b) => b.score - a.score || a.kpId - b.kpId);
  return entries.slice(0, topN);
}
