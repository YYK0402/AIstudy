// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import MasteryTreeNode from "../MasteryTreeNode.vue";
import type { MasteryDist, MasteryTreeChapter } from "../../utils/masteryTree";
import type { Mastery } from "../../types/appData";

function dist(unlearn = 0, known = 0, mastered = 0, proficient = 0): MasteryDist {
  return { unlearn, known, mastered, proficient };
}

function node(id: number, name: string, d: MasteryDist, level: Mastery, children: MasteryTreeChapter[] = []): MasteryTreeChapter {
  return {
    id,
    name,
    dist: d,
    total: d.unlearn + d.known + d.mastered + d.proficient,
    mastered: d.mastered + d.proficient,
    level,
    kps: [],
    children,
  };
}

/** L1（直属 1 mastered + 后代 3）→ L2（直属 1 proficient + L3 两个）→ L3（1 known + 1 unlearn） */
function makeTree(): MasteryTreeChapter {
  const l3 = node(3, "小节三", dist(1, 1), "unlearn");
  const l2 = node(2, "第二节", dist(1, 1, 0, 1), "unlearn", [l3]);
  return node(1, "第一章", dist(1, 1, 1, 1), "known", [l2]);
}

describe("MasteryTreeNode", () => {
  it("递归渲染 L1→L3 三层，L3 行嵌套两层 .mtree-children", () => {
    const w = mount(MasteryTreeNode, { props: { node: makeTree(), depth: 1 } });
    expect(w.findAll(".mtree-node")).toHaveLength(3);
    // 文档序：L1 → L2 → L3
    expect(w.findAll(".mtree-name").map((n) => n.text())).toEqual(["第一章", "第二节", "小节三"]);
    expect(w.find(".mtree-children .mtree-node .mtree-name").text()).toBe("第二节");
    expect(w.find(".mtree-children .mtree-children .mtree-node .mtree-name").text()).toBe("小节三");
  });

  it("计数透传：进度文本 = 各层直属 + 后代聚合", () => {
    const w = mount(MasteryTreeNode, { props: { node: makeTree(), depth: 1 } });
    expect(w.findAll(".mtree-progress").map((n) => n.text())).toEqual(["2/4", "1/3", "0/2"]);
  });

  it("分布条分段宽度按节点占比（L1 精通档 1/4 = 25%）", () => {
    const w = mount(MasteryTreeNode, { props: { node: makeTree(), depth: 1 } });
    expect(w.find(".mtree-bar i.proficient").attributes("style")).toContain("width: 25%");
    // 每节点 4 档
    expect(w.findAll(".mtree-bar i")).toHaveLength(12);
  });

  it("行结构随深度：depth1 带等级 tag，depth≥2 加 .sm，depth≥3 加 .lv-deep", () => {
    const w = mount(MasteryTreeNode, { props: { node: makeTree(), depth: 1 } });
    const [l1, l2, l3] = w.findAll(".mtree-node");
    expect(l1.classes()).toContain("lv-known");
    expect(l1.classes()).not.toContain("sm");
    expect(l1.find(".tag").text()).toBe("了解");
    expect(l2.classes()).toContain("sm");
    expect(l2.find(".tag").exists()).toBe(false);
    expect(l3.classes()).toContain("lv-deep");
    expect(w.findAll(".mtree-node.lv-deep")).toHaveLength(1);
  });

  it("children 空数组终止递归：不渲染 .mtree-children", () => {
    const leaf = mount(MasteryTreeNode, { props: { node: node(1, "叶子", dist(1), "unlearn"), depth: 3 } });
    expect(leaf.find(".mtree-children").exists()).toBe(false);
    expect(leaf.findAll(".mtree-node")).toHaveLength(1);
  });
});
