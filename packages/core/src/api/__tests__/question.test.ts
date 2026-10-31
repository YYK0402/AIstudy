import { describe, expect, it } from "vitest";
import type { AppData } from "../../types/appData";
import { createEmptyData } from "../../types/appData";
import { setBridge } from "../../bridge";
import type { StudyBridge } from "../../bridge/types";

// 桥 mock：storage.ts 顶层会注册事件监听，必须在导入 api 模块前建立 window
const dataRef: { data: AppData } = {
  data: {
    ...createEmptyData(),
    examPapers: [{ id: 100, courseId: 1, name: "2024 真题", year: 2024, createTime: "2026-10-01T00:00:00Z" }],
    questions: [
      {
        id: 1, courseId: 1, kpIds: "1", title: "试卷内题", options: "[]", answer: "A",
        analysis: "", qType: "single", difficulty: "easy", source: "import", paperId: 100, createTime: "2026-10-01T00:00:00Z",
      },
      {
        id: 2, courseId: 1, kpIds: "1", title: "普通题", options: "[]", answer: "A",
        analysis: "", qType: "single", difficulty: "easy", source: "ai", paperId: null, createTime: "2026-10-01T00:00:00Z",
      },
    ],
    answerRecords: [
      { id: 1, qId: 1, userAnswer: "A", isCorrect: false, score: "", createTime: "2026-10-01T00:00:00Z" },
      { id: 2, qId: 2, userAnswer: "A", isCorrect: true, score: "", createTime: "2026-10-01T00:00:00Z" },
    ],
    questionAsks: [
      { id: 1, qId: 1, courseId: 1, turns: [], updateTime: "2026-10-01T00:00:00Z" },
      { id: 2, qId: 2, courseId: 1, turns: [], updateTime: "2026-10-01T00:00:00Z" },
    ],
    wrongQuestions: [
      { id: 1, recordId: 1, qId: 1, reviewTimes: 0, createTime: "2026-10-01T00:00:00Z" },
    ],
    reviewSchedules: [
      {
        id: 1, kpId: null, qId: 1, stage: 1, dueTime: "2026-10-02T00:00:00Z",
        easeFactor: 2.5, intervalDays: 1, lastReviewTime: null, reviewTimes: 0,
      },
      {
        id: 2, kpId: null, qId: 2, stage: 1, dueTime: "2026-10-02T00:00:00Z",
        easeFactor: 2.5, intervalDays: 1, lastReviewTime: null, reviewTimes: 0,
      },
      {
        id: 3, kpId: 1, qId: null, stage: 1, dueTime: "2026-10-02T00:00:00Z",
        easeFactor: 2.5, intervalDays: 1, lastReviewTime: null, reviewTimes: 0,
      },
    ],
  },
};
(globalThis as Record<string, unknown>).window = {
  addEventListener: () => {},
  dispatchEvent: () => true,

};
setBridge({
    getData: async () => dataRef.data,
    saveData: async (next: AppData) => {
      dataRef.data = next;
      return { code: 0 };
    },
  } as unknown as StudyBridge);

const { deleteExamPaper } = await import("../question");

describe("deleteExamPaper 级联清理", () => {
  it("删除试卷关联题目的答题记录/错题/复习排期，保留非关联数据", async () => {
    await deleteExamPaper(100);
    const d = dataRef.data;
    expect(d.examPapers).toHaveLength(0);
    // 题目：试卷内题删除，普通题保留
    expect(d.questions.map((q) => q.id)).toEqual([2]);
    // 答题记录：qId=1 的删除
    expect(d.answerRecords.map((r) => r.id)).toEqual([2]);
    // 错题：qId=1 的删除
    expect(d.wrongQuestions).toHaveLength(0);
    // 复习排期：qId=1 的题目触点删除，普通题触点与知识点触点保留
    expect(d.reviewSchedules.map((s) => s.id).sort()).toEqual([2, 3]);
    // 问答会话：试卷内题的删除，普通题的保留
    expect(d.questionAsks.map((a) => a.id)).toEqual([2]);
  });
});
