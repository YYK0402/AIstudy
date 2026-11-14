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
  it("mappings 项非法 / seq 重复 → 抛错", () => {
    const badItem = `{"nodes": [
      {"id": 0, "parent": null, "name": "a", "variants": []}
    ], "mappings": [42]}`;
    expect(() => parseMergeResponse(badItem, 1, 3)).toThrow(/mappings/);
    const dupSeq = `{"nodes": [
      {"id": 0, "parent": null, "name": "a", "variants": []}
    ], "mappings": [{"seq": 0, "node": 0}, {"seq": 0, "node": 0}]}`;
    expect(() => parseMergeResponse(dupSeq, 1, 3)).toThrow(/seq 重复/);
  });
  it("mappings 不是数组 → 抛错", () => {
    const bad = `{"nodes": [
      {"id": 0, "parent": null, "name": "a", "variants": []}
    ], "mappings": "oops"}`;
    expect(() => parseMergeResponse(bad, 1, 0)).toThrow(/mappings/);
  });
  it("nodes 项非对象 / id 重复 / 负 id → 抛错", () => {
    const notObj = '{"nodes": [42], "mappings": []}';
    expect(() => parseMergeResponse(notObj, 0, 0)).toThrow(/非法项/);
    const dup = `{"nodes": [
      {"id": 0, "parent": null, "name": "a", "variants": []},
      {"id": 0, "parent": null, "name": "b", "variants": []}
    ], "mappings": []}`;
    expect(() => parseMergeResponse(dup, 1, 0)).toThrow(/id/);
    const neg = `{"nodes": [
      {"id": 0, "parent": null, "name": "a", "variants": []},
      {"id": -1, "parent": 0, "name": "b", "variants": []}
    ], "mappings": []}`;
    expect(() => parseMergeResponse(neg, 1, 0)).toThrow(/id/);
  });
  it("nodes 乱序（数组下标 ≠ id）→ 抛错（序不变量）", () => {
    const shuffled = `{"nodes": [
      {"id": 1, "parent": 0, "name": "b", "variants": []},
      {"id": 0, "parent": null, "name": "a", "variants": []}
    ], "mappings": []}`;
    expect(() => parseMergeResponse(shuffled, 2, 0)).toThrow(/升序/);
  });
  it("非 JSON 响应 / 缺 nodes 键 → 抛错", () => {
    expect(() => parseMergeResponse("抱歉，无法完成合并", 2, 3)).toThrow(/JSON/);
    expect(() => parseMergeResponse('{"mappings": []}', 2, 3)).toThrow(/nodes/);
  });
  it("markdown 围栏剥离后正常解析", () => {
    const r = parseMergeResponse("```json\n" + input3 + "\n```", 2, 3);
    expect(r.nodes).toHaveLength(3);
    expect(r.mapping).toHaveLength(3);
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

// ===== mergeCourseToc 编排：processed/failed 归类（假桥 callAi） =====
import { setBridge } from "../../bridge";
import type { StudyBridge } from "../../bridge/types";
import type { AppData, Material } from "../../types/appData";
import { createEmptyData } from "../../types/appData";
import { mergeCourseToc } from "../tocMerge";

function matBase(id: number, name: string): Material {
  return {
    id, courseId: 1, name, fileType: "txt", assetPath: "",
    contentText: "第一章\n正文\n1.1\n正文2",
    headings: "[]", siyuanDocId: null, status: "parsed", createTime: "2026-01-01T00:00:00Z",
    outline: JSON.stringify([{ text: "第一章", level: 1 }, { text: "1.1", level: 2 }]),
    outlineStatus: "done",
  };
}

describe("mergeCourseToc processed/failed 归类", () => {
  it("成功资料进 processed；失败资料进 failed 且不进 processed", async () => {
    const dataRef: { data: AppData } = {
      data: {
        ...createEmptyData(),
        courses: [
          { id: 1, siyuanDocId: null, name: "C", description: "", target: "", totalCycle: "", status: "active", createTime: "t", modelId: null },
        ],
        chapters: [
          { id: 1, courseId: 1, parentId: null, siyuanBlockId: null, name: "第一章", level: 1, sort: 1 },
        ],
        materials: [matBase(10, "教材A"), matBase(11, "教材B")],
        providers: [
          { id: 1, name: "P", baseUrl: "http://x", apiKey: "k", timeout: 30000, enabled: true, createTime: "t" },
        ],
        models: [
          { id: 1, providerId: 1, modelId: "m1", displayName: "M", maxContext: null },
        ],
        taskModels: [
          { taskKey: "merge_toc", modelId: 1, isGlobalDefault: false },
        ],
      },
    };
    const valid = `{"nodes": [
      {"id": 0, "parent": null, "name": "第一章", "variants": []},
      {"id": 1, "parent": 0, "name": "1.1", "variants": []}
    ], "mappings": [{"seq": 0, "node": 0}, {"seq": 1, "node": 1}]}`;
    let call = 0;
    setBridge({
      getData: async () => dataRef.data,
      saveData: async (d: AppData) => {
        dataRef.data = d;
        return { code: 0 };
      },
      callAi: async () => {
        call++;
        if (call === 1) return { content: valid, tokenIn: 0, tokenOut: 0 };
        throw new Error("HTTP 418 teapot");
      },
    } as unknown as StudyBridge);
    const res = await mergeCourseToc(1);
    expect(res.processed).toEqual([10]);
    expect(res.failed).toHaveLength(1);
    expect(res.failed[0].materialName).toBe("教材B");
  });
});


describe("mergeCourseToc 体积护栏（M5）", () => {
  it("章节树过大：不调 AI，fail-loud 报「章节树过大」", async () => {
    const dataRef: { data: AppData } = {
      data: {
        ...createEmptyData(),
        courses: [
          { id: 1, siyuanDocId: null, name: "C", description: "", target: "", totalCycle: "", status: "active", createTime: "t", modelId: null },
        ],
        chapters: Array.from({ length: 1600 }, (_, i) => ({
          id: i + 1, courseId: 1, parentId: null, siyuanBlockId: null,
          name: `第${i}章 这是一个比较长的章节标题`, level: 1, sort: i,
        })),
        materials: [matBase(10, "教材A")],
        providers: [
          { id: 1, name: "P", baseUrl: "http://x", apiKey: "k", timeout: 30000, enabled: true, createTime: "t" },
        ],
        models: [
          { id: 1, providerId: 1, modelId: "m1", displayName: "M", maxContext: null },
        ],
        taskModels: [
          { taskKey: "merge_toc", modelId: 1, isGlobalDefault: false },
        ],
      },
    };
    let called = 0;
    setBridge({
      getData: async () => dataRef.data,
      saveData: async (d: AppData) => {
        dataRef.data = d;
        return { code: 0 };
      },
      callAi: async () => {
        called++;
        return { content: "[]", tokenIn: 0, tokenOut: 0 };
      },
    } as unknown as StudyBridge);
    const res = await mergeCourseToc(1);
    expect(called).toBe(0);
    expect(res.processed).toEqual([]);
    expect(res.failed).toHaveLength(1);
    expect(res.failed[0].reason).toMatch(/章节树过大/);
  });
});
