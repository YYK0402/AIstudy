import { beforeEach, describe, expect, it } from "vitest";
import { setBridge } from "../../bridge";
import type { StudyBridge } from "../../bridge/types";

const calls: { remove: string[]; exists: string[]; removeFails: Set<string> } = {
  remove: [],
  exists: [],
  removeFails: new Set(),
};
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
  } as unknown as StudyBridge);

const { removeDocIfExists } = await import("../docStore");

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
