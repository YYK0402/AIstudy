import { describe, expect, it } from "vitest";
import type { AppData } from "../../types/appData";
import { createEmptyData } from "../../types/appData";
import { setBridge } from "../../bridge";
import type { StudyBridge } from "../../bridge/types";

const baseData = (): AppData => ({
  ...createEmptyData(),
  materials: [
    {
      id: 5, courseId: 1, name: "教材A", fileType: "txt", assetPath: "",
      contentText: "", headings: "[]", siyuanDocId: null, status: "parsed", createTime: "2026-01-01T00:00:00Z",
      outline: "[]", outlineStatus: "done",
    },
    {
      id: 6, courseId: 1, name: "教材B", fileType: "txt", assetPath: "",
      contentText: "", headings: "[]", siyuanDocId: null, status: "parsed", createTime: "2026-01-01T00:00:00Z",
      outline: "[]", outlineStatus: "done",
    },
  ],
  tocMappings: [
    { id: 1, materialId: 5, courseId: 1, materialPath: "第一章", chapterId: 1 },
    { id: 2, materialId: 5, courseId: 1, materialPath: "第一章>1.1", chapterId: 2 },
    { id: 3, materialId: 6, courseId: 1, materialPath: "第二章", chapterId: 3 },
  ],
});

const dataRef: { data: AppData } = { data: baseData() };
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
  removeDoc: async () => {},
} as unknown as StudyBridge);

const { deleteMaterial } = await import("../material");

describe("deleteMaterial 级联清理 tocMappings", () => {
  it("删资料 → 该资料映射清空，他资料映射保留", async () => {
    dataRef.data = baseData();
    await deleteMaterial(5);
    expect(dataRef.data.materials.map((m) => m.id)).toEqual([6]);
    expect(dataRef.data.tocMappings).toEqual([
      { id: 3, materialId: 6, courseId: 1, materialPath: "第二章", chapterId: 3 },
    ]);
  });
});
