// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mount, type DOMWrapper, type VueWrapper } from "@vue/test-utils";
import KpTreePicker from "../KpTreePicker.vue";
import type { Chapter, KnowledgePoint } from "../../api";

function ch(id: number, parentId: number | null, level: number, sort: number, name: string): Chapter {
  return { id, courseId: 1, parentId, siyuanBlockId: null, name, level, sort };
}

function kp(id: number, chapterId: number, sort: number, name: string): KnowledgePoint {
  return {
    id,
    courseId: 1,
    chapterId,
    blockId: null,
    name,
    content: "",
    mastery: "unlearn",
    sourceAssetIds: "",
    prevKpIds: "",
    chapterName: "",
    sort,
    createTime: "2026-01-01",
  };
}

// L1(100 直属, sort 9) → L2(200, sort 1) → L3(300, sort 2)
const CHAPTERS = [
  ch(1, null, 1, 1, "第一章"),
  ch(2, 1, 2, 1, "1.1 节"),
  ch(3, 2, 3, 1, "1.1.1 小节"),
];
const KPS = [
  kp(100, 1, 9, "章直属"),
  kp(200, 2, 1, "节直接"),
  kp(300, 3, 2, "小节命中"),
];

function mountPicker(props: Record<string, unknown> = {}) {
  return mount(KpTreePicker, { props: { chapters: CHAPTERS, kps: KPS, modelValue: [], ...props } });
}

/** 按行内名称找节点行（章节行与 KP 行名称不重名） */
function rowOf(w: VueWrapper, name: string) {
  const row = w.findAll(".kpsm-row").find((r) => r.find(".nm").text() === name);
  if (!row) throw new Error(`未找到行: ${name}`);
  return row;
}

/** 行 → 其分支包裹（.kpsm-ch 为行的直接父级）→ 该分支的子树容器 */
function childrenContainerOf(row: DOMWrapper<Element>) {
  const branch = row.element.parentElement!;
  return branch.querySelector(":scope > .kpsm-children") as HTMLElement | null;
}

describe("KpTreePicker（N 级）", () => {
  it("L3 行渲染：默认展开 L1 可见 L2；展开 L2 后 L3 子树容器可见", async () => {
    const w = mountPicker();
    const l2row = rowOf(w, "1.1 节");
    // L2 分支在 DOM（v-show 不卸载），但子树容器隐藏（L2 未默认展开）
    let container = childrenContainerOf(l2row);
    expect(container).not.toBeNull();
    expect(container!.style.display).toBe("none");
    // L3 行已渲染（在隐藏容器内）
    expect(rowOf(w, "1.1.1 小节").exists()).toBe(true);
    // 展开 L2 → 容器可见
    await l2row.find(".tgl").trigger("click");
    expect(container!.style.display).not.toBe("none");
    // L3 是叶子：无展开开关
    expect(rowOf(w, "1.1.1 小节").find(".tgl").exists()).toBe(false);
  });

  it("点 L3 行选中其 KP", async () => {
    const w = mountPicker();
    const l2row = rowOf(w, "1.1 节");
    await l2row.find(".tgl").trigger("click");
    await rowOf(w, "1.1.1 小节").find("input").setValue(true);
    expect(w.emitted("update:modelValue")?.[0]).toEqual([[300]]);
  });

  it("点 L1 行选中含 L3 的全部 KP（教材序：L1 直属 → L2 → L3，不受 kp.sort 干扰）", async () => {
    const w = mountPicker();
    await rowOf(w, "第一章").find("input").setValue(true);
    expect(w.emitted("update:modelValue")?.[0]).toEqual([[100, 200, 300]]);
  });

  it("部分选中时祖先行 indeterminate（L3 勾选 → L2/L1 半选）", async () => {
    const w = mountPicker();
    const l2row = rowOf(w, "1.1 节");
    await l2row.find(".tgl").trigger("click");
    await rowOf(w, "1.1.1 小节").find("input").setValue(true);
    await w.setProps({ modelValue: [300] });
    const boxOf = (name: string) => rowOf(w, name).find("input").element as HTMLInputElement;
    expect(boxOf("1.1.1 小节").checked).toBe(true);
    expect(boxOf("1.1.1 小节").indeterminate).toBe(false);
    // L2 聚合 [200,300] 选中 1/2 → 半选
    expect(boxOf("1.1 节").indeterminate).toBe(true);
    // L1 聚合 [100,200,300] 选中 1/3 → 半选
    expect(boxOf("第一章").indeterminate).toBe(true);
  });

  it("节点计数为子树聚合（L1 显示 3、L2 显示 2、L3 显示 1）", () => {
    const w = mountPicker();
    expect(rowOf(w, "第一章").find(".cnt").text()).toBe("3");
    expect(rowOf(w, "1.1 节").find(".cnt").text()).toBe("2");
    expect(rowOf(w, "1.1.1 小节").find(".cnt").text()).toBe("1");
  });

  it("搜索时保留含命中 KP 的分支：L3 分支保留且自动展开，未命中的直属 KP 隐藏", async () => {
    const w = mountPicker();
    await w.find("input[aria-label='搜索知识点']").setValue("小节");
    expect(rowOf(w, "第一章").exists()).toBe(true);
    expect(rowOf(w, "1.1 节").exists()).toBe(true);
    expect(rowOf(w, "1.1.1 小节").exists()).toBe(true);
    expect(w.text()).toContain("小节命中");
    expect(w.text()).not.toContain("章直属");
    expect(w.text()).not.toContain("节直接");
    // 搜索态 L2 子树容器自动展开
    const container = childrenContainerOf(rowOf(w, "1.1 节"));
    expect(container!.style.display).not.toBe("none");
  });

  it("搜索无命中时显示空态", async () => {
    const w = mountPicker();
    await w.find("input[aria-label='搜索知识点']").setValue("不存在的词");
    expect(w.find(".kpsm-empty").exists()).toBe(true);
    expect(w.text()).not.toContain("第一章");
  });
});
