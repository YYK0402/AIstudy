// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import ChapterTreeRow from "../ChapterTreeRow.vue";
import { chapterTreeCtxKey, type ChapterTreeCtx } from "../chapterTreeCtx";
import type { NestedChapter } from "../../utils/outline";
import type { Chapter } from "../../api";

function ch(id: number, parentId: number | null, level: number, sort: number, name: string): Chapter {
  return { id, courseId: 1, parentId, siyuanBlockId: null, name, level, sort };
}

function node(c: Chapter, children: NestedChapter[] = []): NestedChapter {
  return { chapter: c, children };
}

function makeCtx(over: Partial<ChapterTreeCtx> = {}): ChapterTreeCtx {
  return {
    isArchived: () => false,
    isBatchMode: () => false,
    isSelected: () => false,
    isBatchChecked: () => false,
    isExpanded: () => true,
    isRowMenuOpen: () => false,
    dropPos: () => null,
    draggingId: () => null,
    toggleExpand: () => {},
    toggleSelect: () => {},
    closeRowMenu: () => {},
    kpCountOf: () => 0,
    addChapterChild: () => {},
    openReview: () => {},
    editChapter: () => {},
    delChapter: () => {},
    onRowDragLeave: () => {},
    onDragEnd: () => {},
    ...over,
  };
}

function mountRow(node: NestedChapter, over: Partial<ChapterTreeCtx> = {}) {
  return mount(ChapterTreeRow, {
    props: { node, depth: 0 },
    global: { provide: { [chapterTreeCtxKey]: makeCtx(over) } },
  });
}

const TREE = node(ch(1, null, 1, 1, "第一章"), [
  node(ch(2, 1, 2, 1, "1.1"), [node(ch(3, 2, 3, 1, "1.1.1"))]),
]);

describe("ChapterTreeRow", () => {
  it("递归渲染任意深度，tag 按 depth 区分（章/节/小节）", () => {
    const w = mountRow(TREE);
    const rows = w.findAll(".tree-node > .row");
    expect(rows.length).toBe(3);
    expect(rows[0].attributes("data-depth")).toBe("0");
    expect(rows[1].attributes("data-depth")).toBe("1");
    expect(rows[2].attributes("data-depth")).toBe("2");
    const tags = w.findAll(".tp-tag");
    expect(tags.map((t) => t.text())).toEqual(["章", "节", "小节"]);
    expect(tags.map((t) => t.classes())).toEqual([
      expect.arrayContaining(["chapter"]),
      expect.arrayContaining(["unit"]),
      expect.arrayContaining(["sub"]),
    ]);
  });

  it("点击行 emit click（携带节点）；⋯ emit menu", async () => {
    const w = mountRow(TREE);
    await w.findAll(".tree-node > .row")[1].trigger("click");
    expect(w.emitted("click")?.[0]?.[0]).toMatchObject({ chapter: { id: 2 } });
    await w.findAll(".row-more-btn")[0].trigger("click");
    expect(w.emitted("menu")?.[0]?.[0]).toMatchObject({ chapter: { id: 1 } });
  });

  it("拖拽柄 dragstart emit id；行内三区间按 Y 比例算 pos 并 emit dragover", async () => {
    const w = mountRow(TREE);
    await w.find(".drag-handle").trigger("dragstart");
    expect(w.emitted("dragstart")?.[0]).toEqual([1]);
    // jsdom 无布局：mock 行矩形（高 34px）→ top=before / 中=inside / bottom=after
    const row = w.find(".tree-node > .row");
    vi.spyOn(row.element, "getBoundingClientRect").mockReturnValue({
      top: 0, left: 0, right: 300, bottom: 34, width: 300, height: 34, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    await row.trigger("dragover", { clientY: 0 });
    expect(w.emitted("dragover")?.[0]?.slice(1)).toEqual(["before"]);
    await row.trigger("dragover", { clientY: 17 });
    expect(w.emitted("dragover")?.[1]?.slice(1)).toEqual(["inside"]);
    await row.trigger("dragover", { clientY: 34 });
    expect(w.emitted("dragover")?.[2]?.slice(1)).toEqual(["after"]);
  });

  it("落点高亮：ctx.dropPos 命中时行带 drop-<pos> 类与 data-pos", () => {
    const w = mountRow(TREE, { dropPos: (id) => (id === 2 ? "inside" : null) });
    const rows = w.findAll(".tree-node > .row");
    expect(rows[0].classes()).not.toContain("drop-inside");
    expect(rows[1].classes()).toContain("drop-inside");
    expect(rows[1].attributes("data-pos")).toBe("inside");
    expect(rows[0].attributes("data-pos")).toBeUndefined();
  });

  it("归档/批量模式下隐藏拖拽柄与操作按钮", () => {
    expect(mountRow(TREE).find(".drag-handle").exists()).toBe(true);
    expect(mountRow(TREE, { isBatchMode: () => true }).find(".drag-handle").exists()).toBe(false);
    expect(mountRow(TREE, { isArchived: () => true }).find(".drag-handle").exists()).toBe(false);
    // 批量模式显示勾选框
    expect(mountRow(TREE, { isBatchMode: () => true }).findAll(".tp-check").length).toBe(3);
  });
});
