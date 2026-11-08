import { describe, expect, it } from "vitest";
import type { Chapter } from "../../api";
import {
  alignOutlineSpans, buildChapterTree, buildChapterTreeFlat, buildOutlineTree,
  chapterPathText, isDescendant, nearestDocAncestorId, nodePathOf,
} from "../outline";

const text = [
  "前言若干字",
  "",
  "第1章 极限与连续",
  "",
  "1.1 函数的极限",
  "正文甲",
  "",
  "1.2 极限的运算",
  "正文乙",
  "",
  "第2章 导数",
  "正文丙",
].join("\n");

const nodes = [
  { text: "第1章 极限与连续", level: 1 },
  { text: "1.1 函数的极限", level: 2 },
  { text: "1.2 极限的运算", level: 2 },
  { text: "第2章 导数", level: 1 },
  { text: "不存在的标题", level: 2 },
];

describe("alignOutlineSpans", () => {
  it("按序定位标题行并切出各自范围", () => {
    const { spans, unlocated } = alignOutlineSpans(text, nodes);
    expect(unlocated).toEqual([4]);
    const s = (seq: number) => spans[seq];
    expect(s(0).start).toBe(text.indexOf("第1章 极限与连续"));
    expect(s(1).start).toBe(text.indexOf("1.1 函数的极限"));
    expect(s(1).end).toBe(s(2).start);
    expect(s(3).end).toBe(text.length);
    // 范围文本正确
    expect(text.slice(s(1).start, s(1).end)).toContain("正文甲");
    expect(text.slice(s(1).start, s(1).end)).not.toContain("正文乙");
  });
  it("容忍 markdown 井号与加粗包裹", () => {
    const t2 = "# 第1章 极限与连续\n正文\n**1.1 函数的极限**\n正文2";
    const { unlocated } = alignOutlineSpans(t2, nodes.slice(0, 2));
    expect(unlocated).toEqual([]);
  });
  it("单调约束：后一个同名标题必须在前一个标题之后找（不回溯）", () => {
    const t3 = "第1章\n甲内容\n第2章\n乙内容\n第1章\n丙内容";
    const { spans, unlocated } = alignOutlineSpans(t3, [
      { text: "第1章", level: 1 },
      { text: "第2章", level: 1 },
      { text: "第1章", level: 1 },
    ]);
    expect(unlocated).toEqual([]);
    // 第三个「第1章」取最后一处出现（cursor 已越过前两个标题）
    expect(t3.slice(spans[2].start, spans[2].end)).toContain("丙内容");
    expect(spans[0].start).toBe(0);
  });
});

describe("buildOutlineTree", () => {
  it("按 level 嵌套（level 回跳弹栈）", () => {
    const tree = buildOutlineTree([
      { text: "A", level: 1 }, { text: "B", level: 2 }, { text: "C", level: 3 },
      { text: "D", level: 2 }, { text: "E", level: 1 },
    ]);
    expect(tree.map((n) => n.text)).toEqual(["A", "E"]);
    expect(tree[0].children.map((n) => n.text)).toEqual(["B", "D"]);
    expect(tree[0].children[0].children.map((n) => n.text)).toEqual(["C"]);
  });
  it("首个节点 level>1 也作根", () => {
    const tree = buildOutlineTree([{ text: "X", level: 3 }]);
    expect(tree).toHaveLength(1);
    expect(tree[0].level).toBe(3);
  });
});

describe("nodePathOf", () => {
  it("祖先路径用 > 连接", () => {
    const ns = [{ text: "A", level: 1 }, { text: "B", level: 2 }, { text: "C", level: 3 }];
    expect(nodePathOf(ns, 2)).toBe("A>B>C");
    expect(nodePathOf(ns, 0)).toBe("A");
  });
});

function ch(id: number, parentId: number | null, level: number, sort: number, name = `n${id}`): Chapter {
  return { id, courseId: 1, parentId, siyuanBlockId: null, name, level, sort };
}

describe("buildChapterTree", () => {
  it("按 sort 递归，孤儿提升顶层", () => {
    const tree = buildChapterTree([
      ch(1, null, 1, 2), ch(2, null, 1, 1), ch(3, 2, 2, 2), ch(4, 2, 2, 1), ch(9, 99, 3, 1),
    ], 1);
    expect(tree.map((n) => n.chapter.id)).toEqual([2, 1, 9]);
    expect(tree[0].children.map((n) => n.chapter.id)).toEqual([4, 3]);
  });
});

describe("buildChapterTreeFlat", () => {
  it("与 buildChapterTree 同课程数据结果一致（仅去 courseId 过滤）", () => {
    const sameCourse = [
      ch(1, null, 1, 2), ch(2, null, 1, 1), ch(3, 2, 2, 2), ch(4, 2, 2, 1), ch(9, 99, 3, 1),
    ];
    expect(buildChapterTreeFlat(sameCourse)).toEqual(buildChapterTree(sameCourse, 1));
  });

  it("含多课程数据：不过滤 courseId，全部节点建树", () => {
    const otherCourse = (c: Chapter): Chapter => ({ ...c, courseId: 2 });
    const mixed = [
      ch(1, null, 1, 1),
      ch(2, 1, 2, 1),
      otherCourse(ch(3, null, 1, 1)),
      otherCourse(ch(4, 3, 2, 1)),
    ];
    const tree = buildChapterTreeFlat(mixed);
    expect(tree.map((n) => n.chapter.id)).toEqual([1, 3]);
    expect(tree[0].children.map((n) => n.chapter.id)).toEqual([2]);
    expect(tree[1].children.map((n) => n.chapter.id)).toEqual([4]);
  });

  it("孤儿 parentId 指向已删节点时提升顶层防丢失", () => {
    const tree = buildChapterTreeFlat([
      ch(1, null, 1, 1),
      ch(9, 99, 3, 1), // 孤儿：99 不存在
    ]);
    expect(tree.map((n) => n.chapter.id)).toEqual([1, 9]);
  });
});

describe("nearestDocAncestorId / chapterPathText / isDescendant", () => {
  const chapters = [ch(1, null, 1, 1), ch(2, 1, 2, 1), ch(3, 2, 3, 1), ch(4, 3, 4, 1)];
  it("level<=2 返回自身，更深取最近有文档祖先", () => {
    expect(nearestDocAncestorId(chapters, 1)).toBe(1);
    expect(nearestDocAncestorId(chapters, 2)).toBe(2);
    expect(nearestDocAncestorId(chapters, 3)).toBe(2);
    expect(nearestDocAncestorId(chapters, 4)).toBe(2);
  });
  it("chapterPathText 自根到自身", () => {
    expect(chapterPathText(chapters, 3)).toBe("n1>n2>n3");
  });
  it("isDescendant 链上判定", () => {
    expect(isDescendant(chapters, 1, 4)).toBe(true);
    expect(isDescendant(chapters, 4, 1)).toBe(false);
    expect(isDescendant(chapters, 2, 2)).toBe(false);
  });
});
