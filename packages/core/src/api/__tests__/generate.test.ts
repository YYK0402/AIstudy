import { describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { AppData } from "../../types/appData";
import { createEmptyData } from "../../types/appData";
import { getBridge, setBridge } from "../../bridge";
import type { StudyBridge } from "../../bridge/types";

setActivePinia(createPinia());

const dataRef: { data: AppData } = {
  data: {
    ...createEmptyData(),
    providers: [
      { id: 1, name: "T", baseUrl: "https://t.example/v1", apiKey: "k", timeout: 60, enabled: true, createTime: "2026-10-01T00:00:00Z" },
    ],
    models: [
      { id: 1, providerId: 1, modelId: "m-1", displayName: "M", maxContext: null, temperature: null, maxTokens: null },
    ],
    courses: [
      {
        id: 1, siyuanDocId: null, name: "测试课程", description: "", target: "",
        totalCycle: "", status: "active", createTime: "2026-10-01T00:00:00Z", modelId: 1,
      },
    ],
    knowledgePoints: [
      {
        id: 1, courseId: 1, chapterId: null, blockId: null, name: "KP1", content: "内容",
        mastery: "unlearn", sourceAssetIds: "", prevKpIds: "", chapterName: "",
        sort: 0, createTime: "2026-10-01T00:00:00Z",
      },
    ],
  },
};
(globalThis as Record<string, unknown>).window = {
  addEventListener: () => {},
  dispatchEvent: () => true,
  setInterval: () => 0,
  clearInterval: () => {},

};
setBridge({
    getData: async () => dataRef.data,
    saveData: async (next: AppData) => {
      dataRef.data = next;
      return { code: 0 };
    },
    callAi: async () => {
      await new Promise((r) => setTimeout(r, 60));
      return {
        code: 0,
        content: JSON.stringify([
          { qType: "single", kpIds: [1], title: "并发守卫测试题", options: ["A. 甲", "B. 乙"], answer: "A. 甲", analysis: "", difficulty: "easy" },
        ]),
      };
    },
  } as unknown as StudyBridge);

const { generateQuestions } = await import("../generate");

describe("generateQuestions 并发守卫", () => {
  it("同一课程并发出题 → 第二个调用被拒绝，完成后守卫释放", async () => {
    const a = generateQuestions(1, { kpIds: [1], count: 1, qType: "single", difficulty: "easy" });
    const b = generateQuestions(1, { kpIds: [1], count: 1, qType: "single", difficulty: "easy" });
    const results = await Promise.allSettled([a, b]);
    const rejected = results.filter((r) => r.status === "rejected");
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(Error);
    expect((rejected[0].reason as Error).message).toContain("出题中");
    // 守卫释放：再次调用可正常执行
    await expect(generateQuestions(1, { kpIds: [1], count: 1, qType: "single", difficulty: "easy" })).resolves.toHaveLength(1);
  });

  it("失败后守卫释放，可再次出题", async () => {
    const bridge = getBridge();
    const origCallAi = bridge.callAi;
    bridge.callAi = async () => {
      throw new Error("AI 调用失败");
    };
    await expect(
      generateQuestions(1, { kpIds: [1], count: 1, qType: "single", difficulty: "easy" }),
    ).rejects.toThrow("AI 调用失败");
    bridge.callAi = origCallAi;
    await expect(generateQuestions(1, { kpIds: [1], count: 1, qType: "single", difficulty: "easy" })).resolves.toHaveLength(1);
  });
});
