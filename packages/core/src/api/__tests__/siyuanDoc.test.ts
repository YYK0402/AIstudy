import { beforeEach, describe, expect, it } from "vitest";
import { setBridge } from "../../bridge";
import type { StudyBridge } from "../../bridge/types";

const calls: { remove: string[]; exists: string[]; removeFails: Set<string> } = {
  remove: [],
  exists: [],
  removeFails: new Set(),
};
const created: Array<{ markdown: string; path: string; parentID?: string | null }> = [];
let stillExisting = new Set<string>();
(globalThis as Record<string, unknown>).window = {
  addEventListener: () => {},
  dispatchEvent: () => true,

};
setBridge({
    removeDoc: async (id: string) => {
      calls.remove.push(id);
      if (calls.removeFails.has(id)) throw new Error("doc not found");
    },
    docExists: async (id: string) => {
      calls.exists.push(id);
      return stillExisting.has(id);
    },
    createDoc: async (markdown: string, path: string, _folder: string, parentRef?: string | null) => {
      created.push({ markdown, path, parentID: parentRef ?? null });
      return { id: "new-doc" };
    },
  } as unknown as StudyBridge);

const { removeDocIfExists, createDoc } = await import("../docStore");

describe("removeDocIfExists 幂等删除", () => {
  beforeEach(() => {
    calls.remove.length = 0;
    calls.exists.length = 0;
    calls.removeFails.clear();
    stillExisting = new Set();
  });

  it("删除成功时不查存在性", async () => {
    await removeDocIfExists("doc-a");
    expect(calls.remove).toEqual(["doc-a"]);
    expect(calls.exists).toEqual([]);
  });

  it("删除失败但文档已不存在（父级联删）视为成功", async () => {
    calls.removeFails.add("doc-b");
    await expect(removeDocIfExists("doc-b")).resolves.toBeUndefined();
    expect(calls.exists).toEqual(["doc-b"]);
  });

  it("删除失败且文档仍存在时抛出", async () => {
    calls.removeFails.add("doc-c");
    stillExisting = new Set(["doc-c"]);
    await expect(removeDocIfExists("doc-c")).rejects.toThrow("doc not found");
  });
});

describe("createDoc 首行标题斜杠防护（路径段由构建点逐段转全角）", () => {
  it("markdown 首行标题中的 / 转全角，正文不动", async () => {
    created.length = 0;
    await createDoc(
      "# 12.2 项目采购规划与自制/外购决策\n\n正文含 / 不改",
      "/课程/12.2 项目采购规划与自制／外购决策",
      "AI 研习",
    );
    expect(created[0].markdown).toBe("# 12.2 项目采购规划与自制／外购决策\n\n正文含 / 不改");
  });

  it("单行标题（无换行）也能清洗", async () => {
    created.length = 0;
    await createDoc("# 重点/难点/考点", "/课程/重点／难点／考点", "AI 研习");
    expect(created[0].markdown).toBe("# 重点／难点／考点");
  });

  it("非 # 开头的 markdown 原样透传", async () => {
    created.length = 0;
    await createDoc("无标题正文", "/课程/A", "AI 研习");
    expect(created[0].markdown).toBe("无标题正文");
  });
});
