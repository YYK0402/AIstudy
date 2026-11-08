// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import KpTreeChangePreview from "../KpTreeChangePreview.vue";
import type { ChapterDiffAdd, KpTreeDiff } from "../../utils/kpTreeImport";

const emptyDiff: KpTreeDiff = {
  updated: [],
  added: [],
  removed: [],
  unchangedKps: 0,
  chaptersUpdated: [],
  chaptersAdded: [],
  chaptersRemoved: [],
};

const chKeyNames = new Map([
  ["new:0", "顶章A"],
  ["new:1", "节B"],
  ["new:2", "小节C"],
]);

function added(over: Partial<ChapterDiffAdd> & Pick<ChapterDiffAdd, "key" | "name" | "level">): ChapterDiffAdd {
  return { parentKey: null, sort: 1, ...over };
}

function mountPreview(chaptersAdded: ChapterDiffAdd[]) {
  return mount(KpTreeChangePreview, {
    props: {
      diff: { ...emptyDiff, chaptersAdded },
      kpOldName: new Map(),
      chOldName: new Map(),
      chKeyNames,
    },
  });
}

describe("KpTreeChangePreview 新增章节文案按深度", () => {
  it("L1=新增顶章 / L2=新增小节（父名）/ L3+=新增深层节点（父名）", () => {
    const w = mountPreview([
      added({ key: "new:0", name: "顶章A", level: 1 }),
      added({ key: "new:1", name: "节B", level: 2, parentKey: "new:0" }),
      added({ key: "new:2", name: "小节C", level: 3, parentKey: "new:1" }),
      added({ key: "new:3", name: "子小节D", level: 4, parentKey: "new:2" }),
    ]);
    const badges = w.findAll(".diff-badge").map((b) => b.text());
    expect(badges).toEqual([
      "新增顶章",
      "新增小节（顶章A）",
      "新增深层节点（节B）",
      "新增深层节点（小节C）",
    ]);
  });

  it("L2 新增在顶章下仍显示父名（存量措辞不变）", () => {
    const w = mountPreview([added({ key: "new:1", name: "节B", level: 2, parentKey: "new:0" })]);
    expect(w.find(".diff-badge").text()).toBe("新增小节（顶章A）");
  });
});
