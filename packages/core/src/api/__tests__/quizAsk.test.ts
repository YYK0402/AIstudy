import { describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { AppData, Question } from "../../types/appData";
import { createEmptyData } from "../../types/appData";
import { setBridge } from "../../bridge";
import type { StudyBridge } from "../../bridge/types";
import { upsertAskSession, buildAskSystem, sendQuizAsk, queryQuestionAsk } from "../quizAsk";

setActivePinia(createPinia());

function makeData(): AppData {
  const data = createEmptyData();
  data.providers = [
    { id: 1, name: "T", baseUrl: "https://t.example/v1", apiKey: "k", timeout: 60000, enabled: true, createTime: "2026-01-01T00:00:00Z" },
  ];
  data.models = [{ id: 1, providerId: 1, modelId: "m-1", displayName: "M", maxContext: null, temperature: null, maxTokens: null }];
  data.courses = [
    { id: 1, siyuanDocId: null, name: "测试课程", description: "", target: "", totalCycle: "", status: "active", createTime: "2026-01-01T00:00:00Z" },
  ];
  data.knowledgePoints = [
    { id: 10, courseId: 1, chapterId: null, blockId: null, name: "甲知识点", content: "甲的内容描述", mastery: "unlearn", sourceAssetIds: "", prevKpIds: "", chapterName: "章A", sort: 1, createTime: "2026-01-01T00:00:00Z" },
  ];
  data.questions = [
    { id: 400, courseId: 1, kpIds: "10", title: "1+1=?", options: JSON.stringify(["A. 1", "B. 2", "C. 3", "D. 4"]), answer: "B. 2", analysis: "加法运算", qType: "single", difficulty: "easy", source: "manual", paperId: null, createTime: "2026-01-01T00:00:00Z" },
  ];
  data.taskModels = [{ taskKey: "quiz_ask", modelId: 1, isGlobalDefault: false }];
  return data;
}

let dataRef: { data: AppData };
let aiMessages: Array<{ role: string; content: string }[]> = [];

function installBridge() {
  dataRef = { data: makeData() };
  aiMessages = [];
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
    callAi: async (input: { messages: { role: string; content: string }[] }) => {
      aiMessages.push(input.messages);
      return { code: 0, content: "AI 回答：" + input.messages[input.messages.length - 1].content };
    },
  } as unknown as StudyBridge);
}

installBridge();

describe("upsertAskSession", () => {
  it("无会话时新建并追加 user 轮", () => {
    const data = makeData();
    const ask = upsertAskSession(data, 1, 400, "user", "为什么选 B？");
    expect(data.questionAsks).toHaveLength(1);
    expect(ask.qId).toBe(400);
    expect(ask.courseId).toBe(1);
    expect(ask.turns).toHaveLength(1);
    expect(ask.turns[0].role).toBe("user");
    expect(ask.turns[0].content).toBe("为什么选 B？");
  });

  it("已有会话时追加而不新建", () => {
    const data = makeData();
    const a1 = upsertAskSession(data, 1, 400, "user", "问题一");
    const a2 = upsertAskSession(data, 1, 400, "assistant", "回答一");
    expect(data.questionAsks).toHaveLength(1);
    expect(a2.id).toBe(a1.id);
    expect(a2.turns.map((t) => t.role)).toEqual(["user", "assistant"]);
  });

  it("不同题目各自独立会话", () => {
    const data = makeData();
    upsertAskSession(data, 1, 400, "user", "x");
    upsertAskSession(data, 1, 401, "user", "y");
    expect(data.questionAsks).toHaveLength(2);
  });
});

describe("buildAskSystem", () => {
  it("包含课程/题干/选项/答案/解析/知识点上下文", () => {
    const data = makeData();
    const q = data.questions[0];
    const sys = buildAskSystem(data, q);
    expect(sys).toContain("测试课程");
    expect(sys).toContain("1+1=?");
    expect(sys).toContain("A. 1");
    expect(sys).toContain("B. 2");
    expect(sys).toContain("加法运算");
    expect(sys).toContain("甲知识点");
    expect(sys).toContain("甲的内容描述");
  });

  it("无知识点绑定与无解析时给出占位说明", () => {
    const data = makeData();
    const q: Question = { ...data.questions[0], kpIds: "", analysis: "" };
    const sys = buildAskSystem(data, q);
    expect(sys).not.toContain("甲知识点");
    expect(sys).toContain("（无）");
  });
});

describe("sendQuizAsk", () => {
  it("一问一答落库：user + assistant 两轮持久化", async () => {
    installBridge();
    const reply = await sendQuizAsk(1, 400, "为什么选 B？");
    expect(reply).toBe("AI 回答：为什么选 B？");
    const asks = dataRef.data.questionAsks;
    expect(asks).toHaveLength(1);
    expect(asks[0].turns.map((t) => t.role)).toEqual(["user", "assistant"]);
    expect(asks[0].turns[1].content).toBe(reply);
  });

  it("第二轮携带历史轮次作为上下文", async () => {
    installBridge();
    await sendQuizAsk(1, 400, "为什么选 B？");
    await sendQuizAsk(1, 400, "能举个例子吗？");
    // 第二次调用的 messages：system + 上一轮 user/assistant + 当前 user
    const last = aiMessages[aiMessages.length - 1];
    expect(last.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(last[3].content).toBe("能举个例子吗？");
  });

  it("题目不存在时抛错且不落库", async () => {
    installBridge();
    await expect(sendQuizAsk(1, 999, "x")).rejects.toThrow("题目不存在");
    expect(dataRef.data.questionAsks).toHaveLength(0);
  });

  it("未配置任务模型时抛错", async () => {
    installBridge();
    dataRef.data.taskModels = [];
    await expect(sendQuizAsk(1, 400, "x")).rejects.toThrow("未配置 AI 任务模型");
  });

  it("queryQuestionAsk 读回会话", async () => {
    installBridge();
    await sendQuizAsk(1, 400, "你好");
    const s = await queryQuestionAsk(400);
    expect(s).not.toBeNull();
    expect(s!.turns).toHaveLength(2);
    expect(await queryQuestionAsk(999)).toBeNull();
  });
});
