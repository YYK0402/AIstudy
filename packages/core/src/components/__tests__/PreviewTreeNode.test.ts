// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import PreviewTreeNode from "../PreviewTreeNode.vue";

const root = {
  id: 0, name: "第一章", variants: ["第一章 极限"], from: ["教材A", "教材B"],
  unlocated: false, chapterId: null,
  children: [
    { id: 1, name: "1.1 节", variants: [], from: ["教材A"], unlocated: true, chapterId: null, children: [] },
  ],
};

describe("PreviewTreeNode", () => {
  it("递归渲染节点与缩进层级", async () => {
    const w = mount(PreviewTreeNode, { props: { node: root, depth: 0 } });
    expect(w.findAll(".tp-node-row").length).toBe(2);
    expect(w.find(".tp-node-row").attributes("data-depth")).toBe("0");
    expect(w.findAll(".tp-node-row")[1].attributes("data-depth")).toBe("1");
  });
  it("展示 variants（等 N 种写法折叠）与来源徽章与未定位警告", async () => {
    const w = mount(PreviewTreeNode, { props: { node: root, depth: 0 } });
    expect(w.text()).toContain("第一章 极限");
    expect(w.find(".tp-from").text()).toContain("教材A");
    // 根行自身无警告（brief 原句 `w.find(".tp-warn")` 会搜到子行警告，find 与 findAll 同查询源必矛盾；收窄到根行保留原意）
    expect(w.find(".tp-node-row").find(".tp-warn").exists()).toBe(false); // 根行无警告
    expect(w.findAll(".tp-warn").length).toBe(1); // 子节点有
  });
  it("添加子节点事件带父 id", async () => {
    const w = mount(PreviewTreeNode, { props: { node: root, depth: 0 } });
    await w.find("[data-act='add']").trigger("click");
    expect(w.emitted("add")?.[0]).toEqual([0]);
  });
  it("删除子树事件", async () => {
    const w = mount(PreviewTreeNode, { props: { node: root, depth: 0 } });
    await w.findAll("[data-act='remove']")[1].trigger("click");
    expect(w.emitted("remove")?.[0]).toEqual([1]);
  });
});
