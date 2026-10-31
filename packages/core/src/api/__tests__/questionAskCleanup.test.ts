import { describe, expect, it } from "vitest";
import type { AppData } from "../../types/appData";
import { createEmptyData } from "../../types/appData";
import { setBridge } from "../../bridge";
import type { StudyBridge } from "../../bridge/types";

const dataRef: { data: AppData } = { data: createEmptyData() };
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

const { deleteQuestion, deleteQuestions } = await import("../question");

function makeData(): AppData {
  return {
    ...createEmptyData(),
    questions: [
      { id: 1, courseId: 1, kpIds: "1", title: "题一", options: "[]", answer: "A", analysis: "", qType: "single", difficulty: "easy", source: "ai", paperId: null, createTime: "2026-10-01T00:00:00Z" },
      { id: 2, courseId: 1, kpIds: "1", title: "题二", options: "[]", answer: "A", analysis: "", qType: "single", difficulty: "easy", source: "ai", paperId: null, createTime: "2026-10-01T00:00:00Z" },
    ],
    questionAsks: [
      { id: 1, qId: 1, courseId: 1, turns: [{ role: "user", content: "？", createTime: "2026-10-01T00:00:00Z" }], updateTime: "2026-10-01T00:00:00Z" },
      { id: 2, qId: 2, courseId: 1, turns: [], updateTime: "2026-10-01T00:00:00Z" },
    ],
  };
}

describe("删除题目连带清理问答会话", () => {
  it("deleteQuestion 删除该题会话，保留其他题", async () => {
    dataRef.data = makeData();
    await deleteQuestion(1);
    expect(dataRef.data.questions.map((q) => q.id)).toEqual([2]);
    expect(dataRef.data.questionAsks.map((a) => a.id)).toEqual([2]);
  });

  it("deleteQuestions 批量删除对应会话", async () => {
    dataRef.data = makeData();
    const removed = await deleteQuestions([1, 2]);
    expect(removed).toBe(2);
    expect(dataRef.data.questionAsks).toHaveLength(0);
  });
});
