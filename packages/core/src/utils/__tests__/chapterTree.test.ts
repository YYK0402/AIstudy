import { describe, expect, it } from "vitest";
import type { Chapter } from "../../api";
import { computeChapterMove } from "../chapterMove";

function ch(id: number, parentId: number | null, level: number, sort: number, name = `n${id}`): Chapter {
  return { id, courseId: 1, parentId, siyuanBlockId: null, name, level, sort };
}

// 两级回归基准：顶层 1/2/3，1 下 11/12，2 下 21
const BASE = [
  ch(1, null, 1, 1), ch(2, null, 1, 2), ch(3, null, 1, 3),
  ch(11, 1, 2, 1), ch(12, 1, 2, 2), ch(21, 2, 2, 1),
];

describe("computeChapterMove（N 级）", () => {
  it("非法：拖自身 / 不存在的 id → null", () => {
    expect(computeChapterMove(BASE, 1, 1, "after")).toBeNull();
    expect(computeChapterMove(BASE, 99, 1, "after")).toBeNull();
    expect(computeChapterMove(BASE, 1, 99, "after")).toBeNull();
  });

  it("顶层 before/after：顶层换序并重排 sort", () => {
    const after = computeChapterMove(BASE, 3, 1, "after")!;
    const tops = after.filter((c) => c.parentId === null).sort((a, b) => a.sort - b.sort);
    expect(tops.map((c) => c.id)).toEqual([1, 3, 2]);
    expect(tops.map((c) => c.sort)).toEqual([1, 2, 3]);

    const before = computeChapterMove(BASE, 3, 2, "before")!;
    const tops2 = before.filter((c) => c.parentId === null).sort((a, b) => a.sort - b.sort);
    expect(tops2.map((c) => c.id)).toEqual([1, 3, 2]);
  });

  it("inside：挂为目标节点直接子节点并追加末尾", () => {
    const out = computeChapterMove(BASE, 21, 1, "inside")!;
    const under1 = out.filter((c) => c.parentId === 1).sort((a, b) => a.sort - b.sort);
    expect(under1.map((c) => c.id)).toEqual([11, 12, 21]);
    // 旧父级 2 下无剩余子节点
    expect(out.filter((c) => c.parentId === 2)).toHaveLength(0);
  });

  it("同级 before/after：插入并重排", () => {
    const out = computeChapterMove(BASE, 21, 12, "before")!;
    const under1 = out.filter((c) => c.parentId === 1).sort((a, b) => a.sort - b.sort);
    expect(under1.map((c) => c.id)).toEqual([11, 21, 12]);
    expect(under1.map((c) => c.sort)).toEqual([1, 2, 3]);
  });

  it("跨父移动：新父级与旧父级各自重排", () => {
    const base = [...BASE, ch(13, 1, 2, 3), ch(22, 2, 2, 2)];
    const out = computeChapterMove(base, 21, 13, "after")!;
    const under1 = out.filter((c) => c.parentId === 1).sort((a, b) => a.sort - b.sort);
    const under2 = out.filter((c) => c.parentId === 2).sort((a, b) => a.sort - b.sort);
    expect(under1.map((c) => c.id)).toEqual([11, 12, 13, 21]);
    expect(under1.map((c) => c.sort)).toEqual([1, 2, 3, 4]);
    expect(under2.map((c) => c.id)).toEqual([22]);
    expect(under2[0].sort).toBe(1);
  });

  it("N 级：小节可挂到任意深度节点下", () => {
    const all = [
      ch(1, null, 1, 1, "第一章"), ch(2, 1, 2, 1, "1.1"), ch(3, 2, 3, 1, "1.1.1"), ch(4, null, 1, 2, "第二章"),
    ];
    const next = computeChapterMove(all, 4, 3, "inside")!;
    const moved = next.find((c) => c.id === 4)!;
    expect(moved.parentId).toBe(3);
  });

  it("N 级：跨父同级插入（before/after 按 target 父级列表）", () => {
    const all = [
      ch(1, null, 1, 1, "第一章"), ch(2, 1, 2, 1, "1.1"), ch(3, 1, 2, 2, "1.2"), ch(4, null, 1, 2, "第二章"), ch(5, 4, 2, 1, "2.1"),
    ];
    // 把 5（2.1）拖到 2（1.1）之后 → 父变 1，sort 介于 2 与 3 间
    const next = computeChapterMove(all, 5, 2, "after")!;
    const m = next.find((c) => c.id === 5)!;
    expect(m.parentId).toBe(1);
    const siblings = next.filter((c) => c.parentId === 1).sort((a, b) => a.sort - b.sort);
    expect(siblings.map((c) => c.id)).toEqual([2, 5, 3]);
  });

  it("N 级：顶层节点可插到子级节点行的上/下沿（跨父）", () => {
    // 把顶层 2 拖到 11（1 的子级）之后 → 父变 1
    const out = computeChapterMove(BASE, 2, 11, "after")!;
    const m = out.find((c) => c.id === 2)!;
    expect(m.parentId).toBe(1);
    const under1 = out.filter((c) => c.parentId === 1).sort((a, b) => a.sort - b.sort);
    expect(under1.map((c) => c.id)).toEqual([11, 2, 12]);
  });

  it("N 级：子级节点可拖到顶层行的上/下沿（升入顶层）", () => {
    // 把 11（1 的子级）拖到顶层 2 之前 → 父变 null
    const out = computeChapterMove(BASE, 11, 2, "before")!;
    const m = out.find((c) => c.id === 11)!;
    expect(m.parentId).toBeNull();
    const tops = out.filter((c) => c.parentId === null).sort((a, b) => a.sort - b.sort);
    expect(tops.map((c) => c.id)).toEqual([1, 11, 2, 3]);
  });

  it("落点为自身子树返回 null", () => {
    const all = [ch(1, null, 1, 1, "第一章"), ch(2, 1, 2, 1, "1.1")];
    expect(computeChapterMove(all, 1, 2, "inside")).toBeNull();
    expect(computeChapterMove(all, 1, 2, "before")).toBeNull();
    expect(computeChapterMove(all, 1, 2, "after")).toBeNull();
  });

  it("原列表不被修改（返回拷贝）", () => {
    const snapshot = BASE.map((c) => ({ ...c }));
    computeChapterMove(BASE, 3, 1, "after");
    expect(BASE).toEqual(snapshot);
  });
});
