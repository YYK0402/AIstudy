import { describe, expect, it } from "vitest";
import type { AppData } from "../../types/appData";
import { createEmptyData } from "../../types/appData";
import { setBridge, type StudyBridge } from "../../bridge";
import {
  resolveMaterialQuestionNodes,
  normalizeQuestionTitle,
  parseQuestionItems,
  extractNodeQuestions,
  extractQuestionsFromMaterial,
} from "../questionExtract";

type CallAiInput = { messages: { role: string; content: string }[] };
type CallAiResp = { content: string; tokenIn: number; tokenOut: number };

// 假桥：数据读写走假桥，AI 响应由可替换的 callAiImpl 返回并计数
let aiContent = "[]";
let callAiImpl: (input: CallAiInput) => Promise<CallAiResp> = async () => ({
  content: aiContent,
  tokenIn: 0,
  tokenOut: 0,
});
let callAiCount = 0;
let lastUserPrompt = "";
const bridgeDataRef: { data: AppData } = { data: createEmptyData() };
setBridge({
  getData: async () => bridgeDataRef.data,
  saveData: async (next: AppData) => {
    bridgeDataRef.data = next;
    return { code: 0 };
  },
  callAi: async (input: CallAiInput) => {
    callAiCount++;
    lastUserPrompt = input.messages.find((m) => m.role === "user")?.content ?? "";
    return callAiImpl(input);
  },
} as unknown as StudyBridge);

// fixture：课程 1；章 1（level1）→ 节 2（level2）；章 4（level1）
// 资料 10 映射: @第一章→1, @第一章>1.1→2；资料 11 无映射（整段回落）
// 节点 1 有 KP（id 100）；课程已有题目 1 道（题干「项目的定义」）
function fixture(): AppData {
  const d = createEmptyData();
  d.courses = [{ id: 1, siyuanDocId: null, name: "C", description: "", target: "", totalCycle: "", status: "active", createTime: "t", modelId: 1 }];
  d.providers = [{ id: 1, name: "P", baseUrl: "http://x", apiKey: "k", timeout: 60000, enabled: true, createTime: "t" }];
  d.models = [{ id: 1, providerId: 1, modelId: "m-1", displayName: "M", maxContext: null }];
  d.chapters = [
    { id: 1, courseId: 1, parentId: null, siyuanBlockId: null, name: "第一章", level: 1, sort: 1 },
    { id: 2, courseId: 1, parentId: 1, siyuanBlockId: null, name: "1.1", level: 2, sort: 1 },
    { id: 4, courseId: 1, parentId: null, siyuanBlockId: null, name: "第二章", level: 1, sort: 2 },
  ];
  const base = {
    id: 0, courseId: 1, name: "", fileType: "txt", assetPath: "",
    contentText: "", headings: "[]", siyuanDocId: null, status: "", createTime: "t",
    outline: "[]", outlineStatus: "done" as const,
  };
  d.materials = [
    { ...base, id: 10, name: "教材A", contentText: "第一章\n甲\n1.1\n乙\n第二章\n丁" },
    { ...base, id: 11, name: "教材B", contentText: "整段正文，含一道例题" },
  ];
  d.materials[0].outline = JSON.stringify([
    { text: "第一章", level: 1 }, { text: "1.1", level: 2 }, { text: "第二章", level: 1 },
  ]);
  d.tocMappings = [
    { id: 1, materialId: 10, courseId: 1, materialPath: "第一章", chapterId: 1 },
    { id: 2, materialId: 10, courseId: 1, materialPath: "第一章>1.1", chapterId: 2 },
  ];
  d.knowledgePoints = [
    { id: 100, courseId: 1, chapterId: 1, blockId: null, name: "项目风险", content: "x", mastery: "unlearn", sourceAssetIds: "10", prevKpIds: "", chapterName: "第一章", sort: 0, createTime: "t" },
  ];
  d.questions = [
    { id: 500, courseId: 1, kpIds: "", title: "项目的定义", options: "[]", answer: "x", analysis: "", qType: "essay", difficulty: "medium", source: "import", paperId: null, createTime: "t" },
  ];
  return d;
}

function reset(data: AppData) {
  bridgeDataRef.data = data;
  aiContent = "[]";
  callAiImpl = async () => ({ content: aiContent, tokenIn: 0, tokenOut: 0 });
  callAiCount = 0;
  lastUserPrompt = "";
}

describe("resolveMaterialQuestionNodes", () => {
  it("映射覆盖的节点集合，按章节树文档序", () => {
    reset(fixture());
    expect(resolveMaterialQuestionNodes(bridgeDataRef.data, 10)).toEqual([1, 2]);
  });
  it("无映射的资料 → 空数组（调用方回落整段）", () => {
    reset(fixture());
    expect(resolveMaterialQuestionNodes(bridgeDataRef.data, 11)).toEqual([]);
    expect(resolveMaterialQuestionNodes(bridgeDataRef.data, 999)).toEqual([]);
  });
});

describe("normalizeQuestionTitle", () => {
  it("小写、去空白标点；仅精确匹配（不做相互包含）", () => {
    expect(normalizeQuestionTitle(" 项目风险的定义 ")).toBe("项目风险的定义");
    expect(normalizeQuestionTitle("a. 项目风险的定义?")).toBe("a项目风险的定义");
    expect(normalizeQuestionTitle("ab")).not.toBe(normalizeQuestionTitle("abc"));
  });
});

describe("parseQuestionItems", () => {
  it("解析合法条目；题型非法回落 essay；无题干丢弃；单选项视为无选项", () => {
    const items = parseQuestionItems(
      `[
        {"qType":"essay","title":"项目风险的定义","options":[],"answer":"","analysis":"","kpNames":["项目风险"]},
        {"qType":"weird","title":"某题","options":["甲","乙"],"answer":"甲","analysis":"","kpNames":"项目风险"},
        {"qType":"single","title":"","options":["甲","乙"],"answer":"甲"},
        {"qType":"single","title":"单选项题","options":["仅一项"],"answer":"x"}
      ]`,
    );
    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({ qType: "essay", title: "项目风险的定义", options: [], answer: "", analysis: "", kpNames: ["项目风险"] });
    expect(items[1].qType).toBe("essay");
    expect(items[1].kpNames).toEqual(["项目风险"]);
    expect(items[2].options).toEqual([]);
    expect(items[2].qType).toBe("essay");
  });
  it("非 JSON / 空数组", () => {
    expect(parseQuestionItems("无题目")).toEqual([]);
    expect(parseQuestionItems("[]")).toEqual([]);
  });
});

describe("extractNodeQuestions", () => {
  it("校验 + 去重 + KP 挂接 + source=material 入库", async () => {
    reset(fixture());
    aiContent = `[
      {"qType":"essay","title":"项目风险的定义","options":[],"answer":"","analysis":"","kpNames":["项目风险"]},
      {"qType":"single","title":"项目的一次性是指","options":["时间上的有限性","成果的独特性","组织的一次性"],"answer":"A","analysis":"","kpNames":[]},
      {"qType":"single","title":"缺答案的选择题","options":["甲","乙"],"answer":"","analysis":"","kpNames":[]},
      {"qType":"essay","title":"项目的定义","options":[],"answer":"","analysis":"","kpNames":[]}
    ]`;
    const r = await extractNodeQuestions(1, 1, 10);
    expect(r).toEqual({ created: 2, skippedDup: 1, skippedNoAnswer: 1 });
    const qs = bridgeDataRef.data.questions;
    expect(qs).toHaveLength(3);
    const essay = qs.find((q) => q.title === "项目风险的定义")!;
    expect(essay.source).toBe("material");
    expect(essay.qType).toBe("essay");
    expect(essay.kpIds).toBe("100");
    const single = qs.find((q) => q.title === "项目的一次性是指")!;
    expect(single.qType).toBe("single");
    expect(JSON.parse(single.options)).toEqual(["时间上的有限性", "成果的独特性", "组织的一次性"]);
    expect(single.kpIds).toBe("");
  });
  it("未配置模型 → 抛错", async () => {
    const d = fixture();
    d.courses[0].modelId = null;
    reset(d);
    await expect(extractNodeQuestions(1, 1, 10)).rejects.toThrow("未配置「文档题目识别」模型");
  });
});

describe("extractQuestionsFromMaterial", () => {
  it("有映射：逐节点识别", async () => {
    reset(fixture());
    callAiImpl = async () => ({
      content: `[{"qType":"essay","title":"节点题${callAiCount + 1}","options":[],"answer":"","analysis":"","kpNames":[]}]`,
      tokenIn: 0,
      tokenOut: 0,
    });
    const r = await extractQuestionsFromMaterial(10);
    expect(r.nodeTotal).toBe(2);
    expect(r.created).toBe(2);
    expect(callAiCount).toBe(2);
  });
  it("无映射：整段回落，一次 AI 调用，提示词标注整份资料", async () => {
    reset(fixture());
    callAiImpl = async () => ({
      content: `[{"qType":"essay","title":"整段题","options":[],"answer":"","analysis":"","kpNames":[]}]`,
      tokenIn: 0,
      tokenOut: 0,
    });
    const r = await extractQuestionsFromMaterial(11);
    expect(r).toEqual({ created: 1, skippedDup: 0, skippedNoAnswer: 0, nodeTotal: 1 });
    expect(callAiCount).toBe(1);
    expect(lastUserPrompt).toContain("整份资料");
  });
});
