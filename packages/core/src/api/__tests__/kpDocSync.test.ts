import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppData, Chapter, Course, KnowledgePoint } from "../../types/appData";
import { createEmptyData } from "../../types/appData";
import { applyKpTreeDiff, computeKpTreeDiff, parseKpTreeMarkdown, type KpTreeDiff } from "../../utils/kpTreeImport";
import { setBridge } from "../../bridge";
import type { StudyBridge } from "../../bridge/types";
import {
  DOC_NOTE,
  DOC_NOTE_MARKER,
  KP_REGION_BEGIN,
  KP_REGION_END,
  buildSiyuanParsedTree,
  canonicalRegion,
  djb2Hex,
  decideRegionWrite,
  ensureDocNote,
  mergeKpRegion,
  parseKpRegion,
  renderKpRegion,
  scheduleKpRegionSync,
} from "../kpDocSync";

function makeKp(over: Partial<KnowledgePoint> & { id: number }): KnowledgePoint {
  return {
    courseId: 1,
    chapterId: null,
    blockId: null,
    name: `KP${over.id}`,
    content: "",
    mastery: "unlearn",
    sourceAssetIds: "",
    prevKpIds: "",
    chapterName: "",
    sort: over.id,
    createTime: "2026-11-01T00:00:00Z",
    ...over,
  };
}

describe("renderKpRegion ↔ parseKpRegion 往返", () => {
  it("多段落/空内容/掌握度标签：解析结果与原数据一致", () => {
    const kps = [
      makeKp({ id: 1, name: "甲", content: "第一段。\n\n第二段。", mastery: "mastered", sort: 2 }),
      makeKp({ id: 2, name: "无内容", sort: 1 }),
    ];
    const region = renderKpRegion(kps);
    expect(region.startsWith(KP_REGION_BEGIN)).toBe(true);
    expect(region.endsWith(KP_REGION_END)).toBe(true);
    expect(region).toContain(`- 无内容 [未学习] <!-- kp:2 -->`);
    expect(region).toContain(`- 甲 [掌握] <!-- kp:1 -->`);
    const parsed = parseKpRegion(region);
    expect(parsed.hasRegion).toBe(true);
    expect(parsed.kps).toEqual([
      { id: 2, name: "无内容", content: "" },
      { id: 1, name: "甲", content: "第一段。\n\n第二段。" },
    ]);
    // 规范哈希顺序敏感：与渲染一致，按 sort 序归一后与原数据比对
    expect(parsed.hash).toBe(djb2Hex(canonicalRegion([...kps].sort((a, b) => a.sort - b.sort))));
  });

  it("空 KP 列表渲染空区，解析为 0 条目", () => {
    const parsed = parseKpRegion(renderKpRegion([]));
    expect(parsed.hasRegion).toBe(true);
    expect(parsed.kps).toEqual([]);
    expect(parsed.hash).toBe(djb2Hex(""));
  });
  it("未闭合锚点（只有 begin 没有 end）= 无区", () => {
    expect(parseKpRegion(`${KP_REGION_BEGIN}\n- 无end [未学习] <!-- kp:9 -->`)).toEqual({
      hasRegion: false,
      kps: [],
      hash: "",
    });
  });
  it("区内无标记条目：id 为 null，name/content 正常解析", () => {
    const parsed = parseKpRegion(`${KP_REGION_BEGIN}\n- 无标记名字\n  其内容\n${KP_REGION_END}`);
    expect(parsed.hasRegion).toBe(true);
    expect(parsed.kps).toEqual([{ id: null, name: "无标记名字", content: "其内容" }]);
  });
});

describe("mergeKpRegion", () => {
  const region = renderKpRegion([makeKp({ id: 1 })]);
  it("有区：仅替换区，锚点外字节保留", () => {
    const old = `# 章A\n\n用户手写内容。\n\n${renderKpRegion([makeKp({ id: 9, name: "旧", content: "旧内容" })])}\n\n区后内容。`;
    const merged = mergeKpRegion(old, region);
    expect(merged.startsWith("# 章A\n\n用户手写内容。\n\n")).toBe(true);
    expect(merged.endsWith("区后内容。")).toBe(true);
    expect(merged).toContain("<!-- kp:1 -->");
    expect(merged).not.toContain("<!-- kp:9 -->");
  });
  it("无区：文末空行分隔追加；空文档：仅区", () => {
    expect(mergeKpRegion("# 章A\n\n已有内容", region)).toBe(`# 章A\n\n已有内容\n\n${region}\n`);
    expect(mergeKpRegion("", region)).toBe(`${region}\n`);
  });
});

describe("ensureDocNote 顶部说明", () => {
  it("插在首个标题行之后，正文保留", () => {
    expect(ensureDocNote("# 章A\n\n正文")).toBe(`# 章A\n\n${DOC_NOTE}\n\n正文`);
  });
  it("幂等：标记已存在 → 原样返回", () => {
    const once = ensureDocNote("# 章A\n\n正文");
    expect(ensureDocNote(once)).toBe(once);
  });
  it("无标题行 → 置顶", () => {
    expect(ensureDocNote("正文")).toBe(`${DOC_NOTE}\n\n正文`);
  });
  it("仅标题 → 说明紧跟标题", () => {
    expect(ensureDocNote("# 章A")).toBe(`# 章A\n\n${DOC_NOTE}`);
  });
});

describe("规范哈希变更检测", () => {
  const base = [makeKp({ id: 1, content: "内容" }), makeKp({ id: 2 })];
  const h0 = djb2Hex(canonicalRegion(base));
  it("用户只加空行（条目间/区首尾）：哈希不变，不触发停写", () => {
    const region = renderKpRegion([makeKp({ id: 1, content: "第一段。\n\n第二段。" })]);
    const h = parseKpRegion(region).hash;
    const tampered = region
      .replace(`${KP_REGION_BEGIN}\n`, `${KP_REGION_BEGIN}\n\n`)
      .replace(KP_REGION_END, `\n\n${KP_REGION_END}`);
    expect(parseKpRegion(tampered).hash).toBe(h);
  });
  it("内容改/行序变/增删行（含无标记条目）：哈希都变", () => {
    expect(djb2Hex(canonicalRegion([makeKp({ id: 1, content: "内容改" }), makeKp({ id: 2 })]))).not.toBe(h0);
    expect(djb2Hex(canonicalRegion([makeKp({ id: 2 }), makeKp({ id: 1, content: "内容" })]))).not.toBe(h0);
    expect(djb2Hex(canonicalRegion([...base, { id: null, name: "用户加的", content: "" }]))).not.toBe(h0);
  });
});

describe("decideRegionWrite 写回分流", () => {
  const H = "abc123";
  it("区 hash == 存储 h + 应用已改 → write（应用领先不误报）", () => {
    expect(decideRegionWrite({ hasStored: true, storedHash: H, regionHash: H, renderedHash: "def" })).toEqual({ action: "write" });
  });
  it("区 hash == 存储 h + 应用未变 → skip", () => {
    expect(decideRegionWrite({ hasStored: true, storedHash: H, regionHash: H, renderedHash: H })).toEqual({ action: "skip" });
  });
  it("区 hash ≠ 存储 h → stop user-modified", () => {
    expect(decideRegionWrite({ hasStored: true, storedHash: H, regionHash: "other", renderedHash: H })).toEqual({
      action: "stop",
      reason: "user-modified",
    });
  });
  it("无区无状态 → write（历史文档追加）；无区有状态 → stop region-deleted；有区无状态 → stop state-missing", () => {
    expect(decideRegionWrite({ hasStored: false, storedHash: null, regionHash: "", renderedHash: H })).toEqual({ action: "write" });
    expect(decideRegionWrite({ hasStored: true, storedHash: H, regionHash: "", renderedHash: H })).toEqual({
      action: "stop",
      reason: "region-deleted",
    });
    expect(decideRegionWrite({ hasStored: false, storedHash: null, regionHash: H, renderedHash: H })).toEqual({
      action: "stop",
      reason: "state-missing",
    });
  });
});

describe("buildSiyuanParsedTree 读回分流", () => {
  const course: Course = {
    id: 1, siyuanDocId: "doc-course", name: "测试课程", description: "", target: "",
    totalCycle: "", status: "active", createTime: "2026-11-01T00:00:00Z",
  };
  const chA: Chapter = { id: 10, courseId: 1, parentId: null, siyuanBlockId: "docA", name: "章A", level: 1, sort: 1 };
  const chB: Chapter = { id: 11, courseId: 1, parentId: 10, siyuanBlockId: "docB", name: "节B", level: 2, sort: 1 };
  const chapters = [chA, chB];

  function kp(over: Partial<KnowledgePoint> & { id: number }): KnowledgePoint {
    return makeKp({ chapterId: 10, ...over });
  }
  const regionOf = (kps: KnowledgePoint[]): string => `# 章\n\n${renderKpRegion(kps)}`;

  it("未改动文档（区 == 应用现状）：diff 全空、无提示计数", () => {
    const kps = [kp({ id: 1, name: "P1", content: "C1" })];
    const docA = regionOf(kps);
    const built = buildSiyuanParsedTree({
      course,
      chapters,
      kps,
      docRegions: { docA: { h: parseKpRegion(docA).hash, ids: [1] } },
      docs: new Map([
        ["docA", docA],
        ["docB", "# 节B\n\n" + KP_REGION_BEGIN + "\n" + KP_REGION_END],
        ["doc-course", "# 测试课程\n\n用户手写"],
      ]),
    });
    expect(built.deletedDocs).toBe(0);
    expect(built.historicalDocs).toBe(1); // 课程文档无区无状态 = 历史
    expect(built.retained).toBe(0);
    const diff = computeKpTreeDiff(built.tree, chapters, kps);
    expect(diff.updated.length + diff.added.length + diff.removed.length).toBe(0);
    expect(diff.chaptersUpdated.length + diff.chaptersAdded.length + diff.chaptersRemoved.length).toBe(0);
  });

  it("无区无状态（历史文档）= 跳过：该章 KP 不删", () => {
    const kps = [kp({ id: 1 })];
    const built = buildSiyuanParsedTree({
      course, chapters, kps, docRegions: {},
      docs: new Map([["docA", "# 章A\n\n用户手写，没有区"], ["docB", "# 节B"], ["doc-course", "# 测试课程"]]),
    });
    expect(built.historicalDocs).toBe(3);
    const diff = computeKpTreeDiff(built.tree, chapters, kps);
    expect(diff.removed).toEqual([]);
    expect(diff.updated).toEqual([]);
  });

  it("无区有状态（用户删了整个区）= 该章全部 KP 进删除预览", () => {
    const kps = [kp({ id: 1 }), kp({ id: 2, chapterId: 10 })];
    const built = buildSiyuanParsedTree({
      course, chapters, kps,
      docRegions: { docA: { h: "x", ids: [1, 2] } },
      docs: new Map([["docA", "# 章A\n\n区被删了"], ["docB", "# 节B"], ["doc-course", "# 测试课程"]]),
    });
    const diff = computeKpTreeDiff(built.tree, chapters, kps);
    expect(diff.removed.map((r) => r.id).sort()).toEqual([1, 2]);
  });

  it("应用待写 KP（id ∉ 存储 ids 并集）= 保留不删 + retained 计数", () => {
    const kps = [kp({ id: 1 }), kp({ id: 2 })]; // 2 是应用刚加、还没写进区的
    const docA = regionOf([kp({ id: 1 })]);
    const built = buildSiyuanParsedTree({
      course, chapters, kps,
      docRegions: { docA: { h: parseKpRegion(docA).hash, ids: [1] } },
      docs: new Map([["docA", docA], ["docB", "# 节B"], ["doc-course", "# 测试课程"]]),
    });
    expect(built.retained).toBe(1);
    const diff = computeKpTreeDiff(built.tree, chapters, kps);
    expect(diff.removed).toEqual([]);
    expect(diff.updated).toEqual([]);
  });

  it("id ∈ 存储 ids 且区内缺失 = 用户删除，进预览", () => {
    const kps = [kp({ id: 1 }), kp({ id: 2 })];
    const docA = regionOf([kp({ id: 2 })]);
    const built = buildSiyuanParsedTree({
      course, chapters, kps,
      docRegions: { docA: { h: parseKpRegion(docA).hash, ids: [1, 2] } },
      docs: new Map([["docA", docA], ["docB", "# 节B"], ["doc-course", "# 测试课程"]]),
    });
    const diff = computeKpTreeDiff(built.tree, chapters, kps);
    expect(diff.removed.map((r) => r.id)).toEqual([1]);
  });

  it("跨文档移动（KP 出现在别章的区）= updated 带 chapterKey 变更", () => {
    const kps = [kp({ id: 1, chapterId: 10 })];
    const built = buildSiyuanParsedTree({
      course, chapters, kps,
      docRegions: {
        docA: { h: "x", ids: [1] },
        docB: { h: parseKpRegion(regionOf([kp({ id: 1 })])).hash, ids: [1] },
      },
      docs: new Map([
        ["docA", "# 章A\n\n" + KP_REGION_BEGIN + "\n" + KP_REGION_END],
        ["docB", regionOf([kp({ id: 1 })])],
        ["doc-course", "# 测试课程"],
      ]),
    });
    const diff = computeKpTreeDiff(built.tree, chapters, kps);
    expect(diff.updated).toHaveLength(1);
    expect(diff.updated[0].id).toBe(1);
    expect(diff.updated[0].chapterKey).toBe("id:11");
  });

  it("区内无标记条目 = added（归所在文档章节）", () => {
    const kps = [kp({ id: 1 })];
    const docA = regionOf([kp({ id: 1 })]).replace(
      KP_REGION_END,
      `- 用户新增 [未学习]\n  新内容\n${KP_REGION_END}`,
    );
    const built = buildSiyuanParsedTree({
      course, chapters, kps,
      docRegions: { docA: { h: "x", ids: [1] } },
      docs: new Map([["docA", docA], ["docB", "# 节B"], ["doc-course", "# 测试课程"]]),
    });
    const diff = computeKpTreeDiff(built.tree, chapters, kps);
    expect(diff.added).toHaveLength(1);
    expect(diff.added[0].name).toBe("用户新增");
    expect(diff.added[0].content).toBe("新内容");
    expect(diff.added[0].chapterKey).toBe("id:10");
  });

  it("L3 章存在时读回零误判：章节 diff 全空（parentKey 按父链如实映射，防父章变更误报）", () => {
    const chC: Chapter = { id: 12, courseId: 1, parentId: 11, siyuanBlockId: null, name: "小节C", level: 3, sort: 1 };
    const chapters3 = [chA, chB, chC];
    // KP 归 L3（12）：文档落点 = 最近 ≤2 祖先「节B」（11），区写在 docB
    const kps = [kp({ id: 1, chapterId: 12 })];
    const docB = "# 节B\n\n" + renderKpRegion(kps);
    const built = buildSiyuanParsedTree({
      course,
      chapters: chapters3,
      kps,
      docRegions: { docB: { h: parseKpRegion(docB).hash, ids: [1] } },
      docs: new Map([
        ["docA", "# 章A\n\n用户手写，没有区"],
        ["docB", docB],
        ["doc-course", "# 测试课程"],
      ]),
    });
    const diff = computeKpTreeDiff(built.tree, chapters3, kps);
    expect(diff.chaptersUpdated).toHaveLength(0);
    expect(diff.chaptersAdded).toHaveLength(0);
    expect(diff.chaptersRemoved).toHaveLength(0);
    expect(diff.updated).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.unchangedKps).toBe(1);
  });

  it("多文档归章：章文档→顶章、节文档→unit、课程文档→未归章；文档不存在=跳过不清空", () => {
    const kps = [kp({ id: 1, chapterId: null })]; // 未归章
    const built = buildSiyuanParsedTree({
      course, chapters, kps,
      docRegions: { "doc-course": { h: "x", ids: [] } },
      docs: new Map([
        ["docA", null], // 章文档被用户删除
        ["docB", "# 节B"],
        ["doc-course", regionOf([]).replace("# 章", "# 测试课程")],
      ]),
    });
    expect(built.deletedDocs).toBe(1);
    expect(built.historicalDocs).toBe(1); // docB 无区无状态
    // 课程文档空区（有区）→ 未归章 KP 区内缺失；id ∉ 存储 ids([]) 并集 → 保留
    expect(built.retained).toBe(1);
    const diff = computeKpTreeDiff(built.tree, chapters, kps);
    expect(diff.removed).toEqual([]);
  });
});

// ---------- 写回管道（bridge mock）文件级设施：写回/读回管道测试共用同一套 mock ----------

const docs = new Map<string, string>();
const calls: {
  update: Array<{ id: string; md: string }>;
  create: Array<{ md: string; path: string; parent: string | null }>;
  remove: string[];
  toast: string[];
} = {
  update: [],
  create: [],
  remove: [],
  toast: [],
};
let data: AppData;

function setup(): void {
  data = createEmptyData();
  data.courses = [
    { id: 1, siyuanDocId: "doc-course", name: "测试课程", description: "", target: "", totalCycle: "", status: "active", createTime: "2026-11-01T00:00:00Z" },
  ];
  data.chapters = [
    { id: 10, courseId: 1, parentId: null, siyuanBlockId: "docA", name: "章A", level: 1, sort: 1 },
  ];
  data.knowledgePoints = [
    { id: 1, courseId: 1, chapterId: 10, blockId: null, name: "KP1", content: "c", mastery: "unlearn", sourceAssetIds: "", prevKpIds: "", chapterName: "章A", sort: 1, createTime: "2026-11-01T00:00:00Z" },
  ];
  data.settings = { chapterMode: "manual", persistToSiyuan: true, notebookName: "AI 研习" };
  docs.clear();
  docs.set("doc-course", "# 测试课程");
  docs.set("docA", "# 章A\n\n用户手写");
  calls.update.length = 0;
  calls.create.length = 0;
  calls.remove.length = 0;
  calls.toast.length = 0;
}

beforeAll(() => {
  (globalThis as Record<string, unknown>).window = {
    addEventListener: () => {},
    dispatchEvent: () => true,
  };
});

beforeEach(() => {
  setup();
  vi.useFakeTimers();
  setBridge({
    capabilities: { docs: "siyuan" },
    getData: async () => data,
    saveData: async (next: AppData) => {
      data = next;
      return { code: 0, dirty: { global: true, courseIds: [] } };
    },
    ensureFolder: async () => "nb",
    createDoc: async (md: string, path: string, _nb: string, parent?: string | null) => {
      const id = `doc-new-${calls.create.length}`;
      calls.create.push({ md, path, parent: parent ?? null });
      docs.set(id, md);
      return { id };
    },
    updateDoc: async (id: string, md: string) => {
      calls.update.push({ id, md });
      docs.set(id, md);
    },
    getDocMarkdown: async (id: string) => (docs.has(id) ? (docs.get(id) as string) : null),
    docExists: async (id: string) => docs.has(id),
    showMessage: (msg: string) => {
      calls.toast.push(msg);
    },
    isValidDocRef: () => true,
    moveDoc: async () => {},
    renameDoc: async () => {},
    removeDoc: async (id: string) => {
      calls.remove.push(id);
      docs.delete(id);
    },
  } as unknown as StudyBridge);
});

afterEach(() => {
  vi.useRealTimers();
});

const flush = () => vi.advanceTimersByTimeAsync(1000);

describe("写回管道（bridge mock）", () => {
  it("历史文档（无区无状态）：追加区 + 顶部说明 + 存状态", async () => {
    await scheduleKpRegionSync(1, 10, 0);
    await flush();
    expect(calls.update).toHaveLength(1);
    expect(calls.update[0].id).toBe("docA");
    expect(calls.update[0].md).toContain("用户手写");
    expect(calls.update[0].md).toContain("<!-- kp:1 -->");
    // 说明在标题后、正文前（幂等标记）
    expect(calls.update[0].md).toContain(DOC_NOTE_MARKER);
    expect(calls.update[0].md.indexOf(DOC_NOTE_MARKER)).toBeLessThan(calls.update[0].md.indexOf("用户手写"));
    expect(data.docRegions?.docA?.ids).toEqual([1]);
  });

  it("应用领先（区 == 存储态、应用已改）：正常写回，不误报停写", async () => {
    docs.set("docA", `# 章A\n\n用户手写\n\n${renderKpRegion(data.knowledgePoints)}`);
    data.docRegions = { docA: { h: parseKpRegion(docs.get("docA")!).hash, ids: [1] } };
    data.knowledgePoints[0] = { ...data.knowledgePoints[0], content: "c2" };
    await scheduleKpRegionSync(1, 10, 0);
    await flush();
    expect(calls.update).toHaveLength(1);
    expect(calls.update[0].md).toContain("c2");
    expect(calls.toast).toEqual([]);
  });

  it("用户在思源改过区：停写 + toast，文档不变", async () => {
    docs.set("docA", `# 章A\n\n${renderKpRegion(data.knowledgePoints)}`.replace("c", "c-用户改"));
    data.docRegions = { docA: { h: "old-hash", ids: [1] } };
    await scheduleKpRegionSync(1, 10, 0);
    await flush();
    expect(calls.update).toHaveLength(0);
    expect(calls.toast.some((t) => t.includes("未同步编辑"))).toBe(true);
  });

  it("用户删了整个区：停写 region-deleted", async () => {
    docs.set("docA", "# 章A\n\n区没了");
    data.docRegions = { docA: { h: "x", ids: [1] } };
    await scheduleKpRegionSync(1, 10, 0);
    await flush();
    expect(calls.update).toHaveLength(0);
    expect(calls.toast.some((t) => t.includes("删除"))).toBe(true);
  });

  it("文档被删：自愈重建（新 docId 回填 + toast）", async () => {
    docs.delete("docA");
    await scheduleKpRegionSync(1, 10, 0);
    await flush();
    expect(calls.create).toHaveLength(1);
    expect(calls.create[0].path).toBe("/测试课程/章A");
    expect(calls.create[0].parent).toBe("doc-course");
    expect(data.chapters[0].siyuanBlockId).not.toBe("docA");
    expect(calls.toast.some((t) => t.includes("重建"))).toBe(true);
  });

  it("siyuanBlockId 为 null：补建文档 + 回填 id", async () => {
    data.chapters[0].siyuanBlockId = null;
    await scheduleKpRegionSync(1, 10, 0);
    await flush();
    expect(calls.create).toHaveLength(1);
    expect(data.chapters[0].siyuanBlockId).toBe("doc-new-0");
  });

  it("课程未落库（siyuanDocId=null）+ 章文档存在：未归章 KP 触发课程文档补建 + 回填 course.siyuanDocId", async () => {
    data.courses[0].siyuanDocId = null;
    data.knowledgePoints[0].chapterId = null;
    await scheduleKpRegionSync(1, null, 0);
    await flush();
    expect(calls.create).toHaveLength(1);
    expect(calls.create[0].path).toBe("/测试课程");
    expect(calls.create[0].parent).toBeNull();
    expect(data.courses[0].siyuanDocId).toBe("doc-new-0");
    expect(calls.toast.some((t) => t.includes("补建"))).toBe(true);
  });

  it("未归章（node=null）：写课程顶层文档", async () => {
    data.knowledgePoints[0].chapterId = null;
    await scheduleKpRegionSync(1, null, 0);
    await flush();
    expect(calls.update[0].id).toBe("doc-course");
    expect(calls.update[0].md).toContain("<!-- kp:1 -->");
  });

  it("level>2 节点的 KP 区域同步落最近有文档祖先（L3 → L2 文档，不为 L3 建文档）", async () => {
    // 章A(L1, docA) → 节B(L2, docB) → 小节C(L3, siyuanBlockId=null)
    data.chapters.push(
      { id: 11, courseId: 1, parentId: 10, siyuanBlockId: "docB", name: "节B", level: 2, sort: 2 },
      { id: 12, courseId: 1, parentId: 11, siyuanBlockId: null, name: "小节C", level: 3, sort: 1 },
    );
    data.knowledgePoints[0] = { ...data.knowledgePoints[0], chapterId: 12, chapterName: "小节C" };
    docs.set("docB", "# 节B");
    // 以深节点 id 直接调度（与 createChapter 调用形态一致），落点应归一到 L2 文档
    await scheduleKpRegionSync(1, 12, 0);
    await flush();
    expect(calls.update).toHaveLength(1);
    expect(calls.update[0].id).toBe("docB");
    expect(calls.update[0].md).toContain("<!-- kp:1 -->");
    expect(data.docRegions?.docB?.ids).toEqual([1]);
    expect(calls.create).toEqual([]); // level≥3 不建思源文档
    expect(calls.update.every((u) => u.id !== "doc-course")).toBe(true); // 也不再落课程顶层文档
  });

  it("更深层节点（L4）同样上溯到最近 level≤2 祖先文档", async () => {
    data.chapters.push(
      { id: 11, courseId: 1, parentId: 10, siyuanBlockId: "docB", name: "节B", level: 2, sort: 2 },
      { id: 12, courseId: 1, parentId: 11, siyuanBlockId: null, name: "小节C", level: 3, sort: 1 },
      { id: 13, courseId: 1, parentId: 12, siyuanBlockId: null, name: "小小节D", level: 4, sort: 1 },
    );
    data.knowledgePoints[0] = { ...data.knowledgePoints[0], chapterId: 13, chapterName: "小小节D" };
    docs.set("docB", "# 节B");
    await scheduleKpRegionSync(1, 13, 0);
    await flush();
    expect(calls.update).toHaveLength(1);
    expect(calls.update[0].id).toBe("docB");
    expect(calls.update[0].md).toContain("<!-- kp:1 -->");
    expect(calls.create).toEqual([]);
  });

  it("persistToSiyuan 关闭：不写不提示", async () => {
    data.settings.persistToSiyuan = false;
    await scheduleKpRegionSync(1, 10, 0);
    await flush();
    expect(calls.update).toHaveLength(0);
    expect(calls.toast).toEqual([]);
  });

  it("同文档连续两次变更：防抖合并为一次写入", async () => {
    data.knowledgePoints[0] = { ...data.knowledgePoints[0], content: "c2" };
    await scheduleKpRegionSync(1, 10, 100);
    data.knowledgePoints[0] = { ...data.knowledgePoints[0], content: "c3" };
    await scheduleKpRegionSync(1, 10, 100);
    await flush();
    expect(calls.update).toHaveLength(1);
    expect(calls.update[0].md).toContain("c3");
  });
});

describe("写回竞态（课程顶层文档缺失时创建章文档）", () => {
  it("章+课程文档都缺：先建课程文档再建章文档（parent=新课程文档，双 id 回填）", async () => {
    data.courses[0].siyuanDocId = null;
    data.chapters[0].siyuanBlockId = null;
    await scheduleKpRegionSync(1, 10, 0);
    await flush();
    expect(calls.create).toHaveLength(2);
    expect(calls.create[0].path).toBe("/测试课程"); // 课程文档先建
    expect(calls.create[0].parent).toBeNull();
    expect(calls.create[1].path).toBe("/测试课程/章A");
    expect(calls.create[1].parent).toBe("doc-new-0"); // 课程文档新 id
    expect(data.courses[0].siyuanDocId).toBe("doc-new-0");
    expect(data.chapters[0].siyuanBlockId).toBe("doc-new-1");
    // 仅章文档有区状态（ensureCourseDoc 建的课程文档不带区 → 无写回状态；
    // 若给无区文档写状态，下次课程同步会误判 region-deleted 停写）
    expect(Object.keys(data.docRegions ?? {})).toHaveLength(1);
    expect(data.docRegions?.["doc-new-1"]?.ids).toEqual([1]);
  });

  it("并行多章建文档 + 课程文档缺：课程文档只建一次，两章 parent 均为该课程文档", async () => {
    data.courses[0].siyuanDocId = null;
    data.chapters[0].siyuanBlockId = null;
    data.chapters.push({ id: 11, courseId: 1, parentId: null, siyuanBlockId: null, name: "章B", level: 1, sort: 2 });
    await scheduleKpRegionSync(1, 10, 0);
    await scheduleKpRegionSync(1, 11, 0);
    await flush();
    const courseCreates = calls.create.filter((c) => c.path === "/测试课程");
    expect(courseCreates).toHaveLength(1);
    expect(courseCreates[0].parent).toBeNull();
    expect(calls.create.find((c) => c.path === "/测试课程/章A")?.parent).toBe("doc-new-0");
    expect(calls.create.find((c) => c.path === "/测试课程/章B")?.parent).toBe("doc-new-0");
    expect(data.courses[0].siyuanDocId).toBe("doc-new-0");
    expect(data.chapters[0].siyuanBlockId).not.toBeNull();
    expect(data.chapters[1].siyuanBlockId).not.toBeNull();
  });
});

describe("读回管道（bridge mock）", () => {
  it("readSiyuanKpSync：读全部文档 → diff + 计数 + readCtx", async () => {
    setup();
    const { readSiyuanKpSync } = await import("../kpDocSync");
    const preview = await readSiyuanKpSync(1);
    expect(preview.tree.courseId).toBe(1);
    expect(preview.tree.chapters.map((c) => c.id).sort()).toEqual([10]); // 现有章节全部带标记
    expect(preview.readCtx.nodes).toHaveLength(2); // 章A + 课程文档
    expect(preview.diff.removed).toEqual([]);
  });

  it("applySiyuanKpSync：区内改动落数据（掌握度不变）+ 刷新存储态", async () => {
    setup();
    const kpDocSync = await import("../kpDocSync");
    const region = kpDocSync.renderKpRegion([
      { ...data.knowledgePoints[0], name: "KP1改", content: "c改" },
    ]);
    docs.set("docA", `# 章A\n\n${region}`);
    const preview = await kpDocSync.readSiyuanKpSync(1);
    expect(preview.diff.updated).toHaveLength(1);
    await kpDocSync.applySiyuanKpSync(1, preview);
    expect(data.knowledgePoints[0].name).toBe("KP1改");
    expect(data.knowledgePoints[0].content).toBe("c改");
    expect(data.knowledgePoints[0].mastery).toBe("unlearn"); // 学习状态不动
    expect(data.docRegions?.docA).toBeDefined();
    expect(data.docRegions?.docA!.ids).toEqual([1]);
  });

  it("applySiyuanKpSync：用户删了整个区（无区有状态）→ 确认后删 KP + 删 docRegions 条目", async () => {
    setup();
    data.docRegions = { docA: { h: "x", ids: [1] } };
    docs.set("docA", "# 章A\n\n区被删了");
    const kpDocSync = await import("../kpDocSync");
    const preview = await kpDocSync.readSiyuanKpSync(1);
    expect(preview.diff.removed).toHaveLength(1);
    await kpDocSync.applySiyuanKpSync(1, preview);
    expect(data.knowledgePoints).toHaveLength(0);
    expect(data.docRegions?.docA).toBeUndefined(); // 删除状态条目（不再停写死循环）
  });

  it("applySiyuanKpSync：保留待写 KP → 合并回区写回 + 状态刷新", async () => {
    setup();
    // 区里只有「KP1」的旧写入态；应用又新增了 KP2（待写，∉ 存储 ids）
    const rendered = (await import("../kpDocSync")).renderKpRegion([data.knowledgePoints[0]]);
    docs.set("docA", `# 章A\n\n${rendered}`);
    data.docRegions = { docA: { h: "old", ids: [1] } };
    data.knowledgePoints.push({ ...data.knowledgePoints[0], id: 2, name: "KP2", content: "", chapterName: "章A", sort: 2 });
    const kpDocSync = await import("../kpDocSync");
    const preview = await kpDocSync.readSiyuanKpSync(1);
    expect(preview.retained).toBe(1);
    expect(preview.diff.removed).toEqual([]);
    await kpDocSync.applySiyuanKpSync(1, preview);
    const mdA = docs.get("docA")!;
    expect(mdA).toContain("<!-- kp:2 -->"); // 待写 KP 已合并回区
    expect(data.docRegions?.docA!.ids.sort()).toEqual([1, 2]);
  });

  it("applySiyuanKpSync：区在期间又被改 → 跳过该文档写回，不覆盖新编辑", async () => {
    setup();
    const kpDocSync = await import("../kpDocSync");
    // 读回时：用户已把内容从「c」改成「内容a」（产生 updated diff）
    docs.set("docA", kpDocSync.renderKpRegion([{ ...data.knowledgePoints[0], content: "内容a" }]));
    data.docRegions = { docA: { h: kpDocSync.parseKpRegion(docs.get("docA")!).hash, ids: [1] } };
    const preview = await kpDocSync.readSiyuanKpSync(1);
    expect(preview.diff.updated).toHaveLength(1);
    // 读回后、确认前，用户又改成「内容b」
    docs.set("docA", docs.get("docA")!.replace("内容a", "内容b"));
    await kpDocSync.applySiyuanKpSync(1, preview);
    expect(data.knowledgePoints[0].content).toBe("内容a"); // 读回态落盘
    expect(docs.get("docA")!).toContain("内容b"); // 期间新编辑未被覆盖
  });
});

describe("历史文档批量回填（bridge mock）", () => {
  it("无区无状态 + 应用有 KP → 确认后区追加到文档末尾 + 存状态（无 diff 也执行）", async () => {
    setup();
    const kpDocSync = await import("../kpDocSync");
    const preview = await kpDocSync.readSiyuanKpSync(1);
    expect(preview.diff.updated).toHaveLength(0); // 历史文档不产生 diff
    expect(preview.backfillDocs).toBe(1); // 章A 有 KP；课程文档无直属 KP
    await kpDocSync.applySiyuanKpSync(1, preview);
    expect(calls.update).toHaveLength(1);
    expect(calls.update[0].id).toBe("docA");
    expect(calls.update[0].md).toContain("用户手写"); // 已有内容保留
    expect(calls.update[0].md.indexOf("用户手写")).toBeLessThan(calls.update[0].md.indexOf(KP_REGION_BEGIN)); // 区在文末
    expect(calls.update[0].md).toContain("<!-- kp:1 -->");
    expect(data.docRegions?.docA?.ids).toEqual([1]);
  });

  it("文档缺失（docId=null）→ 补建文档含区 + 回填 siyuanBlockId", async () => {
    setup();
    data.chapters[0].siyuanBlockId = null;
    const kpDocSync = await import("../kpDocSync");
    const preview = await kpDocSync.readSiyuanKpSync(1);
    expect(preview.backfillDocs).toBe(1);
    await kpDocSync.applySiyuanKpSync(1, preview);
    expect(calls.update).toHaveLength(0);
    expect(calls.create).toHaveLength(1);
    expect(calls.create[0].path).toBe("/测试课程/章A");
    expect(calls.create[0].parent).toBe("doc-course");
    expect(calls.create[0].md).toContain("# 章A");
    expect(calls.create[0].md).toContain(DOC_NOTE_MARKER); // 创建内容即含说明
    expect(calls.create[0].md.indexOf(DOC_NOTE_MARKER)).toBeLessThan(calls.create[0].md.indexOf(KP_REGION_BEGIN)); // 说明在区前
    expect(calls.create[0].md).toContain("<!-- kp:1 -->"); // 创建内容即含区
    expect(data.chapters[0].siyuanBlockId).toBe("doc-new-0");
    expect(data.docRegions?.["doc-new-0"]?.ids).toEqual([1]);
  });

  it("unit 文档缺失且父章文档也缺失 → 先建父章（不带区）再建 unit（带区）", async () => {
    setup();
    data.chapters.push({ id: 11, courseId: 1, parentId: 10, siyuanBlockId: null, name: "节A1", level: 2, sort: 2 });
    data.chapters[0].siyuanBlockId = null;
    data.knowledgePoints[0].chapterId = 11; // KP 直属 unit
    const kpDocSync = await import("../kpDocSync");
    const preview = await kpDocSync.readSiyuanKpSync(1);
    expect(preview.backfillDocs).toBe(1); // 仅 unit 有 KP
    await kpDocSync.applySiyuanKpSync(1, preview);
    expect(calls.create).toHaveLength(2);
    expect(calls.create[0].path).toBe("/测试课程/章A"); // 父章先建（链上补建不带区）
    expect(calls.create[0].md).not.toContain(KP_REGION_BEGIN);
    expect(calls.create[0].parent).toBe("doc-course");
    expect(calls.create[1].path).toBe("/测试课程/章A/节A1");
    expect(calls.create[1].parent).toBe("doc-new-0");
    expect(calls.create[1].md).toContain("<!-- kp:1 -->");
    expect(data.docRegions).toEqual({ "doc-new-1": { h: expect.any(String), ids: [1] } });
  });

  it("回填期间文档出现区 → 不覆盖", async () => {
    setup();
    const kpDocSync = await import("../kpDocSync");
    const preview = await kpDocSync.readSiyuanKpSync(1);
    docs.set("docA", `# 章A\n\n${kpDocSync.renderKpRegion([data.knowledgePoints[0]])}`); // 期间他人写入
    await kpDocSync.applySiyuanKpSync(1, preview);
    expect(calls.update).toHaveLength(0);
    expect(data.docRegions?.docA).toBeUndefined();
  });

  it("删区确认（无区有状态）→ 不回填", async () => {
    setup();
    data.docRegions = { docA: { h: "x", ids: [1] } };
    docs.set("docA", "# 章A\n\n区被删了");
    const kpDocSync = await import("../kpDocSync");
    const preview = await kpDocSync.readSiyuanKpSync(1);
    expect(preview.backfillDocs).toBe(0); // 有状态 → 非回填对象
    await kpDocSync.applySiyuanKpSync(1, preview);
    expect(calls.update).toHaveLength(0);
    expect(data.docRegions?.docA).toBeUndefined(); // 状态条目已删（后续不回填，KP 已删无内容可写）
  });

  it("历史文档无 KP → 不回填（避免把用户删掉的空区又写回来）", async () => {
    setup();
    data.knowledgePoints = [];
    const kpDocSync = await import("../kpDocSync");
    const preview = await kpDocSync.readSiyuanKpSync(1);
    expect(preview.backfillDocs).toBe(0);
    expect(preview.historicalDocs).toBe(2); // 章A + 课程文档
    await kpDocSync.applySiyuanKpSync(1, preview);
    expect(calls.update).toHaveLength(0);
    expect(calls.create).toHaveLength(0);
  });
});

describe("顶部说明回补（bridge mock）", () => {
  it("有区无说明：preview 计 noteDocs；apply 仅插说明，区与状态不动", async () => {
    setup();
    const kpDocSync = await import("../kpDocSync");
    const region = kpDocSync.renderKpRegion([data.knowledgePoints[0]]);
    docs.set("docA", `# 章A\n\n${region}`);
    const oldHash = kpDocSync.parseKpRegion(region).hash;
    data.docRegions = { docA: { h: oldHash, ids: [1] } };
    const preview = await kpDocSync.readSiyuanKpSync(1);
    expect(preview.noteDocs).toBe(1);
    expect(preview.diff.updated).toHaveLength(0); // 区一致 → 无 diff
    await kpDocSync.applySiyuanKpSync(1, preview);
    expect(calls.update).toHaveLength(1);
    expect(calls.update[0].id).toBe("docA");
    const md = docs.get("docA")!;
    expect(md).toContain(DOC_NOTE_MARKER);
    expect(md.indexOf(DOC_NOTE_MARKER)).toBeLessThan(md.indexOf(KP_REGION_BEGIN)); // 说明在区前
    expect(kpDocSync.parseKpRegion(md).hash).toBe(oldHash); // 区字节不变
    expect(data.docRegions?.docA).toEqual({ h: oldHash, ids: [1] }); // 状态不变
  });

  it("期间区被删 → 不插说明（交由停写检测）", async () => {
    setup();
    const kpDocSync = await import("../kpDocSync");
    const region = kpDocSync.renderKpRegion([data.knowledgePoints[0]]);
    docs.set("docA", `# 章A\n\n${region}`);
    data.docRegions = { docA: { h: kpDocSync.parseKpRegion(region).hash, ids: [1] } };
    const preview = await kpDocSync.readSiyuanKpSync(1);
    expect(preview.noteDocs).toBe(1);
    docs.set("docA", "# 章A\n\n区没了"); // 读回后、确认前区被删
    await kpDocSync.applySiyuanKpSync(1, preview);
    expect(calls.update).toHaveLength(0);
    expect(docs.get("docA")).not.toContain(DOC_NOTE_MARKER);
  });

  it("已有说明 → 不计 noteDocs 不写", async () => {
    setup();
    const kpDocSync = await import("../kpDocSync");
    const region = kpDocSync.renderKpRegion([data.knowledgePoints[0]]);
    docs.set("docA", ensureDocNote(`# 章A\n\n${region}`));
    data.docRegions = { docA: { h: kpDocSync.parseKpRegion(region).hash, ids: [1] } };
    const preview = await kpDocSync.readSiyuanKpSync(1);
    expect(preview.noteDocs).toBe(0);
    await kpDocSync.applySiyuanKpSync(1, preview);
    expect(calls.update).toHaveLength(0);
  });
});

describe("syncChapterStructure（bridge mock）", () => {
  it("新建章（章+节）→ createDoc 挂对父 + 回填 siyuanBlockId；删章 → removeDoc + 清 docRegions", async () => {
    setup();
    data.docRegions = { docDel: { h: "x", ids: [] } };
    data.chapters.push({ id: 90, courseId: 1, parentId: null, siyuanBlockId: "docDel", name: "待删章", level: 1, sort: 5 });
    const addedTop: Chapter = { id: 20, courseId: 1, parentId: null, siyuanBlockId: null, name: "新章", level: 1, sort: 2 };
    const addedUnit: Chapter = { id: 21, courseId: 1, parentId: 20, siyuanBlockId: null, name: "新节", level: 2, sort: 1 };
    const { syncChapterStructure } = await import("../kpDocSync");
    const diff: KpTreeDiff = {
      updated: [], added: [], removed: [], unchangedKps: 0,
      chaptersUpdated: [],
      chaptersAdded: [
        { key: "new:0", name: "新章", level: 1, parentKey: null, sort: 2 },
        { key: "new:1", name: "新节", level: 2, parentKey: "new:0", sort: 1 },
      ],
      chaptersRemoved: [{ id: 90, name: "待删章", siyuanBlockId: "docDel" }],
    };
    await syncChapterStructure(1, diff, [addedTop, addedUnit]);
    expect(calls.create).toHaveLength(2);
    expect(calls.create[0].path).toBe("/测试课程/新章");
    expect(calls.create[0].parent).toBe("doc-course");
    expect(calls.create[1].path).toBe("/测试课程/新章/新节");
    expect(calls.create[1].parent).toBe(addedTop.siyuanBlockId); // 新章刚回填的 docId
    expect(addedTop.siyuanBlockId).toBe("doc-new-0");
    expect(addedUnit.siyuanBlockId).toBe("doc-new-1");
    expect(docs.has("docDel")).toBe(false);
    expect(data.docRegions?.docDel).toBeUndefined();
  });

  it("删章回归：apply 已把章移出 data 后，仍按 diff 快照删思源文档 + 清 docRegions", async () => {
    setup();
    // ch10 为待删章（有思源文档 + 区状态）；ch11 为保留章
    data.chapters = [
      { id: 10, courseId: 1, parentId: null, siyuanBlockId: "doc-old-10", name: "章A", level: 1, sort: 1 },
      { id: 11, courseId: 1, parentId: null, siyuanBlockId: "doc-11", name: "章B", level: 1, sort: 2 },
    ];
    data.knowledgePoints = [
      { id: 1, courseId: 1, chapterId: 10, blockId: null, name: "KP1", content: "", mastery: "unlearn", sourceAssetIds: "", prevKpIds: "", chapterName: "章A", sort: 1, createTime: "2026-11-01T00:00:00Z" },
      { id: 2, courseId: 1, chapterId: 11, blockId: null, name: "KP2", content: "", mastery: "unlearn", sourceAssetIds: "", prevKpIds: "", chapterName: "章B", sort: 1, createTime: "2026-11-01T00:00:00Z" },
    ];
    data.docRegions = { "doc-old-10": { h: "h10", ids: [1] }, "doc-11": { h: "h11", ids: [2] } };
    docs.set("doc-old-10", "# 章A\n\n正文");
    docs.set("doc-11", "# 章B\n\n正文");

    // md 树仅保留 ch11（ch10 整章被删）→ 真实解析 + 真实 diff
    const res = parseKpTreeMarkdown("# 测试课程 知识点树\n# 章B (1) <!-- ch:11 -->\n- KP2 [未学习] <!-- kp:2 -->\n");
    if (!res.ok) throw new Error(res.error);
    const tree = res.tree;
    const diff = computeKpTreeDiff(tree, data.chapters, data.knowledgePoints);
    expect(diff.chaptersRemoved).toEqual([{ id: 10, name: "章A", siyuanBlockId: "doc-old-10" }]);

    // 真实流程：先 apply（ch10 从 data.chapters 消失），再 syncChapterStructure
    data = applyKpTreeDiff(data, 1, tree, diff);
    expect(data.chapters.map((c) => c.id)).toEqual([11]);
    const { syncChapterStructure } = await import("../kpDocSync");
    await syncChapterStructure(1, diff, []);

    expect(calls.remove).toContain("doc-old-10"); // 修复前静默跳过，此处为空
    expect(docs.has("doc-old-10")).toBe(false);
    expect(data.docRegions?.["doc-old-10"]).toBeUndefined();
    expect(data.docRegions?.["doc-11"]).toEqual({ h: "h11", ids: [2] }); // 保留章状态不受影响
  });

  it("课程顶层文档为 null：先补建课程文档再挂章", async () => {
    setup();
    data.courses[0].siyuanDocId = null;
    const addedTop: Chapter = { id: 20, courseId: 1, parentId: null, siyuanBlockId: null, name: "新章", level: 1, sort: 1 };
    const { syncChapterStructure } = await import("../kpDocSync");
    await syncChapterStructure(1, {
      updated: [], added: [], removed: [], unchangedKps: 0,
      chaptersUpdated: [],
      chaptersAdded: [{ key: "new:0", name: "新章", level: 1, parentKey: null, sort: 1 }],
      chaptersRemoved: [],
    }, [addedTop]);
    expect(calls.create.length).toBe(2); // 课程文档 + 章
    expect(calls.create[0].path).toBe("/测试课程");
    expect(data.courses[0].siyuanDocId).toBe("doc-new-0");
    expect(calls.create[1].parent).toBe("doc-new-0");
  });
});

import { nodeDocTarget } from "../kpDocSync";

describe("nodeDocTarget 斜杠路径", () => {
  const course: Course = {
    id: 1, siyuanDocId: "dc", name: "自学/项目管理", description: "", target: "",
    totalCycle: "", status: "active", createTime: "", modelId: null,
  };
  const ch: Chapter = { id: 10, courseId: 1, parentId: null, siyuanBlockId: "dc1", name: "第08章 项目风险管理", level: 1, sort: 1 };
  const unit: Chapter = { id: 11, courseId: 1, parentId: 10, siyuanBlockId: "dc2", name: "重点/难点/考点", level: 2, sort: 1 };

  it("节名含 /：path 段全角，titleLine/label 保持原样", () => {
    const t = nodeDocTarget(course, [ch, unit], 11);
    expect(t.path).toBe("/自学／项目管理/第08章 项目风险管理/重点／难点／考点");
    expect(t.titleLine).toBe("# 重点/难点/考点");
    expect(t.label).toBe("第08章 项目风险管理 · 重点/难点/考点");
    expect(t.parentID).toBe("dc1");
  });

  it("章名含 /：path 段全角", () => {
    const ch2: Chapter = { id: 12, courseId: 1, parentId: null, siyuanBlockId: "dc3", name: "12.2 自制/外购决策", level: 1, sort: 2 };
    const t = nodeDocTarget(course, [ch, ch2], 12);
    expect(t.path).toBe("/自学／项目管理/12.2 自制／外购决策");
  });
});

import {
  RELATED_REGION_BEGIN,
  RELATED_REGION_END,
  extractRelatedSection,
  mergeRelatedSection,
  renderRelatedSection,
} from "../kpDocSync";

describe("相关知识点区（块引用）", () => {
  const course: Course = {
    id: 1, siyuanDocId: "doc-course", name: "测试课程", description: "", target: "",
    totalCycle: "", status: "active", createTime: "", modelId: null,
  };
  const ch1: Chapter = { id: 10, courseId: 1, parentId: null, siyuanBlockId: "doc-ch1", name: "第一章", level: 1, sort: 1 };
  const ch2: Chapter = { id: 11, courseId: 1, parentId: null, siyuanBlockId: "doc-ch2", name: "第二章", level: 1, sort: 2 };
  const chNoDoc: Chapter = { id: 12, courseId: 1, parentId: null, siyuanBlockId: null, name: "未落库章", level: 1, sort: 3 };
  const unit1: Chapter = { id: 13, courseId: 1, parentId: 10, siyuanBlockId: "doc-unit1", name: "第一节", level: 2, sort: 1 };
  const chapters = [ch1, ch2, chNoDoc, unit1];

  it("前置 KP 在章文档：生成指向该章文档的块引用", () => {
    const kps = [
      makeKp({ id: 1, name: "KP甲", chapterId: 10, prevKpIds: "2" }),
      makeKp({ id: 2, name: "KP乙", chapterId: 11 }),
    ];
    const block = renderRelatedSection(course, chapters, [kps[0]], kps, "doc-ch1");
    expect(block).toBe(`${RELATED_REGION_BEGIN}\n## 相关知识点\n\n- ((doc-ch2 "KP乙"))\n${RELATED_REGION_END}`);
  });

  it("未归章 KP 在课程文档：引用其章文档；同文档目标跳过", () => {
    const kps = [
      makeKp({ id: 1, name: "KP甲", chapterId: null, prevKpIds: "2,3" }),
      makeKp({ id: 2, name: "KP乙", chapterId: 10 }),
      makeKp({ id: 3, name: "KP丙", chapterId: null }),
    ];
    const block = renderRelatedSection(course, chapters, [kps[0]], kps, "doc-course");
    // 丙与甲同在课程文档 → 自引用跳过；乙在第一章 → 引用
    expect(block).toBe(`${RELATED_REGION_BEGIN}\n## 相关知识点\n\n- ((doc-ch1 "KP乙"))\n${RELATED_REGION_END}`);
  });

  it("目标章未落库（docId 为空）跳过；无任何引用 → null", () => {
    const kps = [
      makeKp({ id: 1, name: "KP甲", chapterId: 10, prevKpIds: "2" }),
      makeKp({ id: 2, name: "KP乙", chapterId: 12 }),
    ];
    expect(renderRelatedSection(course, chapters, [kps[0]], kps, "doc-ch1")).toBeNull();
    expect(renderRelatedSection(course, chapters, [makeKp({ id: 1, chapterId: 10 })], [makeKp({ id: 1, chapterId: 10 })], "doc-ch1")).toBeNull();
  });

  it("节直属 KP 的前置在另一章：引用章文档（unit 口径与节点区一致）", () => {
    const kps = [
      makeKp({ id: 1, name: "KP甲", chapterId: 13, prevKpIds: "2" }),
      makeKp({ id: 2, name: "KP乙", chapterId: 11 }),
    ];
    const block = renderRelatedSection(course, chapters, [kps[0]], kps, "doc-unit1");
    expect(block).toContain("- ((doc-ch2 \"KP乙\"))");
  });

  it("重复 (文档, KP) 去重；名称内双引号转全角", () => {
    const kps = [
      makeKp({ id: 1, name: "KP甲", chapterId: 10, prevKpIds: "2,2,3" }),
      makeKp({ id: 2, name: 'KP"乙', chapterId: 11 }),
      makeKp({ id: 3, name: "KP丙", chapterId: 11 }),
    ];
    const block = renderRelatedSection(course, chapters, [kps[0]], kps, "doc-ch1");
    expect(block).toContain("- ((doc-ch2 \"KP”乙\"))");
    expect(block!.match(/\(\(/g)!.length).toBe(2);
  });

  it("extract ↔ merge 往返：追加 / 替换 / 删除（KP 区与锚点外内容保留）", () => {
    const base = `# 第一章\n\n手写内容\n\n${KP_REGION_BEGIN}\n- KP甲 [未学习] <!-- kp:1 -->\n${KP_REGION_END}`;
    const block = `${RELATED_REGION_BEGIN}\n## 相关知识点\n\n- ((doc-ch2 "KP乙"))\n${RELATED_REGION_END}`;
    // 追加
    const added = mergeRelatedSection(base, block);
    expect(added).toContain("手写内容");
    expect(added.trimEnd()).toBe(base + "\n\n" + block.trimEnd());
    // 替换
    const replaced = mergeRelatedSection(added, null);
    expect(replaced).not.toContain(RELATED_REGION_BEGIN);
    expect(replaced).toContain("手写内容");
    expect(replaced.trimEnd()).toBe(base.trimEnd());
    // 再追加另一个
    const block2 = `${RELATED_REGION_BEGIN}\n## 相关知识点\n\n- ((doc-ch1 "KP丙"))\n${RELATED_REGION_END}`;
    const added2 = mergeRelatedSection(replaced, block2);
    const replaced2 = mergeRelatedSection(added2, block);
    expect(replaced2).toContain("- ((doc-ch2 \"KP乙\"))");
    expect(replaced2).not.toContain("KP丙");
    expect(extractRelatedSection(replaced2)).toBe(block);
    expect(extractRelatedSection(base)).toBeNull();
    // 无区且 block 为 null → 原样
    expect(mergeRelatedSection(base, null)).toBe(base);
  });
});
