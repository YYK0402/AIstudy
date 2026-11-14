import { describe, expect, it } from "vitest";
import type { AppData } from "../../types/appData";
import { createEmptyData } from "../../types/appData";
import { setBridge } from "../../bridge";
import type { StudyBridge } from "../../bridge/types";
import { AiCanceledError } from "../ai";
import { reextractCourse } from "../extract";

// 假桥：记录 saveData 次数/载荷（原子提交断言）+ 可配置 callAi
const dataRef: { data: AppData } = { data: createEmptyData() };
let saveCount = 0;
let callAiCount = 0;
let callAiImpl: (n: number) => Promise<{ content: string; tokenIn: number; tokenOut: number }> = async () => ({
  content: "[]",
  tokenIn: 0,
  tokenOut: 0,
});
setBridge({
  getData: async () => dataRef.data,
  saveData: async (next: AppData) => {
    saveCount++;
    dataRef.data = next;
    return { code: 0 };
  },
  callAi: async () => callAiImpl(++callAiCount),
  showMessage: () => {},
} as unknown as StudyBridge);

/** 课程 1：两资料各映射独立顶层节点；节点 1 有旧 KP（来源 99） */
function fixture(): AppData {
  const d = createEmptyData();
  d.courses = [
    { id: 1, siyuanDocId: null, name: "C", description: "", target: "", totalCycle: "", status: "active", createTime: "t", modelId: null },
  ];
  d.chapters = [
    { id: 1, courseId: 1, parentId: null, siyuanBlockId: null, name: "第一章", level: 1, sort: 1 },
    { id: 2, courseId: 1, parentId: null, siyuanBlockId: null, name: "第二章", level: 1, sort: 2 },
  ];
  d.materials = [
    {
      id: 10, courseId: 1, name: "教材A", fileType: "txt", assetPath: "", contentText: "第一章\n甲",
      headings: "[]", siyuanDocId: null, status: "parsed", createTime: "t",
      outline: JSON.stringify([{ text: "第一章", level: 1 }]), outlineStatus: "done",
    },
    {
      id: 11, courseId: 1, name: "教材B", fileType: "txt", assetPath: "", contentText: "第二章\n乙",
      headings: "[]", siyuanDocId: null, status: "parsed", createTime: "t",
      outline: JSON.stringify([{ text: "第二章", level: 1 }]), outlineStatus: "done",
    },
  ];
  d.tocMappings = [
    { id: 1, materialId: 10, courseId: 1, materialPath: "第一章", chapterId: 1 },
    { id: 2, materialId: 11, courseId: 1, materialPath: "第二章", chapterId: 2 },
  ];
  d.knowledgePoints = [
    { id: 100, courseId: 1, chapterId: 1, blockId: null, name: "旧KP", content: "x", mastery: "unlearn", sourceAssetIds: "99", prevKpIds: "", chapterName: "第一章", sort: 0, createTime: "t" },
  ];
  d.providers = [{ id: 1, name: "P", baseUrl: "http://x", apiKey: "k", timeout: 30000, enabled: true, createTime: "t" }];
  d.models = [{ id: 1, providerId: 1, modelId: "m1", displayName: "M", maxContext: null }];
  d.taskModels = [{ taskKey: "extract_kp", modelId: 1, isGlobalDefault: false }];
  return d;
}

function reset(): void {
  dataRef.data = fixture();
  saveCount = 0;
  callAiCount = 0;
  callAiImpl = async (n) => ({ content: JSON.stringify([{ name: `KP-${n}`, description: "d" }]), tokenIn: 0, tokenOut: 0 });
}

describe("reextractCourse 暂存 + 原子提交（H3）", () => {
  it("成功：旧 KP 原子替换，saveData 恰好一次", async () => {
    reset();
    const r = await reextractCourse(1);
    expect(r.materials).toBe(2);
    expect(r.nodes).toBe(2);
    expect(r.created).toBe(2);
    expect(r.skippedDup).toBe(0);
    expect(saveCount).toBe(1); // 原子：一次提交
    const kps = dataRef.data.knowledgePoints.filter((k) => k.courseId === 1);
    expect(kps.find((k) => k.id === 100)).toBeUndefined(); // 旧 KP 被替换
    expect(kps).toHaveLength(2);
    expect(kps.map((k) => k.name).sort()).toEqual(["KP-1", "KP-2"]);
    expect(kps[0].sourceAssetIds).toBeTruthy();
  });

  it("中途失败：staging 丢弃，数据库原样（无 saveData，旧 KP 仍在）", async () => {
    reset();
    const before = JSON.stringify(dataRef.data);
    callAiImpl = async (n) => {
      if (n === 1) return { content: JSON.stringify([{ name: "KP-1", description: "d" }]), tokenIn: 0, tokenOut: 0 };
      // 不可重试错误（429/5xx 会触发退避重试，拉长测试时长）
      throw new Error("AI 返回的知识点不是合法 JSON");
    };
    await expect(reextractCourse(1)).rejects.toThrow("不是合法 JSON");
    expect(saveCount).toBe(0);
    expect(JSON.stringify(dataRef.data)).toBe(before);
    expect(dataRef.data.knowledgePoints.find((k) => k.id === 100)).toBeTruthy();
  });

  it("课程无资料：直接拒绝，不删任何 KP", async () => {
    reset();
    dataRef.data.materials = [];
    dataRef.data.tocMappings = [];
    await expect(reextractCourse(1)).rejects.toThrow("没有资料");
    expect(saveCount).toBe(0);
    expect(dataRef.data.knowledgePoints).toHaveLength(1);
  });

  it("取消：staging 丢弃，数据原样", async () => {
    reset();
    const before = JSON.stringify(dataRef.data);
    let aborted = false;
    callAiImpl = async () => {
      aborted = true; // 第一份资料抽完后标记取消
      return { content: "[]", tokenIn: 0, tokenOut: 0 };
    };
    await expect(reextractCourse(1, undefined, () => aborted)).rejects.toBeInstanceOf(AiCanceledError);
    expect(saveCount).toBe(0);
    expect(JSON.stringify(dataRef.data)).toBe(before);
  });

  it("staging 期间不污染数据库：进行中读库仍见旧 KP，提交后才替换", async () => {
    reset();
    const seen: AppData[] = [];
    callAiImpl = async () => {
      seen.push(dataRef.data); // AI 调用时刻的数据库引用（staging 模式下数据库不应被改）
      return { content: "[]", tokenIn: 0, tokenOut: 0 };
    };
    await reextractCourse(1);
    expect(seen).toHaveLength(2);
    for (const s of seen) {
      expect(s.knowledgePoints.find((k) => k.id === 100)).toBeTruthy(); // 中途旧 KP 仍在
    }
    expect(saveCount).toBe(1);
    expect(dataRef.data.knowledgePoints.find((k) => k.id === 100)).toBeUndefined(); // 提交后替换
  });
});
