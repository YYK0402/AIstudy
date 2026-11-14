import type { AnswerRecord, AnswerStatsMonthly, Course, Question, StudyLogMonthly } from "../types/appData";
import { typeModeOf } from "./questionTypes";

export interface AnswerAggregates {
  total: number;
  correct: number;
  essayTotalScore: number;
  essayCount: number;
  /** 受助作答数（该题本轮用过 AI 问答） */
  assistedTotal: number;
  /** 受助答对数 */
  assistedCorrect: number;
}

/**
 * 原始作答记录 + 月度归档的合并聚合。
 * 原始记录口径与归档前报表一致：仅统计现存题目；简答仅统计可解析为数字的得分。
 * 月度归档在归档时已按同口径累计（题目已删的按非简答计），直接累加即可。
 */
export function aggregateAnswers(
  records: AnswerRecord[],
  questions: Question[],
  monthly: AnswerStatsMonthly[],
  course: Course | null = null,
): AnswerAggregates {
  const qById = new Map(questions.map((q) => [q.id, q]));
  const out: AnswerAggregates = { total: 0, correct: 0, essayTotalScore: 0, essayCount: 0, assistedTotal: 0, assistedCorrect: 0 };
  for (const r of records) {
    const q = qById.get(r.qId);
    if (!q) continue;
    out.total += 1;
    if (r.isCorrect) out.correct += 1;
    if (r.assisted) {
      out.assistedTotal += 1;
      if (r.isCorrect) out.assistedCorrect += 1;
    }
    if (typeModeOf(course, q.qType) === "essay") {
      const n = Number(r.score);
      if (Number.isFinite(n)) {
        out.essayTotalScore += n;
        out.essayCount += 1;
      }
    }
  }
  for (const m of monthly) {
    out.total += m.total;
    out.correct += m.correct;
    out.essayTotalScore += m.essayTotalScore;
    out.essayCount += m.essayCount;
    out.assistedTotal += m.assistedTotal ?? 0;
    out.assistedCorrect += m.assistedCorrect ?? 0;
  }
  return out;
}

/**
 * 最近学习时间：原始 StudyLog 最大 createTime 与月度归档最大 lastDay 取大。
 * createTime 为 ISO 字符串、lastDay 为 YYYY-MM-DD，字典序与时间序一致（日期部分在前）。
 */
export function maxStudyTime(rawMax: string, monthly: Pick<StudyLogMonthly, "lastDay">[]): string {
  let max = rawMax;
  for (const m of monthly) {
    if (m.lastDay > max) max = m.lastDay;
  }
  return max;
}
