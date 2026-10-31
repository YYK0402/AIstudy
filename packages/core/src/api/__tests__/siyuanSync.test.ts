import { beforeEach, describe, expect, it } from "vitest";
import type { AppData } from "../../types/appData";
import { createEmptyData } from "../../types/appData";

function makeData(): AppData {
  const data = {
    ...createEmptyData(),
    courses: [
      {
        id: 1, siyuanDocId: null, name: "测试课程", description: "", target: "",
        totalCycle: "", status: "active", createTime: "2026-10-01T00:00:00Z", modelId: null,
      },
    ],
    knowledgePoints: [
      {
        id: 1, courseId: 1, chapterId: null, blockId: null, name: "KP1", content: "内容",
        mastery: "unlearn" as const, sourceAssetIds: "", prevKpIds: "", chapterName: "",
        sort: 0, createTime: "2026-10-01T00:00:00Z",
      },
    ],
    explainRecords: [
      {
        id: 1, courseId: 1, kpId: 1, userContent: "冒烟讲解内容", aiFeedback: "点评",
        aiScore: "85", createTime: "2026-10-28T00:00:00Z", askPrompt: "提问？",
      },
    ],
    settings: { chapterMode: "manual" as const, persistToSiyuan: true, notebookName: "AI 研习" },
    conversationsDocs: { "course-1": { docId: "doc-deleted", lastMarkdown: "旧文" } },
  };
  return data;
}

const dataRef: { data: AppData } = { data: makeData() };
const calls: { create: Array<{ md: string; path: string; nb: string }>; update: Array<{ id: string }>; exists: boolean; readFails: boolean } = {
  create: [],
  update: [],
  exists: false,
  readFails: true,
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
    ensureFolder: async () => "nb1",
    createDoc: async (md: string, path: string, nb: string) => {
      calls.create.push({ md, path, nb });
      return { id: "doc-new" };
    },
    updateDoc: async (id: string) => {
      calls.update.push({ id });
    },
    getDocMarkdown: async () => (calls.readFails ? null : "现有内容"),
    docExists: async () => calls.exists,
    showMessage: () => {},
  } as unknown as StudyBridge);

const { syncExplainConversations } = await import("../siyuanSync");

describe("syncExplainConversations 文档缺失处理", () => {
  beforeEach(() => {
    dataRef.data = makeData();
    calls.create.length = 0;
    calls.update.length = 0;
    calls.exists = false;
    calls.readFails = true;
  });

  it("文档已被删除 → 自动重建并更新 docId", async () => {
    calls.exists = false;
    calls.readFails = true;
    calls.create.length = 0;
    await syncExplainConversations(1, 1);
    expect(calls.create).toHaveLength(1);
    expect(calls.create[0].path).toBe("/测试课程/学习对话");
    expect(calls.create[0].md).toContain("冒烟讲解内容");
    expect(dataRef.data.conversationsDocs!["course-1"].docId).toBe("doc-new");
  });

  it("文档存在但读取失败 → 跳过同步且不重建", async () => {
    calls.exists = true;
    calls.readFails = true;
    calls.create.length = 0;
    await syncExplainConversations(1, 1);
    expect(calls.create).toHaveLength(0);
    expect(dataRef.data.conversationsDocs!["course-1"].docId).toBe("doc-deleted");
  });

  it("文档正常 → 走 update 合并", async () => {
    calls.exists = true;
    calls.readFails = false;
    calls.update.length = 0;
    await syncExplainConversations(1, 1);
    expect(calls.update).toHaveLength(1);
    expect(calls.update[0].id).toBe("doc-deleted");
    expect(dataRef.data.conversationsDocs!["course-1"].docId).toBe("doc-deleted");
  });
});

import { CONV_MAX_ROUNDS, buildConvMarkdown } from "../siyuanSync";
import { setBridge } from "../../bridge";
import type { StudyBridge } from "../../bridge/types";

describe("buildConvMarkdown 轮数上限", () => {
  const kp = {
    id: 1, courseId: 1, chapterId: null, blockId: null, name: "KP1", content: "",
    mastery: "unlearn" as const, sourceAssetIds: "", prevKpIds: "", chapterName: "",
    sort: 0, createTime: "2026-10-01T00:00:00Z",
  };

  function makeRecords(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      id: i + 1,
      courseId: 1,
      kpId: 1,
      userContent: `第${i + 1}轮讲解`,
      aiFeedback: "点评",
      aiScore: "80",
      createTime: new Date(2026, 0, 1 + i, 10).toISOString(),
      askPrompt: `Q${i + 1}`,
    }));
  }

  it(`超过 ${CONV_MAX_ROUNDS} 轮：只渲染最近 N 轮，编号保留原始轮次，加归档注记`, () => {
    const md = buildConvMarkdown("测试", [kp], makeRecords(CONV_MAX_ROUNDS + 2));
    expect(md).toContain(`共 ${CONV_MAX_ROUNDS + 2} 轮，仅显示最近 ${CONV_MAX_ROUNDS} 轮`);
    // 最早的 2 轮（第 1/2 轮）不渲染，最近一轮编号 = 总数
    expect(md).not.toContain("### 第 1 轮");
    expect(md).not.toContain("### 第 2 轮");
    expect(md).toContain(`### 第 ${CONV_MAX_ROUNDS + 1} 轮`);
    expect(md).toContain(`### 第 ${CONV_MAX_ROUNDS + 2} 轮`);
    expect(md).toContain("第51轮讲解"); // 只保留最近 N 轮内容
    expect(md).not.toContain("第2轮讲解");
  });

  it(`恰好 ${CONV_MAX_ROUNDS} 轮：全部渲染，无注记`, () => {
    const md = buildConvMarkdown("测试", [kp], makeRecords(CONV_MAX_ROUNDS));
    expect(md).toContain("### 第 1 轮");
    expect(md).not.toContain("仅显示最近");
  });
});
