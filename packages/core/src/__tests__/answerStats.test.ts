import { describe, expect, it } from "vitest";
import { aggregateAnswers, maxStudyTime } from "../utils/answerStats";
import type { AnswerRecord, AnswerStatsMonthly, Question, StudyLogMonthly } from "../types/appData";

function question(id: number, qType: Question["qType"]): Question {
  return {
    id,
    courseId: 1,
    kpIds: "",
    title: `Q${id}`,
    options: "[]",
    answer: "A",
    analysis: "",
    qType,
    difficulty: "easy",
    source: "manual",
    paperId: null,
    createTime: "2026-01-01T00:00:00Z",
  };
}

function record(id: number, qId: number, isCorrect: boolean, score: string, assisted?: boolean): AnswerRecord {
  return { id, qId, userAnswer: "x", isCorrect, score, createTime: "2026-01-01T00:00:00Z", ...(assisted ? { assisted: true } : {}) };
}

const monthly: AnswerStatsMonthly[] = [
  { courseId: 1, month: "2026-01", total: 10, correct: 7, essayTotalScore: 450, essayCount: 5 },
];

describe("aggregateAnswers", () => {
  it("原始记录口径：仅现存题目；简答仅可解析得分", () => {
    const questions = [question(1, "single"), question(2, "essay")];
    const records = [
      record(1, 1, true, "100"),
      record(2, 2, false, "75"),
      record(3, 2, true, "N/A"), // 不可解析
      record(4, 999, true, "100"), // 题目已删
    ];
    expect(aggregateAnswers(records, questions, [])).toEqual({
      total: 3,
      correct: 2,
      essayTotalScore: 75,
      essayCount: 1,
      assistedTotal: 0,
      assistedCorrect: 0,
    });
  });

  it("与月度归档合并（归档前口径一致）", () => {
    const questions = [question(1, "single")];
    const records = [record(1, 1, true, "100")];
    expect(aggregateAnswers(records, questions, monthly)).toEqual({
      total: 11,
      correct: 8,
      essayTotalScore: 450,
      essayCount: 5,
      assistedTotal: 0,
      assistedCorrect: 0,
    });
  });

  it("空输入全 0", () => {
    expect(aggregateAnswers([], [], [])).toEqual({
      total: 0,
      correct: 0,
      essayTotalScore: 0,
      essayCount: 0,
      assistedTotal: 0,
      assistedCorrect: 0,
    });
  });

  it("受助口径：仅统计 assisted 记录，答对单独计；旧归档缺字段按 0", () => {
    const questions = [question(1, "single"), question(2, "single")];
    const records = [
      record(1, 1, true, "100", true), // 受助对
      record(2, 2, false, "0", true), // 受助错
      record(3, 1, true, "100"), // 独立对
    ];
    const oldMonthly: AnswerStatsMonthly[] = [
      { courseId: 1, month: "2026-01", total: 4, correct: 2, essayTotalScore: 0, essayCount: 0 }, // 无受助字段
      { courseId: 1, month: "2026-02", total: 3, correct: 1, essayTotalScore: 0, essayCount: 0, assistedTotal: 2, assistedCorrect: 1 },
    ];
    expect(aggregateAnswers(records, questions, oldMonthly)).toEqual({
      total: 10,
      correct: 5,
      essayTotalScore: 0,
      essayCount: 0,
      assistedTotal: 4,
      assistedCorrect: 2,
    });
  });
});

describe("maxStudyTime", () => {
  it("取原始与归档 lastDay 的较大值", () => {
    const m: Pick<StudyLogMonthly, "lastDay">[] = [{ lastDay: "2026-07-01" }, { lastDay: "2026-10-01" }];
    expect(maxStudyTime("2026-10-26T06:13:51.990Z", m)).toBe("2026-10-26T06:13:51.990Z");
    expect(maxStudyTime("2026-06-01T00:00:00Z", m)).toBe("2026-10-01");
    expect(maxStudyTime("", m)).toBe("2026-10-01");
    expect(maxStudyTime("", [])).toBe("");
  });
});
