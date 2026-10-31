import { describe, expect, it } from "vitest";
import type { AppData } from "../../types/appData";
import { createEmptyData } from "../../types/appData";
import { setBridge } from "../../bridge";
import type { StudyBridge } from "../../bridge/types";

const dataRef: { data: AppData } = {
  data: {
    ...createEmptyData(),
    courses: [
      {
        id: 1, siyuanDocId: null, name: "测试课程", description: "", target: "",
        totalCycle: "", status: "active", createTime: "2026-10-01T00:00:00Z", modelId: null,
      },
    ],
  },
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
    showMessage: () => {},
  } as unknown as StudyBridge);

const { importChapterTree } = await import("../kp");

const chapterOrder = () =>
  dataRef.data.chapters
    .filter((c) => c.level === "chapter")
    .sort((a, b) => a.sort - b.sort)
    .map((c) => c.name);

describe("importChapterTree 多资料合并场景", () => {
  it("分册导入：上册后再导下册，章节按全书顺序（新章追加末尾，不重排已有章节）", async () => {
    const r1 = await importChapterTree(1, [
      { name: "第一章 导论", level: "chapter", parentName: null },
      { name: "1.1 背景", level: "unit", parentName: "第一章 导论" },
      { name: "第二章 发展", level: "chapter", parentName: null },
      { name: "第三章 高潮", level: "chapter", parentName: null },
    ]);
    expect(r1.created).toBe(4); // 3 章 + 1 节
    expect(chapterOrder()).toEqual(["第一章 导论", "第二章 发展", "第三章 高潮"]);

    const r2 = await importChapterTree(1, [
      { name: "第四章 转折", level: "chapter", parentName: null },
      { name: "第五章 结局", level: "chapter", parentName: null },
    ]);
    expect(r2.created).toBe(2);
    expect(chapterOrder()).toEqual(["第一章 导论", "第二章 发展", "第三章 高潮", "第四章 转折", "第五章 结局"]);
  });

  it("纯重复导入：无新章节时完全不动（已有章节顺序保持）", async () => {
    const before = dataRef.data.chapters.map((c) => ({ id: c.id, sort: c.sort }));
    const r = await importChapterTree(1, [
      { name: "第三章 高潮", level: "chapter", parentName: null },
      { name: "第一章 导论", level: "chapter", parentName: null }, // 故意乱序
    ]);
    expect(r.created).toBe(0);
    expect(dataRef.data.chapters.map((c) => ({ id: c.id, sort: c.sort }))).toEqual(before);
  });

  it("用户手动调整顺序后导入新目录：已有章节顺序不被覆盖，新章追加末尾", async () => {
    // 模拟手动拖拽：把「第五章 结局」提到最前
    const chs = dataRef.data.chapters.filter((c) => c.level === "chapter");
    const first = chs.find((c) => c.name === "第五章 结局")!;
    const others = chs.filter((c) => c.id !== first.id);
    first.sort = 1;
    others.forEach((c, i) => (c.sort = i + 2));
    const shuffled = chapterOrder();
    expect(shuffled[0]).toBe("第五章 结局");

    await importChapterTree(1, [
      { name: "第一章 导论", level: "chapter", parentName: null },
      { name: "第六章 尾声", level: "chapter", parentName: null },
    ]);
    expect(chapterOrder()).toEqual([...shuffled, "第六章 尾声"]);
  });
});
