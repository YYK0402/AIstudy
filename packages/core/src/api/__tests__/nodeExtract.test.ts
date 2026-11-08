import { describe, expect, it } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import type { AppData } from "../../types/appData";
import { createEmptyData } from "../../types/appData";
import { setBridge } from "../../bridge";
import { buildNodeText, resolveExtractNodes } from "../nodeExtract";

// fixture：课程 1；章 1（level1）→ 节 2（level2）→ 小节 3（level3）
// 资料 10 outline: [第一章 L1, 1.1 L2, 1.1.1 L3, 第二章 L1]
// 映射: 10@第一章→1, 10@第一章>1.1→2, 10@第一章>1.1>1.1.1→3, 10@第二章→4
// 资料 11 outline: [第一章 L1, 1.1 L2]  映射: 11@第一章→1, 11@第一章>1.1→2
// 节点 1 已有 KP（chapterId=1）
function fixture(): AppData {
  const d = createEmptyData();
  d.courses = [{ id: 1, siyuanDocId: null, name: "C", description: "", target: "", totalCycle: "", status: "active", createTime: "t", modelId: 1 }];
  d.chapters = [
    { id: 1, courseId: 1, parentId: null, siyuanBlockId: null, name: "第一章", level: 1, sort: 1 },
    { id: 2, courseId: 1, parentId: 1, siyuanBlockId: null, name: "1.1", level: 2, sort: 1 },
    { id: 3, courseId: 1, parentId: 2, siyuanBlockId: null, name: "1.1.1", level: 3, sort: 1 },
    { id: 4, courseId: 1, parentId: null, siyuanBlockId: null, name: "第二章", level: 1, sort: 2 },
  ];
  const base = {
    id: 0, courseId: 1, name: "", fileType: "txt", assetPath: "",
    contentText: "", headings: "[]", siyuanDocId: null, status: "", createTime: "t",
    outline: "[]", outlineStatus: "done" as const,
  };
  d.materials = [
    { ...base, id: 10, name: "教材A", contentText: "第一章\n甲\n1.1\n乙\n1.1.1\n丙\n第二章\n丁" },
    { ...base, id: 11, name: "教材B", contentText: "第一章\n甲2\n1.1\n乙2" },
  ];
  d.materials[0].outline = JSON.stringify([
    { text: "第一章", level: 1 }, { text: "1.1", level: 2 },
    { text: "1.1.1", level: 3 }, { text: "第二章", level: 1 },
  ]);
  d.materials[1].outline = JSON.stringify([
    { text: "第一章", level: 1 }, { text: "1.1", level: 2 },
  ]);
  d.tocMappings = [
    { id: 1, materialId: 10, courseId: 1, materialPath: "第一章", chapterId: 1 },
    { id: 2, materialId: 10, courseId: 1, materialPath: "第一章>1.1", chapterId: 2 },
    { id: 3, materialId: 10, courseId: 1, materialPath: "第一章>1.1>1.1.1", chapterId: 3 },
    { id: 4, materialId: 10, courseId: 1, materialPath: "第二章", chapterId: 4 },
    { id: 5, materialId: 11, courseId: 1, materialPath: "第一章", chapterId: 1 },
    { id: 6, materialId: 11, courseId: 1, materialPath: "第一章>1.1", chapterId: 2 },
  ];
  d.knowledgePoints = [
    { id: 100, courseId: 1, chapterId: 1, blockId: null, name: "既有KP", content: "x", mastery: "unlearn", sourceAssetIds: "99", prevKpIds: "", chapterName: "第一章", sort: 0, createTime: "t" },
  ];
  return d;
}

describe("resolveExtractNodes", () => {
  it("覆盖节点的并集，排除已有 KP 的节点，按文档序", () => {
    const d = fixture();
    expect(resolveExtractNodes(d, [10])).toEqual([2, 3, 4]);
    expect(resolveExtractNodes(d, [11])).toEqual([2]); // 节点1已有KP
    expect(resolveExtractNodes(d, [10, 11])).toEqual([2, 3, 4]); // 共享节点不重复
  });
  it("无映射的资料 → 空", () => {
    const d = fixture();
    expect(resolveExtractNodes(d, [999])).toEqual([]);
  });
});

describe("buildNodeText", () => {
  it("资料自然序拼接 span 文本，只含本节点范围", () => {
    const d = fixture();
    const { text, materialIds } = buildNodeText(d, 3);
    expect(materialIds).toEqual([10]);
    expect(text).toContain("丙");
    expect(text).not.toContain("乙");
    expect(text).not.toContain("丁");
  });
  it("多资料共享节点都包含", () => {
    const d = fixture();
    const { text, materialIds } = buildNodeText(d, 2);
    expect(materialIds).toEqual([10, 11]);
    expect(text).toContain("乙");
    expect(text).toContain("乙2");
  });
});
