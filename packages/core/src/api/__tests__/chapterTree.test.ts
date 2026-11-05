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
const moveDocCalls: Array<[string, string]> = [];
const createDocCalls: Array<{ markdown: string; path: string; parentID: string | null }> = [];
setBridge({
    capabilities: { docs: "siyuan" },
    getData: async () => dataRef.data,
    saveData: async (next: AppData) => {
      dataRef.data = next;
      return { code: 0 };
    },
    showMessage: () => {},
    moveDoc: async (id: string, targetId: string) => {
      moveDocCalls.push([id, targetId]);
    },
    ensureFolder: async () => "AI 研习",
    createDoc: async (markdown: string, path: string, _folder: string, parentRef?: string | null) => {
      createDocCalls.push({ markdown, path, parentID: parentRef ?? null });
      return { id: `doc-new-${createDocCalls.length}` };
    },
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

describe("importChapterTree 改挂（重新识别目录时纠正已有小节的父章）", () => {
  /** 独立种子：课程 2 + 两章两节（带思源文档 id），不依赖前序用例状态 */
  function seedCourse2() {
    moveDocCalls.length = 0;
    dataRef.data = {
      ...createEmptyData(),
      courses: [
        {
          id: 2, siyuanDocId: "doc-course-2", name: "管理课", description: "", target: "",
          totalCycle: "", status: "active", createTime: "2026-10-01T00:00:00Z", modelId: null,
        },
      ],
      chapters: [
        { id: 201, courseId: 2, parentId: null, siyuanBlockId: "doc-ch1", name: "第一章 总论", level: "chapter", sort: 1 },
        { id: 202, courseId: 2, parentId: null, siyuanBlockId: "doc-ch2", name: "第二章 发展", level: "chapter", sort: 2 },
        { id: 203, courseId: 2, parentId: 201, siyuanBlockId: "doc-u1", name: "1.1 背景", level: "unit", sort: 1 },
        { id: 204, courseId: 2, parentId: 201, siyuanBlockId: "doc-u2", name: "1.2 现状", level: "unit", sort: 2 },
      ],
    };
  }

  it("小节父章变化 → 改挂到新章（parentId/sort 更新 + moveDoc 同步）", async () => {
    seedCourse2();
    const r = await importChapterTree(2, [
      { name: "第一章 总论", level: "chapter", parentName: null },
      { name: "第二章 发展", level: "chapter", parentName: null },
      { name: "1.1 背景", level: "unit", parentName: "第一章 总论" },
      { name: "1.2 现状", level: "unit", parentName: "第二章 发展" },
    ]);
    expect(r.created).toBe(0);
    expect(r.moved).toBe(1);
    const u2 = dataRef.data.chapters.find((c) => c.id === 204)!;
    expect(u2.parentId).toBe(202);
    expect(u2.sort).toBe(1); // 新父下无其他节 → 追加为 1
    expect(moveDocCalls).toEqual([["doc-u2", "doc-ch2"]]);
    // 未改挂的节不受影响
    const u1 = dataRef.data.chapters.find((c) => c.id === 203)!;
    expect(u1.parentId).toBe(201);
    expect(u1.sort).toBe(1);
  });

  it("纯重复导入（父章未变）→ 完全不动", async () => {
    seedCourse2();
    const before = dataRef.data.chapters.map((c) => ({ id: c.id, parentId: c.parentId, sort: c.sort }));
    const r = await importChapterTree(2, [
      { name: "第一章 总论", level: "chapter", parentName: null },
      { name: "1.1 背景", level: "unit", parentName: "第一章 总论" },
      { name: "1.2 现状", level: "unit", parentName: "第一章 总论" },
    ]);
    expect(r.created).toBe(0);
    expect(r.moved).toBe(0);
    expect(moveDocCalls).toEqual([]);
    expect(dataRef.data.chapters.map((c) => ({ id: c.id, parentId: c.parentId, sort: c.sort }))).toEqual(before);
  });

  it("预览父章不存在（用户删了该行）→ 不改动", async () => {
    seedCourse2();
    const r = await importChapterTree(2, [
      { name: "1.1 背景", level: "unit", parentName: "第三章 不存在" },
    ]);
    expect(r.moved).toBe(0);
    expect(moveDocCalls).toEqual([]);
    const u1 = dataRef.data.chapters.find((c) => c.id === 203)!;
    expect(u1.parentId).toBe(201);
  });

  it("孤儿小节（parentId=null）按预览归位到正确章", async () => {
    seedCourse2();
    // 模拟历史脏数据：1.2 现状丢了父引用
    const u2 = dataRef.data.chapters.find((c) => c.id === 204)!;
    u2.parentId = null;
    const r = await importChapterTree(2, [
      { name: "第一章 总论", level: "chapter", parentName: null },
      { name: "1.2 现状", level: "unit", parentName: "第一章 总论" },
    ]);
    expect(r.moved).toBe(1);
    expect(u2.parentId).toBe(201);
    expect(u2.sort).toBe(2); // 1.1(sort 1) 之后追加
    expect(moveDocCalls).toEqual([["doc-u2", "doc-ch1"]]);
  });

  it("无思源文档的小节只改数据不调 moveDoc", async () => {
    seedCourse2();
    const u2 = dataRef.data.chapters.find((c) => c.id === 204)!;
    u2.siyuanBlockId = null;
    const r = await importChapterTree(2, [
      { name: "第二章 发展", level: "chapter", parentName: null },
      { name: "1.2 现状", level: "unit", parentName: "第二章 发展" },
    ]);
    expect(r.moved).toBe(1);
    expect(u2.parentId).toBe(202);
    expect(moveDocCalls).toEqual([]);
  });

  it("小节名含 /：落库路径段与标题转全角，应用侧名称保持半角", async () => {
    seedCourse2();
    dataRef.data.settings = { chapterMode: "manual", persistToSiyuan: true, notebookName: "AI 研习" };
    createDocCalls.length = 0;
    const r = await importChapterTree(2, [
      { name: "第一章 总论", level: "chapter", parentName: null },
      { name: "重点/难点/考点", level: "unit", parentName: "第一章 总论" },
    ]);
    expect(r.created).toBe(1);
    expect(createDocCalls).toHaveLength(1);
    expect(createDocCalls[0].path).toBe("/管理课/第一章 总论/重点／难点／考点");
    expect(createDocCalls[0].markdown).toBe("# 重点／难点／考点");
    expect(createDocCalls[0].parentID).toBe("doc-ch1");
    // 应用侧章节名保留原始半角斜杠（知识点按名称匹配不受影响）
    const u = dataRef.data.chapters.find((c) => c.name === "重点/难点/考点")!;
    expect(u.siyuanBlockId).toBe("doc-new-1");
  });
});
