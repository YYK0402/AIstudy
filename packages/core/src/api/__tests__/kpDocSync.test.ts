import { describe, expect, it } from "vitest";
import type { KnowledgePoint } from "../../types/appData";
import {
  KP_REGION_BEGIN,
  KP_REGION_END,
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
