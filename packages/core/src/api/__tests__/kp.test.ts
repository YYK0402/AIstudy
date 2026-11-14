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

const { createChapter, importChapterTree, deleteChapters, relinkUnassignedKps, createKnowledgePoint } = await import("../kp");

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
      { materialId: 10, materialSeq: 0, nodeId: 0 },
      { materialId: 10, materialSeq: 1, nodeId: 1 },
    ],
    failed: [],
    processed: [10],
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

  it("M2：AI 节点「第5章 X」复用既有「X」章，不建重章", async () => {
    seedCleanCourse([]);
    dataRef.data.chapters = [
      { id: 1, courseId: 1, parentId: null, siyuanBlockId: null, name: "项目成本管理", level: 1, sort: 1 },
    ];
    const r = await importChapterTree(1, [
      { name: "第5章 项目成本管理", level: 1, parentName: null },
    ]);
    expect(r.created).toBe(0);
    expect(dataRef.data.chapters.filter((c) => c.courseId === 1)).toHaveLength(1);
  });

  it("M2：父章定位走 normalizeChapterRef：「第1章 X」命中既有「X」", async () => {
    seedCleanCourse([]);
    dataRef.data.chapters = [
      { id: 1, courseId: 1, parentId: null, siyuanBlockId: null, name: "项目成本管理", level: 1, sort: 1 },
    ];
    const r = await importChapterTree(1, [
      { name: "项目成本管理", level: 1, parentName: null },
      { name: "成本估算方法", level: 2, parentName: "第1章 项目成本管理" },
    ]);
    expect(r.created).toBe(1);
    const sub = dataRef.data.chapters.find((c) => c.name === "成本估算方法");
    expect(sub).toBeTruthy();
    expect(sub!.parentId).toBe(1); // 挂到既有章下，而非父丢失挂到课程根
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

describe("importChapterTree 子集合并映射保留（H1）", () => {
  beforeEach(() => {
    setBridge({
      getData: async () => dataRef.data,
      saveData: async (next: AppData) => {
        dataRef.data = next;
        return { code: 0 };
      },
      showMessage: () => {},
    } as unknown as StudyBridge);
  });

  function twoMatCourse(): void {
    seedCleanCourse([
      matFixture(),
      { ...matFixture(), id: 11, name: "教材B", contentText: "第一章\n丙\n1.1\n丁" },
    ]);
    dataRef.data.chapters = [
      { id: 1, courseId: 1, parentId: null, siyuanBlockId: null, name: "第一章", level: 1, sort: 1 },
      { id: 2, courseId: 1, parentId: 1, siyuanBlockId: null, name: "1.1", level: 2, sort: 1 },
    ];
    dataRef.data.tocMappings = [
      { id: 1, materialId: 10, courseId: 1, materialPath: "第一章", chapterId: 1 },
      { id: 2, materialId: 11, courseId: 1, materialPath: "第一章", chapterId: 1 },
    ];
  }

  it("子集合并：未处理资料映射保留，已处理资料映射被替换", async () => {
    twoMatCourse();
    const res: MergeResult = {
      nodes: [
        { id: 0, parent: null, name: "第一章", variants: [], chapterId: 1 },
        { id: 1, parent: 0, name: "1.1", variants: [], chapterId: 2 },
      ],
      mappings: [{ materialId: 11, materialSeq: 1, nodeId: 1 }],
      failed: [],
      processed: [11],
    };
    await importChapterTree(1, [
      { name: "第一章", level: 1, parentName: null },
      { name: "1.1", level: 2, parentName: "第一章" },
    ], { result: res });
    const m10 = dataRef.data.tocMappings.filter((m) => m.materialId === 10);
    const m11 = dataRef.data.tocMappings.filter((m) => m.materialId === 11);
    expect(m10).toHaveLength(1); // 未处理：旧映射保留
    expect(m10[0].chapterId).toBe(1);
    expect(m11).toHaveLength(1); // 已处理：替换为新映射
    expect(m11[0].chapterId).toBe(2);
    expect(m11[0].materialPath).toBe("第一章>1.1");
  });

  it("processed 缺省（旧格式 result）：保留全部旧映射，只追加新映射", async () => {
    twoMatCourse();
    const res = {
      nodes: [{ id: 0, parent: null, name: "第一章", variants: [], chapterId: 1 }],
      mappings: [{ materialId: 10, materialSeq: 0, nodeId: 0 }],
      failed: [],
    } as unknown as MergeResult;
    await importChapterTree(1, [
      { name: "第一章", level: 1, parentName: null },
    ], { result: res });
    expect(dataRef.data.tocMappings.filter((m) => m.materialId === 11)).toHaveLength(1);
    expect(dataRef.data.tocMappings.filter((m) => m.materialId === 10)).toHaveLength(1);
  });
});

describe("relinkUnassignedKps 章节匹配（matchChapterForKp）", () => {
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

  it("归一化同名同时存在于 level1/level2 时取最深：KP 挂到 level2", async () => {
    dataRef.data.chapters = [
      { id: 1, courseId: 1, parentId: null, siyuanBlockId: null, name: "第一章 鸦片战争", level: 1, sort: 1 },
      { id: 2, courseId: 1, parentId: 1, siyuanBlockId: null, name: "1.1 鸦片战争", level: 2, sort: 1 },
    ];
    dataRef.data.knowledgePoints = [
      {
        id: 1, courseId: 1, chapterId: null, blockId: null, name: "鸦片战争", content: "",
        mastery: "unlearn", sourceAssetIds: "", prevKpIds: "", chapterName: "", sort: 1,
        createTime: "2026-01-01T00:00:00Z",
      },
    ];
    const res = await relinkUnassignedKps(1);
    expect(res.linked).toBe(1);
    expect(res.stuck).toBe(0);
    expect(dataRef.data.knowledgePoints[0].chapterId).toBe(2); // 最深命中：1.1 节（L2）而非第一章（L1）
  });
});

describe("createKnowledgePoint 手动新建", () => {
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
    dataRef.data.chapters = [
      { id: 1, courseId: 1, parentId: null, siyuanBlockId: null, name: "第一章 鸦片战争", level: 1, sort: 1 },
      { id: 2, courseId: 1, parentId: 1, siyuanBlockId: null, name: "1.1 战争背景", level: 2, sort: 1 },
    ];
    dataRef.data.knowledgePoints = [
      {
        id: 7, courseId: 1, chapterId: 1, blockId: null, name: "已有知识点A", content: "a",
        mastery: "unlearn", sourceAssetIds: "10", prevKpIds: "", chapterName: "第一章 鸦片战争", sort: 5,
        createTime: "2026-01-01T00:00:00Z",
      },
      {
        id: 9, courseId: 1, chapterId: 2, blockId: null, name: "已有知识点B", content: "b",
        mastery: "unlearn", sourceAssetIds: "10", prevKpIds: "", chapterName: "1.1 战争背景", sort: 7,
        createTime: "2026-01-01T00:00:00Z",
      },
    ];
  });

  it("章下创建：id 取全局最大+1，sort 含子级章节追加末尾，chapterName=章名，无资料来源", async () => {
    const kp = await createKnowledgePoint({ courseId: 1, chapterId: 1, name: "手动知识点", content: "手动内容" });
    expect(kp.id).toBe(10);
    expect(kp.chapterId).toBe(1);
    expect(kp.chapterName).toBe("第一章 鸦片战争");
    expect(kp.sort).toBe(8); // 章1范围（含子级节2）现有最大 sort 7 + 1
    expect(kp.sourceAssetIds).toBe("");
    expect(kp.prevKpIds).toBe("");
    expect(kp.mastery).toBe("unlearn");
    expect(kp.blockId).toBeNull();
    expect(kp.createTime).toBeTruthy();
    expect(dataRef.data.knowledgePoints).toHaveLength(3);
  });

  it("节下创建：sort 只按本节现有 KP 追加", async () => {
    const kp = await createKnowledgePoint({ courseId: 1, chapterId: 2, name: "节内知识点", content: "" });
    expect(kp.chapterId).toBe(2);
    expect(kp.chapterName).toBe("1.1 战争背景");
    expect(kp.sort).toBe(8); // 节2现有最大 sort 7 + 1
  });

  it("未分配创建：chapterId=null、chapterName 空、sort 从 0 起，可带掌握度/标签/文档绑定", async () => {
    const kp = await createKnowledgePoint({
      courseId: 1, chapterId: null, name: "未分配知识点", content: "",
      mastery: "known", tags: ["手动"], blockId: "doc-1", blockName: "某文档",
    });
    expect(kp.chapterId).toBeNull();
    expect(kp.chapterName).toBe("");
    expect(kp.sort).toBe(0);
    expect(kp.mastery).toBe("known");
    expect(kp.tags).toEqual(["手动"]);
    expect(kp.blockId).toBe("doc-1");
    expect(kp.blockName).toBe("某文档");
    expect(dataRef.data.knowledgePoints).toHaveLength(3);
  });
});
