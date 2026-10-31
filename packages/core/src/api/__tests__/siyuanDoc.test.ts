import { beforeEach, describe, expect, it } from "vitest";

const calls: { remove: string[]; exists: string[]; removeFails: Set<string> } = {
  remove: [],
  exists: [],
  removeFails: new Set(),
};
let stillExisting = new Set<string>();
(globalThis as Record<string, unknown>).window = {
  addEventListener: () => {},
  dispatchEvent: () => true,
  siyuanAiStudy: {
    removeSiyuanDoc: async (id: string) => {
      calls.remove.push(id);
      if (calls.removeFails.has(id)) throw new Error("doc not found");
    },
    siyuanDocExists: async (id: string) => {
      calls.exists.push(id);
      return stillExisting.has(id);
    },
  },
};

const { removeSiyuanDocIfExists } = await import("../siyuanDoc");

describe("removeSiyuanDocIfExists 幂等删除", () => {
  beforeEach(() => {
    calls.remove.length = 0;
    calls.exists.length = 0;
    calls.removeFails.clear();
    stillExisting = new Set();
  });

  it("删除成功时不查存在性", async () => {
    await removeSiyuanDocIfExists("doc-a");
    expect(calls.remove).toEqual(["doc-a"]);
    expect(calls.exists).toEqual([]);
  });

  it("删除失败但文档已不存在（父级联删）视为成功", async () => {
    calls.removeFails.add("doc-b");
    await expect(removeSiyuanDocIfExists("doc-b")).resolves.toBeUndefined();
    expect(calls.exists).toEqual(["doc-b"]);
  });

  it("删除失败且文档仍存在时抛出", async () => {
    calls.removeFails.add("doc-c");
    stillExisting = new Set(["doc-c"]);
    await expect(removeSiyuanDocIfExists("doc-c")).rejects.toThrow("doc not found");
  });
});
