import { describe, expect, it } from "vitest";
import { syTreeToMarkdown } from "../syMarkdown";
import type { SyNode } from "../syMarkdown";
import { KP_REGION_BEGIN, KP_REGION_END, parseKpRegion } from "../../../core/src/api/kpDocSync";

/** 构造真机同款 .sy 块树：
 *  内核把应用写入的 KP 区（name 行 + 2 空格缩进内容行）解析后，
 *  name 行与内容行合并在同一 NodeParagraph 的 NodeText 里以 \n 分隔，且内容行缩进被剥掉 */
function makeKpTree(kps: Array<{ name: string; id: number; content: string }>): SyNode {
  return {
    Type: "NodeDocument",
    Properties: { title: "测试章" },
    Children: [
      { Type: "NodeHeading", HeadingLevel: 1, Children: [{ Type: "NodeText", Data: "测试章" }] },
      { Type: "NodeParagraph", Children: [{ Type: "NodeText", Data: KP_REGION_BEGIN }] },
      {
        Type: "NodeList",
        Children: kps.map((k) => ({
          Type: "NodeListItem",
          Children: [
            {
              Type: "NodeParagraph",
              Children: [{ Type: "NodeText", Data: `${k.name} [未学习] <!-- kp:${k.id} -->\n${k.content}` }],
            },
          ],
        })),
      },
      { Type: "NodeParagraph", Children: [{ Type: "NodeText", Data: KP_REGION_END }] },
    ],
  };
}

describe("syTreeToMarkdown（.sy 块树 → markdown 还原）", () => {
  it("真机回归：列表项续行补 2 空格缩进，parseKpRegion 读回内容不丢失", () => {
    const tree = makeKpTree([
      { name: "自然经济开始解体", id: 632, content: "鸦片战争后，西方商品涌入。" },
      { name: "通商口岸开放", id: 633, content: "五口通商。" },
      { name: "小农经济解体", id: 634, content: "耕织分离。" },
    ]);
    const md = syTreeToMarkdown(tree);

    // name 行原样还原
    expect(md).toContain("- 自然经济开始解体 [未学习] <!-- kp:632 -->");
    // 内容行须以 2 空格开头（parseKpRegion 的条目续行约定）
    const lines = md.split("\n");
    const i = lines.findIndex((l) => l === "- 自然经济开始解体 [未学习] <!-- kp:632 -->");
    expect(i).toBeGreaterThan(0);
    expect(lines[i + 1]).toBe("  鸦片战争后，西方商品涌入。");
    const j = lines.findIndex((l) => l === "- 通商口岸开放 [未学习] <!-- kp:633 -->");
    expect(lines[j + 1]).toBe("  五口通商。");
    const k = lines.findIndex((l) => l === "- 小农经济解体 [未学习] <!-- kp:634 -->");
    expect(lines[k + 1]).toBe("  耕织分离。");

    // 还原 md 经 parseKpRegion 解析：3 条目 id/name/content 全对
    const parsed = parseKpRegion(md);
    expect(parsed.hasRegion).toBe(true);
    expect(parsed.kps).toEqual([
      { id: 632, name: "自然经济开始解体", content: "鸦片战争后，西方商品涌入。" },
      { id: 633, name: "通商口岸开放", content: "五口通商。" },
      { id: 634, name: "小农经济解体", content: "耕织分离。" },
    ]);
  });

  it("内容内空行保持空串不缩进；首行（name 行）不缩进", () => {
    const tree = makeKpTree([{ name: "多段内容", id: 9, content: "第一段\n\n第二段" }]);
    const md = syTreeToMarkdown(tree);
    const lines = md.split("\n");
    const i = lines.findIndex((l) => l === "- 多段内容 [未学习] <!-- kp:9 -->");
    expect(i).toBeGreaterThan(0);
    expect(lines[i + 1]).toBe("  第一段");
    expect(lines[i + 2]).toBe("");
    expect(lines[i + 3]).toBe("  第二段");
    const parsed = parseKpRegion(md);
    expect(parsed.kps).toEqual([{ id: 9, name: "多段内容", content: "第一段\n\n第二段" }]);
  });

  it("无 NodeParagraph 的空列表项不炸", () => {
    const tree: SyNode = {
      Type: "NodeDocument",
      Properties: { title: "空项" },
      Children: [
        { Type: "NodeParagraph", Children: [{ Type: "NodeText", Data: KP_REGION_BEGIN }] },
        { Type: "NodeList", Children: [{ Type: "NodeListItem" }] },
        { Type: "NodeParagraph", Children: [{ Type: "NodeText", Data: KP_REGION_END }] },
      ],
    };
    expect(() => syTreeToMarkdown(tree)).not.toThrow();
    const md = syTreeToMarkdown(tree);
    expect(md).toContain("- ");
  });
});
