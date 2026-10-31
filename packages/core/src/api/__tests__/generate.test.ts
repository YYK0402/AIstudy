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

describe("generateQuestions 文章题", () => {
  it("选择填空：词池选项 + 编号空位 → blanks 落库", async () => {
    const bridge = getBridge();
    const origCallAi = bridge.callAi;
    bridge.callAi = async () => ({
      code: 0,
      tokenIn: 0,
      tokenOut: 0,
      content: JSON.stringify([
        {
          qType: "banked",
          kpIds: [1],
          title: "He __41__ a student and __42__ fast.",
          options: ["is", "run", "walks"],
          answer: "41:is|42:run",
          analysis: "",
          difficulty: "easy",
        },
      ]),
    });
    const created = await generateQuestions(1, { kpIds: [1], count: 1, qType: "banked", difficulty: "easy" });
    expect(created).toHaveLength(1);
    expect(created[0].qType).toBe("banked");
    expect(JSON.parse(created[0].options)).toEqual(["is", "run", "walks"]);
    expect(JSON.parse(created[0].blanks!)).toEqual([
      { no: 41 },
      { no: 42 },
    ]);
    expect(created[0].answer).toBe("41:is|42:run");
    bridge.callAi = origCallAi;
  });

  it("完形：二维选项数组原样落库，无空位标记的选填被剔除", async () => {
    const bridge = getBridge();
    const origCallAi = bridge.callAi;
    bridge.callAi = async () => ({
      code: 0,
      tokenIn: 0,
      tokenOut: 0,
      content: JSON.stringify([
        {
          qType: "cloze",
          kpIds: [1],
          title: "It __41__ sunny today.",
          options: [["is", "are", "was", "be"]],
          answer: "41:A",
          analysis: "",
          difficulty: "medium",
        },
        {
          qType: "banked",
          kpIds: [1],
          title: "没有空位标记的题干",
          options: ["a", "b"],
          answer: "a",
          analysis: "",
          difficulty: "easy",
        },
      ]),
    });
    const created = await generateQuestions(1, { kpIds: [1], count: 2, qType: "cloze", difficulty: "medium" });
    expect(created).toHaveLength(1);
    expect(created[0].qType).toBe("cloze");
    expect(JSON.parse(created[0].options)).toEqual([["is", "are", "was", "be"]]);
    expect(created[0].blanks).toBe(JSON.stringify([{ no: 41 }]));
    bridge.callAi = origCallAi;
  });
});
