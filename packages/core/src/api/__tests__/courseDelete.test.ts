import { describe, expect, it } from "vitest";
import type { AppData } from "../../types/appData";
import { createEmptyData } from "../../types/appData";
import { setBridge } from "../../bridge";
import type { StudyBridge } from "../../bridge/types";

const baseData = (): AppData => ({
  ...createEmptyData(),
  courses: [
    {
      id: 1, siyuanDocId: "doc-course-1", name: "测试课程", description: "", target: "",
      totalCycle: "", status: "active", createTime: "2026-10-01T00:00:00Z", modelId: null,
    },
  ],
  chapters: [
    { id: 1, courseId: 1, parentId: null, siyuanBlockId: "doc-ch-1", name: "第一章", level: "chapter", sort: 1 },
  ],
  docRegions: {
    "doc-course-1": { h: "h1", ids: [10] },
    "doc-ch-1": { h: "h2", ids: [11] },
    "doc-other-course": { h: "h3", ids: [12] },
  },
});

const dataRef: { data: AppData } = { data: baseData() };
const removedDocs: string[] = [];
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
  isValidDocRef: (ref: string) => ref.startsWith("doc-"),
  removeDoc: async (id: string) => {
    removedDocs.push(id);
  },
  showMessage: () => {},
} as unknown as StudyBridge);

const { deleteCourse } = await import("../course");

describe("deleteCourse 级联清理 docRegions（读回删除消歧对全部课程取 ids 并集，残留条目会误判待写 KP）", () => {
  it("正常路径（课程文档引用有效）：课程文档 + 章文档条目被清，其他课程条目保留", async () => {
    dataRef.data = baseData();
    removedDocs.length = 0;
    await deleteCourse(1);
    expect(dataRef.data.courses).toHaveLength(0);
    expect(removedDocs).toEqual(["doc-course-1"]);
    expect(dataRef.data.docRegions).toEqual({ "doc-other-course": { h: "h3", ids: [12] } });
  });

  it("兜底路径（课程文档引用无效）：章文档条目被清，无效引用的课程文档条目一并清理", async () => {
    const d = baseData();
    d.courses[0].siyuanDocId = "bad-ref";
    d.docRegions = { "bad-ref": { h: "h0", ids: [9] }, "doc-ch-1": { h: "h2", ids: [11] } };
    dataRef.data = d;
    removedDocs.length = 0;
    await deleteCourse(1);
    expect(dataRef.data.courses).toHaveLength(0);
    expect(removedDocs).toEqual(["doc-ch-1"]);
    expect(dataRef.data.docRegions).toEqual({});
  });
});
