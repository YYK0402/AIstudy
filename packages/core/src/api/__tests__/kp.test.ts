import { beforeEach, describe, expect, it } from "vitest";
import type { AppData, Material } from "../../types/appData";
import { createEmptyData } from "../../types/appData";
import { setBridge } from "../../bridge";
import type { StudyBridge } from "../../bridge/types";
import { getData } from "../storage";
import type { MergeResult } from "../tocMerge";

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
      { id: 1, courseId: 1, parentId: null, siyuanBlockId: null, name: "第一章 鸦片战争", level: 1, sort: 1 },
      { id: 2, courseId: 1, parentId: 1, siyuanBlockId: null, name: "第一节 战争背景", level: 2, sort: 1 },
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
  } as unknown as StudyBridge);

const { createChapter, importChapterTree, deleteChapters } = await import("../kp");

describe("createChapter 判重口径（与知识点章节匹配一致的归一化）", () => {
  it("仅「第X章/节」前缀或空格差异 → 视为重名，拒绝创建", async () => {
    await expect(
      createChapter({ courseId: 1, name: "第一章 鸦片战争", parentId: null, level: 1 }),
    ).rejects.toThrow("已存在同名章节");
    await expect(
      createChapter({ courseId: 1, name: "鸦片战争", parentId: null, level: 1 }),
    ).rejects.toThrow("已存在同名章节");
    await expect(
      createChapter({ courseId: 1, name: "第一节战争背景", parentId: 1, level: 2 }),
    ).rejects.toThrow("已存在同名章节");
    expect(dataRef.data.chapters).toHaveLength(2);
  });

  it("归一化后不同名 → 正常创建", async () => {
    const ch = await createChapter({ courseId: 1, name: "第二章 近代化探索", parentId: null, level: 1 });
    expect(ch.name).toBe("第二章 近代化探索");
    expect(dataRef.data.chapters).toHaveLength(3);
  });
});

// ===== importChapterTree N 级 + tocMappings（outline-first） =====

function matFixture(): Material {
  return {
    id: 10, courseId: 1, name: "教材A", fileType: "txt", assetPath: "",
    contentText: "第一章\n正文\n1.1\n正文2",
    headings: "[]", siyuanDocId: null, status: "parsed", createTime: "2026-01-01T00:00:00Z",
    outline: JSON.stringify([{ text: "第一章", level: 1 }, { text: "1.1", level: 2 }]),
    outlineStatus: "done",
  };
}

function mergeFixture(): MergeResult {
  return {
    nodes: [
      { id: 0, parent: null, name: "第一章", variants: [], chapterId: null },
      { id: 1, parent: 0, name: "1.1", variants: [], chapterId: null },
    ],
    mappings: [
      { materialIdx: 0, materialSeq: 0, nodeId: 0 },
      { materialIdx: 0, materialSeq: 1, nodeId: 1 },
    ],
    failed: [],
  };
}

/** 重置为干净课程 1（独立于前序用例，避免其建章干扰断言） */
function seedCleanCourse(materials: Material[] = [], persistToSiyuan = false): void {
  dataRef.data = {
    ...createEmptyData(),
    courses: [
      {
        id: 1, siyuanDocId: null, name: "测试课程", description: "", target: "",
        totalCycle: "", status: "active", createTime: "2026-10-01T00:00:00Z", modelId: null,
      },
    ],
    materials,
    settings: { chapterMode: "manual", persistToSiyuan, notebookName: "AI 研习" },
  };
}

/** 记录 createDoc 调用的假桥（验证落库文档策略：level≥3 不建文档） */
function makeFakeBridgeWithDocs(persistIds: string[]): StudyBridge {
  return {
    capabilities: { docs: "siyuan" },
    getData: async () => dataRef.data,
    saveData: async (next: AppData) => {
      dataRef.data = next;
      return { code: 0 };
    },
    showMessage: () => {},
    ensureFolder: async () => "AI 研习",
    createDoc: async (_markdown: string, _path: string, _folder: string, _parentRef?: string | null) => {
      const id = `doc-persist-${persistIds.length + 1}`;
      persistIds.push(id);
      return { id };
    },
  } as unknown as StudyBridge;
}

describe("importChapterTree N 级导入 + tocMappings（outline-first）", () => {
  beforeEach(() => {
    setBridge({
      getData: async () => dataRef.data,
      saveData: async (next: AppData) => {
        dataRef.data = next;
        return { code: 0 };
      },
      showMessage: () => {},
    } as unknown as StudyBridge);
    seedCleanCourse();
  });

  it("N 级幂等导入（重复导入不建重）", async () => {
    const nodes1 = [
      { name: "第一章", level: 1, parentName: null },
      { name: "1.1 节", level: 2, parentName: "第一章" },
      { name: "1.1.1 小节", level: 3, parentName: "1.1 节" },
    ];
    const r1 = await importChapterTree(1, nodes1);
    const r2 = await importChapterTree(1, nodes1);
    expect(r1.created).toBe(3);
    expect(r2.created).toBe(0);
    const d = await getData();
    const chs = d.chapters.filter((c) => c.courseId === 1);
    expect(chs).toHaveLength(3);
    const top = chs.find((c) => c.name === "第一章")!;
    const unit = chs.find((c) => c.name === "1.1 节")!;
    const sub = chs.find((c) => c.name === "1.1.1 小节")!;
    expect(unit.parentId).toBe(top.id);
    expect(sub.parentId).toBe(unit.id);
    expect(sub.level).toBe(3);
  });

  it("深度≥3 不建思源文档，≤2 建", async () => {
    const persistIds: string[] = [];
    setBridge(makeFakeBridgeWithDocs(persistIds));
    seedCleanCourse([], true);
    await importChapterTree(1, [
      { name: "第一章", level: 1, parentName: null },
      { name: "1.1 节", level: 2, parentName: "第一章" },
      { name: "1.1.1 小节", level: 3, parentName: "1.1 节" },
    ]);
    expect(persistIds).toHaveLength(2); // 仅章与节
  });

  it("写 tocMappings（替换式，materialPath 用 outline 路径）", async () => {
    seedCleanCourse([matFixture()]);
    await importChapterTree(1, [
      { name: "第一章", level: 1, parentName: null },
      { name: "1.1", level: 2, parentName: "第一章" },
    ], { result: mergeFixture() });
    const d = await getData();
    expect(d.tocMappings).toHaveLength(2);
    expect(d.tocMappings[0].materialPath).toBe("第一章");
    expect(d.tocMappings[1].materialPath).toBe("第一章>1.1");
    // 重复导入不翻倍
    await importChapterTree(1, [
      { name: "第一章", level: 1, parentName: null },
      { name: "1.1", level: 2, parentName: "第一章" },
    ], { result: mergeFixture() });
    const d2 = await getData();
    expect(d2.tocMappings).toHaveLength(2);
  });

  it("deleteChapters 级联删 tocMappings", async () => {
    seedCleanCourse([matFixture()]);
    await importChapterTree(1, [
      { name: "第一章", level: 1, parentName: null },
      { name: "1.1", level: 2, parentName: "第一章" },
    ], { result: mergeFixture() });
    expect(dataRef.data.tocMappings).toHaveLength(2);
    const top = dataRef.data.chapters.find((c) => c.name === "第一章")!;
    await deleteChapters([top.id]);
    expect(dataRef.data.tocMappings).toHaveLength(0);
  });
});
