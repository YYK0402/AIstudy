import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppData, KnowledgePoint } from "../../types/appData";
import { createEmptyData } from "../../types/appData";
import { setBridge } from "../../bridge";
import type { StudyBridge } from "../../bridge/types";

// mock AI 调用：状态由 aiState 驱动（binding/fail/response/calls）；callAiWithRetry 直通 callAi（编排测试不验证退避，退避在 ai.test.ts 独立覆盖）
const aiState = {
  binding: { providerId: 1, modelId: "m1" } as { providerId: number; modelId: string } | null,
  calls: 0,
  fail: null as string | null,
  response: "[]",
};
vi.mock("../ai", () => {
  const callAiImpl = async () => {
    aiState.calls++;
    if (aiState.fail) throw new Error(aiState.fail);
    return { content: aiState.response, tokenIn: 0, tokenOut: 0 };
  };
  return {
    findTaskBinding: () => aiState.binding,
    callAi: callAiImpl,
    callAiWithRetry: callAiImpl,
    AiCanceledError: class AiCanceledError extends Error {},
  };
});

const dataRef: { data: AppData } = { data: createEmptyData() };
setBridge({
  getData: async () => dataRef.data,
  saveData: async (next: AppData) => {
    dataRef.data = next;
    return { code: 0 };
  },
} as unknown as StudyBridge);

const { findRelinkableKps, parseRelinkResponse, relinkKps } = await import("../kpRelink");

function makeCh(id: number, parentId: number | null, name: string, level: 1 | 2, sort: number) {
  return { id, courseId: 1, parentId, siyuanBlockId: null, name, level, sort };
}

function makeKp(id: number, courseId: number, chapterId: number | null, name: string, chapterName = ""): KnowledgePoint {
  return {
    id, courseId, chapterId, blockId: null, name, content: "内容", mastery: "unlearn",
    sourceAssetIds: "", prevKpIds: "", chapterName, sort: 1, createTime: "2026-01-01T00:00:00Z",
  };
}

function seed() {
  dataRef.data = {
    ...createEmptyData(),
    courses: [
      { id: 1, siyuanDocId: null, name: "课程A", description: "", target: "", totalCycle: "", status: "active", createTime: "2026-01-01T00:00:00Z" },
      { id: 2, siyuanDocId: null, name: "课程B", description: "", target: "", totalCycle: "", status: "active", createTime: "2026-01-01T00:00:00Z" },
    ],
    chapters: [
      makeCh(1, null, "第一章 项目管理导论", 1, 1),
      makeCh(2, 1, "1.1 项目基础", 2, 1),
      makeCh(3, 1, "1.2 项目管理框架", 2, 2),
      makeCh(4, null, "第二章 项目整合管理", 1, 2),
      makeCh(5, 4, "2.1 项目章程", 2, 1),
    ],
    knowledgePoints: [
      // 本地可命中：名称剥编号后与「2.1 项目章程」精确相等
      makeKp(100, 1, null, "项目章程"),
      // 本地可命中：chapterName 归一化后与第一章精确相等
      makeKp(101, 1, null, "项目集管理", "第一章 项目管理导论"),
      // 本地未命中 → AI
      makeKp(102, 1, null, "项目相关方管理"),
      // 孤儿（chapterId 指向已删章节 999）→ AI
      makeKp(103, 1, 999, "项目治理结构", "已删除章"),
      // 正常归属 → 不在归位范围
      makeKp(200, 1, 5, "章程发布"),
      // 其他课程 → 不在归位范围
      makeKp(300, 2, null, "别的课知识点"),
    ],
  };
  aiState.calls = 0;
  aiState.fail = null;
  aiState.binding = { providerId: 1, modelId: "m1" };
  aiState.response =
    '[{"id":102,"chapterId":5,"reason":"相关方管理归项目章程节"},{"id":103,"chapterId":1,"reason":"治理结构属导论"}]';
}

describe("findRelinkableKps 归位范围（未分配 + 孤儿）", () => {
  beforeEach(seed);
  it("含 chapterId=null 与 chapterId 指向已删章节的 KP，排除正常归属与其他课程", () => {
    const ids = findRelinkableKps(dataRef.data, 1).map((k) => k.id);
    expect(ids).toEqual([100, 101, 102, 103]);
  });
});

describe("parseRelinkResponse AI 输出校验（fail-loud）", () => {
  const kpIds = new Set([102, 103]);
  const chapterIds = new Set([1, 5]);

  it("合法数组：解析 id/chapterId/reason", () => {
    const res = parseRelinkResponse('[{"id":102,"chapterId":5,"reason":"r"}]', kpIds, chapterIds);
    expect(res).toEqual([{ kpId: 102, chapterId: 5, reason: "r" }]);
  });

  it("围栏包裹：容忍解析", () => {
    const res = parseRelinkResponse("```json\n[{\"id\":103,\"chapterId\":1}]\n```", kpIds, chapterIds);
    expect(res.map((r) => r.kpId)).toEqual([103]);
  });

  it("空数组：返回空", () => {
    expect(parseRelinkResponse("[]", kpIds, chapterIds)).toEqual([]);
  });

  it("id 不在输入 KP 集：拒绝整批", () => {
    expect(() => parseRelinkResponse('[{"id":199,"chapterId":5}]', kpIds, chapterIds)).toThrow(/不存在的知识点/);
  });

  it("id 重复：拒绝整批", () => {
    expect(() => parseRelinkResponse('[{"id":102,"chapterId":5},{"id":102,"chapterId":1}]', kpIds, chapterIds)).toThrow(/重复/);
  });

  it("chapterId 不在输入章节集：拒绝整批", () => {
    expect(() => parseRelinkResponse('[{"id":102,"chapterId":42}]', kpIds, chapterIds)).toThrow(/不存在的章节/);
  });

  it("非 JSON：拒绝", () => {
    expect(() => parseRelinkResponse("好的，我来归位", kpIds, chapterIds)).toThrow();
  });

  it("顶层非数组：拒绝", () => {
    expect(() => parseRelinkResponse('{"id":102}', kpIds, chapterIds)).toThrow(/数组/);
  });

  it("reason 缺失：容忍为空串", () => {
    expect(parseRelinkResponse('[{"id":102,"chapterId":5}]', kpIds, chapterIds)).toEqual([{ kpId: 102, chapterId: 5, reason: "" }]);
  });
});

describe("relinkKps 两级编排（本地优先 + AI 兜底，直接落库）", () => {
  beforeEach(seed);

  it("本地 2 + AI 2：全部落库，chapterName 同步刷新，AI 只调一次", async () => {
    const res = await relinkKps(1);
    expect(res.linked).toBe(4);
    expect(res.linkedLocal).toBe(2);
    expect(res.linkedAi).toBe(2);
    expect(res.stuck).toBe(0);
    expect(res.aiSkipped).toBe(false);
    expect(res.aiError).toBeNull();
    expect(aiState.calls).toBe(1);
    const kp = (id: number) => dataRef.data.knowledgePoints.find((k) => k.id === id)!;
    expect(kp(100).chapterId).toBe(5);
    expect(kp(100).chapterName).toBe("2.1 项目章程");
    expect(kp(101).chapterId).toBe(1);
    expect(kp(102).chapterId).toBe(5);
    expect(kp(103).chapterId).toBe(1);
    // 范围外 KP 不动
    expect(kp(200).chapterId).toBe(5);
    expect(kp(300).chapterId).toBeNull();
  });

  it("AI 失败：本地结果照常落库，aiError 记录原因", async () => {
    aiState.fail = "服务不可用";
    const res = await relinkKps(1);
    expect(res.linked).toBe(2);
    expect(res.linkedLocal).toBe(2);
    expect(res.linkedAi).toBe(0);
    expect(res.stuck).toBe(2);
    expect(res.aiError).toBe("服务不可用");
    const kp = (id: number) => dataRef.data.knowledgePoints.find((k) => k.id === id)!;
    expect(kp(100).chapterId).toBe(5);
    expect(kp(102).chapterId).toBeNull(); // AI 未成功 → 保持未分配
  });

  it("未配置模型：仅本地匹配，aiSkipped 标记", async () => {
    aiState.binding = null;
    const res = await relinkKps(1);
    expect(res.linked).toBe(2);
    expect(res.aiSkipped).toBe(true);
    expect(res.aiError).toBeNull();
    expect(aiState.calls).toBe(0);
  });

  it("无归位目标：直接返回零值不调 AI", async () => {
    dataRef.data.knowledgePoints = [makeKp(200, 1, 5, "章程发布")];
    const res = await relinkKps(1);
    expect(res.linked).toBe(0);
    expect(res.stuck).toBe(0);
    expect(aiState.calls).toBe(0);
  });

  it("剩余超 100：按批调用 AI", async () => {
    const kps: KnowledgePoint[] = [];
    for (let i = 0; i < 250; i++) {
      kps.push(makeKp(1000 + i, 1, null, `独特知识点${i}`));
    }
    dataRef.data.knowledgePoints = kps;
    aiState.response = "[]";
    const res = await relinkKps(1);
    expect(aiState.calls).toBe(3); // 100 + 100 + 50
    expect(res.linked).toBe(0);
    expect(res.stuck).toBe(250);
    expect(res.aiError).toBeNull();
  });
});
