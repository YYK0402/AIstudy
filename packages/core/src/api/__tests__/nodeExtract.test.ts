import { describe, expect, it, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import type { AppData } from "../../types/appData";
import { createEmptyData } from "../../types/appData";
import { setBridge, type StudyBridge } from "../../bridge";
import { buildNodeText, buildCourseKpNames, extractMaterialNodes, resolveExtractNodes } from "../nodeExtract";
import { listUnextractedMaterials } from "../extract";

// 假桥：KP 写入走真实 saveData 假桥，AI 响应由假桥 callAi 返回固定 JSON 并计数
const bridgeDataRef: { data: AppData } = { data: createEmptyData() };
let callAiCount = 0;
let saveCount = 0;
let callAiImpl: (n: number) => Promise<{ content: string; tokenIn: number; tokenOut: number }> = async () => ({
  content: "[]",
  tokenIn: 0,
  tokenOut: 0,
});
setBridge({
  getData: async () => bridgeDataRef.data,
  saveData: async (next: AppData) => {
    bridgeDataRef.data = next;
    saveCount++;
    return { code: 0 };
  },
  callAi: async () => callAiImpl(++callAiCount),
} as unknown as StudyBridge);

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

describe("extractMaterialNodes 来源回填（跳过节点）", () => {
  it("增量资料只映射到已有 KP 的节点：并入节点 KP 的 sourceAssetIds（去重/顺序稳定），无 AI 调用，无变更不保存", async () => {
    // 节点 1 已有 KP(100, 来源 99)，节点 2 也有 KP(101, 来源 98)：资料 11 的全部节点都被跳过
    const d = fixture();
    d.knowledgePoints.push({
      id: 101, courseId: 1, chapterId: 2, blockId: null, name: "既有KP2", content: "y",
      mastery: "unlearn", sourceAssetIds: "98", prevKpIds: "", chapterName: "1.1", sort: 0, createTime: "t",
    });
    bridgeDataRef.data = d;
    callAiCount = 0;
    saveCount = 0;

    const r = await extractMaterialNodes(1, [11]);
    expect(r).toEqual({ nodeTotal: 0, nodeDone: 0, created: 0, skippedDup: 0, emptyNodes: 0, invalidItems: 0 });
    expect(callAiCount).toBe(0); // 全跳过，无 AI 调用
    // 去重、顺序稳定：原有顺序保留，新 id 追加
    expect(bridgeDataRef.data.knowledgePoints.find((k) => k.id === 100)!.sourceAssetIds).toBe("99,11");
    expect(bridgeDataRef.data.knowledgePoints.find((k) => k.id === 101)!.sourceAssetIds).toBe("98,11");
    expect(saveCount).toBe(1);

    // 症状恢复：资料 11 已被 KP 来源覆盖，不再被误列为未抽取
    const unextracted = await listUnextractedMaterials(1);
    expect(unextracted.map((m) => m.id)).not.toContain(11);

    // 再跑一次：已含 11 → 无变更 → 不触发保存
    await extractMaterialNodes(1, [11]);
    expect(bridgeDataRef.data.knowledgePoints.find((k) => k.id === 100)!.sourceAssetIds).toBe("99,11");
    expect(saveCount).toBe(1);
  });
});

describe("抽取质量可见性（M6）", () => {
  it("AI 返回缺 description 的项计入 invalidItems，不静默丢弃", async () => {
    const d = fixture();
    d.providers = [{ id: 1, name: "P", baseUrl: "http://x", apiKey: "k", timeout: 30000, enabled: true, createTime: "t" }];
    d.models = [{ id: 1, providerId: 1, modelId: "m1", displayName: "M", maxContext: null }];
    d.taskModels = [{ taskKey: "extract_kp", modelId: 1, isGlobalDefault: false }];
    bridgeDataRef.data = d;
    callAiCount = 0;
    callAiImpl = async () => ({
      content: JSON.stringify([
        { name: "新知识点A", description: "描述A" },
        { name: "缺描述知识点" },
      ]),
      tokenIn: 0,
      tokenOut: 0,
    });
    const r = await extractMaterialNodes(1, [11]);
    expect(r.created).toBe(1);
    expect(r.invalidItems).toBe(1);
    expect(r.emptyNodes).toBe(0);
  });

  it("无正文节点计入 emptyNodes 且不调 AI", async () => {
    const d = fixture();
    d.providers = [{ id: 1, name: "P", baseUrl: "http://x", apiKey: "k", timeout: 30000, enabled: true, createTime: "t" }];
    d.models = [{ id: 1, providerId: 1, modelId: "m1", displayName: "M", maxContext: null }];
    d.taskModels = [{ taskKey: "extract_kp", modelId: 1, isGlobalDefault: false }];
    // 资料 12：outline 含正文中不存在的标题（识别错位）→ 映射节点 span 未定位 → 无可用正文
    d.chapters.push({ id: 5, courseId: 1, parentId: 4, siyuanBlockId: null, name: "第四节", level: 2, sort: 1 });
    d.materials.push({
      id: 12, courseId: 1, name: "教材C", fileType: "txt", assetPath: "",
      contentText: "第三章\n有正文", headings: "[]", siyuanDocId: null, status: "parsed", createTime: "t",
      outline: JSON.stringify([{ text: "第三章", level: 1 }, { text: "第四节", level: 2 }]), outlineStatus: "done",
    });
    d.tocMappings.push({ id: 7, materialId: 12, courseId: 1, materialPath: "第三章>第四节", chapterId: 5 });
    bridgeDataRef.data = d;
    callAiCount = 0;
    const r = await extractMaterialNodes(1, [12]);
    expect(r.nodeTotal).toBe(1);
    expect(r.emptyNodes).toBe(1);
    expect(r.created).toBe(0);
    expect(callAiCount).toBe(0);
  });
});

describe("extractMaterialNodes AI 限流重试（H2）", () => {
  it("首次 429 后自动退避重试成功：抽取照常完成，不整任务失败", async () => {
    const d = fixture();
    d.providers = [{ id: 1, name: "P", baseUrl: "http://x", apiKey: "k", timeout: 30000, enabled: true, createTime: "t" }];
    d.models = [{ id: 1, providerId: 1, modelId: "m1", displayName: "M", maxContext: null }];
    d.taskModels = [{ taskKey: "extract_kp", modelId: 1, isGlobalDefault: false }];
    bridgeDataRef.data = d;
    callAiCount = 0;
    callAiImpl = async (n) => {
      if (n === 1) throw new Error("HTTP 429 Too Many Requests");
      return { content: "[]", tokenIn: 0, tokenOut: 0 };
    };
    vi.useFakeTimers();
    try {
      const p = extractMaterialNodes(1, [11]); // 节点 2 需抽取，1 次 AI 调用
      await vi.advanceTimersByTimeAsync(11000); // 覆盖默认 10s 首档退避
      const r = await p;
      expect(r.created).toBe(0);
      expect(callAiCount).toBe(2); // 429 一次 + 重试一次
    } finally {
      vi.useRealTimers();
      callAiImpl = async () => ({ content: "[]", tokenIn: 0, tokenOut: 0 });
    }
  });
});


describe("buildCourseKpNames 提示词封顶（L1）", () => {
  it("空列表：（无）", () => {
    expect(buildCourseKpNames([])).toBe("（无）");
  });
  it("未超上限：全部名称", () => {
    expect(buildCourseKpNames([{ name: "A" }, { name: "B" }])).toBe("A、B");
  });
  it("超上限：取最近 500 个 + 省略说明", () => {
    const kps = Array.from({ length: 502 }, (_, i) => ({ name: `K${i}` }));
    const text = buildCourseKpNames(kps);
    expect(text.startsWith("K2、K3")).toBe(true);
    expect(text.endsWith("K501（另有 2 个已省略）")).toBe(true);
  });
});
