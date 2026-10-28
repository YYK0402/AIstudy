import { describe, expect, it } from "vitest";
import type { AppData } from "../../types/appData";
import { createEmptyData } from "../../../../src/data";

const dataRef: { data: AppData } = {
  data: {
    ...createEmptyData(),
    courses: [
      {
        id: 1, siyuanDocId: null, name: "测试课程", description: "", target: "",
        totalCycle: "", status: "active", createTime: "2026-10-01T00:00:00Z", modelId: null,
      },
    ],
    chapters: [
      { id: 1, courseId: 1, parentId: null, siyuanBlockId: null, name: "第一章 鸦片战争", level: "chapter", sort: 1 },
      { id: 2, courseId: 1, parentId: 1, siyuanBlockId: null, name: "第一节 战争背景", level: "unit", sort: 1 },
    ],
  },
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
  },
};

const { createChapter } = await import("../kp");

describe("createChapter 判重口径（与知识点章节匹配一致的归一化）", () => {
  it("仅「第X章/节」前缀或空格差异 → 视为重名，拒绝创建", async () => {
    await expect(
      createChapter({ courseId: 1, name: "第一章 鸦片战争", parentId: null, level: "chapter" }),
    ).rejects.toThrow("已存在同名章节");
    await expect(
      createChapter({ courseId: 1, name: "鸦片战争", parentId: null, level: "chapter" }),
    ).rejects.toThrow("已存在同名章节");
    await expect(
      createChapter({ courseId: 1, name: "第一节战争背景", parentId: 1, level: "unit" }),
    ).rejects.toThrow("已存在同名章节");
    expect(dataRef.data.chapters).toHaveLength(2);
  });

  it("归一化后不同名 → 正常创建", async () => {
    const ch = await createChapter({ courseId: 1, name: "第二章 近代化探索", parentId: null, level: "chapter" });
    expect(ch.name).toBe("第二章 近代化探索");
    expect(dataRef.data.chapters).toHaveLength(3);
  });
});
