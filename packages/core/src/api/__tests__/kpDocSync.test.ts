import { describe, expect, it } from "vitest";
import type { Chapter, Course, KnowledgePoint } from "../../types/appData";
import { computeKpTreeDiff } from "../../utils/kpTreeImport";
import {
  KP_REGION_BEGIN,
  KP_REGION_END,
  buildSiyuanParsedTree,
  canonicalRegion,
  djb2Hex,
  decideRegionWrite,
  mergeKpRegion,
  parseKpRegion,
  renderKpRegion,
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
  const chA: Chapter = { id: 10, courseId: 1, parentId: null, siyuanBlockId: "docA", name: "章A", level: "chapter", sort: 1 };
  const chB: Chapter = { id: 11, courseId: 1, parentId: 10, siyuanBlockId: "docB", name: "节B", level: "unit", sort: 1 };
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
