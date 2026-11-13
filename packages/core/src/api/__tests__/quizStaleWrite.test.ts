import { describe, expect, it, vi } from "vitest";
import type { AppData, AnswerRecord, Question } from "../../types/appData";
import { createEmptyData } from "../../types/appData";
import { setBridge } from "../../bridge";
import type { StudyBridge } from "../../bridge/types";

// mock AI 阅卷：返回固定 85 分；callAi 执行时触发替换钩子（模拟判分期间内存对象被替换）
const hooks: { onAi: (() => void) | null } = { onAi: null };
vi.mock("../ai", () => ({
  findTaskBinding: () => ({ providerId: 1, modelId: 1 }),
  callAi: async () => {
    hooks.onAi?.();
    return { content: "```json\n{\"score\": 85, \"feedback\": \"good\"}\n```" };
  },
}));

const essayQuestion: Question = {
  id: 1,
  courseId: 1,
  kpIds: "",
  title: "简答题",
  options: "[]",
  answer: "参考答案要点",
  analysis: "",
  qType: "essay",
  difficulty: "easy",
  source: "manual",
  paperId: null,
  createTime: "2026-10-01T00:00:00Z",
};

function makeData(): AppData {
  const d = createEmptyData();
  d.courses = [
    { id: 1, siyuanDocId: "doc1", name: "课程", description: "", target: "", totalCycle: "", status: "active", createTime: "2026-01-01T00:00:00Z" },
  ];
  d.questions = [essayQuestion];
  return d;
}

const saves: AppData[] = [];
let current: AppData = makeData();
setBridge({
  getData: async () => current,
  saveData: async (d: AppData) => {
    saves.push(d);
    return { code: 0 };
  },
} as unknown as StudyBridge);

const { submitAnswer, regradeAnswer } = await import("../quiz");

describe("长 AI 调用后重取数据（脏写防护）", () => {
  it("submitAnswer 简答判分：判分期间内存对象被替换，最终落库的是最新对象而非旧引用", async () => {
    current = makeData();
    saves.length = 0;
    let v2: AppData | null = null;
    hooks.onAi = () => {
      // 判分前已落盘 → 替换后的对象（模拟回滚/重建）含同一作答记录
      const rec = current.answerRecords[current.answerRecords.length - 1];
      v2 = makeData();
      v2.answerRecords.push({ ...rec });
      current = v2;
    };
    const result = await submitAnswer(essayQuestion, "我的回答", 10);
    expect(result.isCorrect).toBe(true);
    expect(result.score).toBe("85");
    expect(v2).not.toBeNull();
    const finalSaved = saves[saves.length - 1];
    // 关键断言：最终落库的是替换后的最新对象，不是判分前持有的旧引用
    expect(finalSaved).toBe(v2);
    const recId = v2!.answerRecords[0].id;
    const finalRec = finalSaved.answerRecords.find((r) => r.id === recId)!;
    expect(finalRec.graded).toBe(true);
    expect(finalRec.score).toBe("85");
    // 旧对象未被回填（若发生脏写，这里会看到 graded=true）
    const staleRec = saves[0].answerRecords.find((r) => r.id === recId)!;
    expect(staleRec.graded).toBe(false);
    hooks.onAi = null;
  });

  it("regradeAnswer：判分期间内存对象被替换，回填与副作用落在最新对象", async () => {
    const seeded: AnswerRecord = {
      id: 9, qId: 1, userAnswer: "旧作答", isCorrect: false, score: "0",
      createTime: "2026-10-02T00:00:00Z", graded: false,
    };
    const v1 = makeData();
    v1.answerRecords.push(seeded);
    const v2 = makeData();
    v2.answerRecords.push({ ...seeded });
    // 判分前函数持有 v1 引用；判分期间内存对象被替换为 v2
    current = v1;
    saves.length = 0;
    hooks.onAi = () => {
      current = v2;
    };
    const result = await regradeAnswer(essayQuestion, 9);
    expect(result.isCorrect).toBe(true);
    expect(result.score).toBe("85");
    const finalSaved = saves[saves.length - 1];
    expect(finalSaved).toBe(v2);
    const finalRec = finalSaved.answerRecords.find((r) => r.id === 9)!;
    expect(finalRec.graded).toBe(true);
    expect(finalRec.score).toBe("85");
    // 旧对象未被回填
    const staleRec = v1.answerRecords.find((r) => r.id === 9)!;
    expect(staleRec.graded).toBe(false);
    hooks.onAi = null;
  });
});
