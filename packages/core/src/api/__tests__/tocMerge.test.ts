import { describe, expect, it } from "vitest";
import type { Chapter } from "../../api";
import { parseMergeResponse, seedNodesFromChapters, splitOutlineForMerge } from "../tocMerge";
import type { OutlineNode } from "../../utils/outline";

function ch(id: number, parentId: number | null, level: number, sort: number, name = `n${id}`): Chapter {
  return { id, courseId: 1, parentId, siyuanBlockId: null, name, level, sort };
}

describe("seedNodesFromChapters", () => {
  it("既有章节树 → MergeNode（id 重排为下标，chapterId 保留原 id）", () => {
    const nodes = seedNodesFromChapters([ch(11, null, 1, 1, "第一章"), ch(12, 11, 2, 1, "1.1")], 1);
    expect(nodes).toEqual([
      { id: 0, parent: null, name: "第一章", variants: [], chapterId: 11 },
      { id: 1, parent: 0, name: "1.1", variants: [], chapterId: 12 },
    ]);
  });
  it("空课程返回空数组", () => {
    expect(seedNodesFromChapters([], 1)).toEqual([]);
  });
});

const input3 = `{"nodes": [
  {"id": 0, "parent": null, "name": "第一章", "variants": []},
  {"id": 1, "parent": 0, "name": "1.1", "variants": []},
  {"id": 2, "parent": 0, "name": "1.2", "variants": ["1.2 运算"]}
], "mappings": [{"seq": 0, "node": 0}, {"seq": 1, "node": 1}, {"seq": 2, "node": 2}]}`;

describe("parseMergeResponse", () => {
  it("合法输出原样解析", () => {
    const r = parseMergeResponse(input3, 2, 3);
    expect(r.nodes).toHaveLength(3);
    expect(r.nodes[2].variants).toEqual(["1.2 运算"]);
    expect(r.mapping).toHaveLength(3);
  });
  it("丢失输入节点 → 抛错", () => {
    const bad = '{"nodes": [{"id": 0, "parent": null, "name": "第一章", "variants": []}], "mappings": []}';
    expect(() => parseMergeResponse(bad, 2, 3)).toThrow(/节点/);
  });
  it("新增节点 id 必须 ≥ 输入数且连续", () => {
    const ok = `{"nodes": [
      {"id": 0, "parent": null, "name": "a", "variants": []},
      {"id": 1, "parent": 0, "name": "b", "variants": []},
      {"id": 2, "parent": null, "name": "新章", "variants": []}
    ], "mappings": []}`;
    expect(parseMergeResponse(ok, 2, 1).nodes).toHaveLength(3);
    const gap = `{"nodes": [
      {"id": 0, "parent": null, "name": "a", "variants": []},
      {"id": 1, "parent": 0, "name": "b", "variants": []},
      {"id": 5, "parent": null, "name": "新章", "variants": []}
    ], "mappings": []}`;
    expect(() => parseMergeResponse(gap, 2, 1)).toThrow(/id/);
  });
  it("parent 悬空 / 成环 / 空名 → 抛错", () => {
    const dangling = `{"nodes": [
      {"id": 0, "parent": null, "name": "a", "variants": []},
      {"id": 1, "parent": 9, "name": "b", "variants": []}
    ], "mappings": []}`;
    expect(() => parseMergeResponse(dangling, 2, 1)).toThrow(/parent/);
    const cycle = `{"nodes": [
      {"id": 0, "parent": 1, "name": "a", "variants": []},
      {"id": 1, "parent": 0, "name": "b", "variants": []}
    ], "mappings": []}`;
    expect(() => parseMergeResponse(cycle, 2, 1)).toThrow(/环/);
    const emptyName = `{"nodes": [
      {"id": 0, "parent": null, "name": "  ", "variants": []}
    ], "mappings": []}`;
    expect(() => parseMergeResponse(emptyName, 1, 1)).toThrow(/name/);
  });
  it("mappings 越界 → 抛错；合法省略（无法归属）允许", () => {
    const out = `{"nodes": [
      {"id": 0, "parent": null, "name": "a", "variants": []}
    ], "mappings": [{"seq": 5, "node": 0}]}`;
    expect(() => parseMergeResponse(out, 1, 3)).toThrow(/seq/);
    const omit = `{"nodes": [
      {"id": 0, "parent": null, "name": "a", "variants": []}
    ], "mappings": []}`;
    expect(parseMergeResponse(omit, 1, 3).mapping).toEqual([]);
  });
});

describe("splitOutlineForMerge", () => {
  it("≤150 节点单片", () => {
    const outline: OutlineNode[] = Array.from({ length: 150 }, (_, i) => ({ text: `t${i}`, level: (i % 3) + 1 }));
    expect(splitOutlineForMerge(outline)).toEqual([{ start: 0, nodes: outline }]);
  });
  it(">150 按顶层边界拆成 ≤150 的连续片", () => {
    const outline: OutlineNode[] = [];
    for (let c = 0; c < 3; c++) {
      outline.push({ text: `章${c}`, level: 1 });
      for (let s = 0; s < 80; s++) outline.push({ text: `${c}.${s}`, level: 2 });
    }
    const parts = splitOutlineForMerge(outline);
    expect(parts.length).toBeGreaterThanOrEqual(2);
    for (const p of parts) expect(p.nodes.length).toBeLessThanOrEqual(150);
    // 连续性：片间无缝无交
    let cursor = 0;
    for (const p of parts) {
      expect(p.start).toBe(cursor);
      cursor += p.nodes.length;
    }
    expect(cursor).toBe(outline.length);
  });
});
