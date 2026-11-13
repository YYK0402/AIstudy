import { describe, expect, it } from "vitest";
import type { AppData } from "../../types/appData";
import { createEmptyData } from "../../types/appData";
import { setBridge } from "../../bridge";
import type { StudyBridge } from "../../bridge/types";

const dataRef: { data: AppData } = {
  data: {
    ...createEmptyData(),
    questions: [
      {
        id: 1, courseId: 1, kpIds: "1", title: "普通题", options: "[]", answer: "A",
        analysis: "", qType: "single", difficulty: "easy", source: "manual", paperId: null, createTime: "2026-10-01T00:00:00Z",
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

const { submitAnswer } = await import("../quiz");

const q = dataRef.data.questions[0];

describe("submitAnswer 受助口径", () => {
  it("assisted: true 时落库 assisted 标记", async () => {
    await submitAnswer(q, "A", 10, { assisted: true });
    const r = dataRef.data.answerRecords.at(-1)!;
    expect(r.isCorrect).toBe(true);
    expect(r.assisted).toBe(true);
  });

  it("未传 assisted 时不落字段（旧口径兼容）", async () => {
    await submitAnswer(q, "B", 10);
    const r = dataRef.data.answerRecords.at(-1)!;
    expect(r.isCorrect).toBe(false);
    expect(r.assisted).toBeUndefined();
  });
});
