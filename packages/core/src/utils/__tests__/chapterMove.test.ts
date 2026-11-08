import { describe, expect, it } from "vitest";
import type { Chapter } from "../../types/appData";
import { computeChapterMove } from "../chapterMove";

function ch(id: number, sort: number): Chapter {
  return { id, courseId: 1, parentId: null, siyuanBlockId: null, name: `章${id}`, level: 1, sort };
}

function un(id: number, parentId: number, sort: number): Chapter {
  return { id, courseId: 1, parentId, siyuanBlockId: null, name: `节${id}`, level: 2, sort };
}

const BASE = [ch(1, 1), ch(2, 2), ch(3, 3), un(11, 1, 1), un(12, 1, 2), un(21, 2, 1)];

describe("computeChapterMove", () => {
  it("非法：拖自身 / 不存在的 id → null", () => {
    expect(computeChapterMove(BASE, 1, 1, "after")).toBeNull();
    expect(computeChapterMove(BASE, 99, 1, "after")).toBeNull();
    expect(computeChapterMove(BASE, 1, 99, "after")).toBeNull();
  });

  it("章节 before/after：顶层换序并重排 sort", () => {
    const after = computeChapterMove(BASE, 3, 1, "after")!;
    const tops = after.filter((c) => c.level === 1).sort((a, b) => a.sort - b.sort);
    expect(tops.map((c) => c.id)).toEqual([1, 3, 2]);
    expect(tops.map((c) => c.sort)).toEqual([1, 2, 3]);

    const before = computeChapterMove(BASE, 3, 2, "before")!;
    const tops2 = before.filter((c) => c.level === 1).sort((a, b) => a.sort - b.sort);
    expect(tops2.map((c) => c.id)).toEqual([1, 3, 2]);
  });

  it("章节放在小节行上/下沿：非法 → null", () => {
    expect(computeChapterMove(BASE, 3, 11, "before")).toBeNull();
    expect(computeChapterMove(BASE, 3, 11, "after")).toBeNull();
  });

  it("小节放在章节行上/下沿：非法 → null", () => {
    expect(computeChapterMove(BASE, 11, 3, "before")).toBeNull();
    expect(computeChapterMove(BASE, 11, 3, "after")).toBeNull();
  });

  it("小节 inside 章节：追加到该章末尾", () => {
    const out = computeChapterMove(BASE, 21, 1, "inside")!;
    const under1 = out.filter((c) => c.parentId === 1 && c.level === 2).sort((a, b) => a.sort - b.sort);
    expect(under1.map((c) => c.id)).toEqual([11, 12, 21]);
    // 旧父级 2 下无小节，空
    expect(out.filter((c) => c.parentId === 2 && c.level === 2)).toHaveLength(0);
  });

  it("小节 before/after 小节：同章插入并重排", () => {
    const out = computeChapterMove(BASE, 21, 12, "before")!;
    const under1 = out.filter((c) => c.parentId === 1 && c.level === 2).sort((a, b) => a.sort - b.sort);
    expect(under1.map((c) => c.id)).toEqual([11, 21, 12]);
    expect(under1.map((c) => c.sort)).toEqual([1, 2, 3]);
  });

  it("跨章移动：新父级与旧父级各自重排", () => {
    const base = [...BASE, un(13, 1, 3), un(22, 2, 2)];
    const out = computeChapterMove(base, 21, 13, "after")!;
    const under1 = out.filter((c) => c.parentId === 1 && c.level === 2).sort((a, b) => a.sort - b.sort);
    const under2 = out.filter((c) => c.parentId === 2 && c.level === 2).sort((a, b) => a.sort - b.sort);
    expect(under1.map((c) => c.id)).toEqual([11, 12, 13, 21]);
    expect(under1.map((c) => c.sort)).toEqual([1, 2, 3, 4]);
    expect(under2.map((c) => c.id)).toEqual([22]);
    expect(under2[0].sort).toBe(1);
  });

  it("原列表不被修改（返回拷贝）", () => {
    const snapshot = BASE.map((c) => ({ ...c }));
    computeChapterMove(BASE, 3, 1, "after");
    expect(BASE).toEqual(snapshot);
  });
});
