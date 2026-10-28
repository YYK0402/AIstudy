import { beforeEach, describe, expect, it } from "vitest";
import type { AppData } from "../../types/appData";
import { createEmptyData } from "../../../../src/data";

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
  siyuanAiStudy: {
    getData: async () => dataRef.data,
    saveData: async (next: AppData) => {
      dataRef.data = next;
      return { code: 0 };
    },
    ensureNotebook: async () => "nb1",
    createSiyuanDoc: async (md: string, path: string, nb: string) => {
      calls.create.push({ md, path, nb });
      return { id: "doc-new" };
    },
    updateSiyuanDoc: async (id: string) => {
      calls.update.push({ id });
    },
    getSiyuanDocMarkdown: async () => (calls.readFails ? null : "现有内容"),
    siyuanDocExists: async () => calls.exists,
    showMessage: () => {},
  },
};

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
