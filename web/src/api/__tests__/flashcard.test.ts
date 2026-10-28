import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { AppData } from "../../types/appData";
import { createEmptyData } from "../../../../src/data";

setActivePinia(createPinia());

function makeData(kpCount: number): AppData {
  return {
    ...createEmptyData(),
    providers: [
      { id: 1, name: "T", baseUrl: "https://t.example/v1", apiKey: "k", timeout: 60, enabled: true, createTime: "2026-10-01T00:00:00Z" },
    ],
    models: [
      { id: 1, providerId: 1, modelId: "m-1", displayName: "M", maxContext: null, temperature: null, maxTokens: null },
    ],
    taskModels: [{ taskKey: "gen_flashcard", modelId: 1, isGlobalDefault: false }],
    courses: [
      {
        id: 1, siyuanDocId: null, name: "测试课程", description: "", target: "",
        totalCycle: "", status: "active", createTime: "2026-10-01T00:00:00Z", modelId: null,
      },
    ],
    knowledgePoints: Array.from({ length: kpCount }, (_, i) => ({
      id: i + 1, courseId: 1, chapterId: null, blockId: null, name: `KP${i + 1}`, content: "内容",
      mastery: "unlearn" as const, sourceAssetIds: "", prevKpIds: "", chapterName: "",
      sort: i, createTime: "2026-10-01T00:00:00Z",
    })),
  };
}

const dataRef: { data: AppData } = { data: makeData(12) };
const calls: { ai: number; flag: { aborted: boolean }; abortAfterFirst: boolean } = {
  ai: 0,
  flag: { aborted: false },
  abortAfterFirst: false,
};
(globalThis as Record<string, unknown>).window = {
  addEventListener: () => {},
  dispatchEvent: () => true,
  setInterval: () => 0,
  clearInterval: () => {},
  siyuanAiStudy: {
    getData: async () => dataRef.data,
    saveData: async (next: AppData) => {
      dataRef.data = next;
      return { code: 0 };
    },
    callAi: async () => {
      calls.ai++;
      if (calls.abortAfterFirst && calls.ai === 1) calls.flag.aborted = true; // 第一批完成后取消
      // 第一批 10 个知识点 → 10 张卡；第二批 2 个 → 2 张卡
      const n = calls.ai === 1 ? 10 : 2;
      return {
        content: JSON.stringify(Array.from({ length: n }, (_, i) => ({ index: i, front: `问题${i + 1}`, back: `答案${i + 1}` }))),
        tokenIn: 1,
        tokenOut: 1,
      };
    },
  },
};

const { generateFlashcards } = await import("../flashcard");
const { useNotifyStore, courseTaskId } = await import("../../stores/notify");

function taskStatus(): string | undefined {
  return useNotifyStore().tasks.find((t) => t.taskId === courseTaskId(1, "gen_flashcard"))?.status;
}

describe("generateFlashcards 可取消", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    dataRef.data = makeData(12);
    calls.ai = 0;
    calls.flag.aborted = false;
    calls.abortAfterFirst = false;
  });

  it("开始前已取消 → 不调 AI、不产生卡片、任务标记 canceled", async () => {
    calls.flag.aborted = true;
    const result = await generateFlashcards(1, Array.from({ length: 12 }, (_, i) => i + 1), {
      isAborted: () => calls.flag.aborted,
    });
    expect(calls.ai).toBe(0);
    expect(result.created).toBe(0);
    expect(dataRef.data.flashCards).toHaveLength(0);
    expect(taskStatus()).toBe("canceled");
  });

  it("批次间隙取消 → 已完成批次保留、后续批次不再调用、任务标记 canceled", async () => {
    calls.abortAfterFirst = true;
    const result = await generateFlashcards(1, Array.from({ length: 12 }, (_, i) => i + 1), {
      isAborted: () => calls.flag.aborted,
    });
    expect(calls.ai).toBe(1);
    expect(result.created).toBe(10);
    expect(dataRef.data.flashCards).toHaveLength(10);
    expect(taskStatus()).toBe("canceled");
  });
});
