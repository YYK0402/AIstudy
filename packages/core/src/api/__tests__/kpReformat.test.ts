import { describe, expect, it, vi } from "vitest";
import type { AppData, KnowledgePoint } from "../../types/appData";
import { createEmptyData } from "../../types/appData";
import { setBridge } from "../../bridge";
import type { StudyBridge } from "../../bridge/types";

// mock AI：固定返回结构化内容；callAi 执行时触发替换钩子（模拟整理期间内存对象被替换）
const REFORMATTED = "- 维度 A\n- 维度 B";
const hooks: { onAi: (() => void) | null } = { onAi: null };
vi.mock("../ai", () => {
  const callAiImpl = async () => {
    hooks.onAi?.();
    return { content: "```json\n" + JSON.stringify({ content: REFORMATTED }) + "\n```" };
  };
  return {
    findTaskBinding: () => ({ providerId: 1, modelId: 1 }),
    callAi: callAiImpl,
    callAiWithRetry: callAiImpl,
    AiCanceledError: class AiCanceledError extends Error {},
  };
});

const { needsReformat, parseReformatContent, reformatKpContents } = await import("../kpReformat");

const LONG =
  "按不确定性，项目可分为封闭性项目、半封闭性项目、半开放性项目和开放性项目，其中封闭性项目不确定性最低，开放性项目不确定性最高、信息缺口最大。" +
  "按实施者身份，可分为业务项目和自我开发项目；按业主特性，可分为企业项目、政府项目、非营利机构项目；按性质，可分为创新项目、创业项目、投资项目（常规性）。";

function makeKp(id: number, name: string, content: string): KnowledgePoint {
  return {
    id,
    courseId: 1,
    chapterId: null,
    blockId: null,
    name,
    content,
    mastery: "unlearn",
    sourceAssetIds: "",
    prevKpIds: "",
    chapterName: "",
    sort: 0,
    createTime: "2026-01-01T00:00:00Z",
  };
}

function makeData(): AppData {
  const d = createEmptyData();
  d.courses = [
    { id: 1, siyuanDocId: "doc1", name: "课程", description: "", target: "", totalCycle: "", status: "active", createTime: "2026-01-01T00:00:00Z" },
  ];
  d.knowledgePoints = [makeKp(1, "项目分类", LONG), makeKp(2, "短内容", "短内容")];
  return d;
}

const saves: AppData[] = [];
let current: AppData = makeData();
setBridge({
  getData: async () => current,
  saveData: async (d: AppData) => {
    saves.push(d);
    return { code: 0 };
  },
} as unknown as StudyBridge);

describe("needsReformat 预筛", () => {
  it("单段长文本（无换行非列表）→ 需整理", () => {
    expect(needsReformat(LONG)).toBe(true);
  });
  it("带换行 → 已结构化，跳过", () => {
    expect(needsReformat("第一段\n" + "x".repeat(80))).toBe(false);
  });
  it("列表开头 → 已结构化，跳过", () => {
    expect(needsReformat("- " + "x".repeat(80))).toBe(false);
    expect(needsReformat("1. " + "x".repeat(80))).toBe(false);
  });
  it("过短/空 → 不整理", () => {
    expect(needsReformat("短内容")).toBe(false);
    expect(needsReformat("")).toBe(false);
  });
});

describe("needsReformat 预筛（多行密排）", () => {
  it("分号连排词对列表（多行密排段落）→ 需整理", () => {
    const c =
      "v+ment：achieve-achievement 成就；advertise-advertisement 广告；agree-agreement 同意；amuse-amusement 娱乐" +
      "\nv+ion：inform-information 内容；invent-invention 发明；predict-prediction 预言；impress-impression 印象" +
      "\n其他：fail-failure；sit-seat；believe-belief；behave-behavior";
    expect(needsReformat(c)).toBe(true);
  });
  it("编号行行内仍密排 → 需整理", () => {
    const c =
      "1. 形容词+ly：effective-effectively；recent-recently；real-really；bad-badly" +
      "\n2. -le 结尾去 e 加 y：comfortable-comfortably；gentle-gently；possible-possibly";
    expect(needsReformat(c)).toBe(true);
  });
  it("列表项行内多条并列分号连排 → 需整理", () => {
    const c =
      "- 名词 n.；动词 v.（及物 vt. / 不及物 vi.）；形容词 adj.；副词 adv." +
      "\n- 数词 num.；连接词 conj.；代词 pron.；介词 prep.；冠词 art.";
    expect(needsReformat(c)).toBe(true);
  });
  it("每行一条的列表 → 已结构化，跳过", () => {
    const c =
      "- fortunately—unfortunately 不幸地；\n- satisfaction—dissatisfaction 不满；\n- patience—impatience 不耐烦；\n- able—unable 不能的；\n- happy—unhappy 不开心的；\n- possible—impossible 不可能的；\n- believable—unbelievable 难以置信的。";
    expect(needsReformat(c)).toBe(false);
  });
  it("散文每行至多 1 个分号 → 跳过", () => {
    const c =
      "由关系词引导的从句，句法功能多做定语（也称关系从句、形容词性从句）。" +
      "\n规则：关系从句的时态由语境决定；没有固定模板可套。";
    expect(needsReformat(c)).toBe(false);
  });
  it("仅 1 行密排 → 保守跳过", () => {
    const c =
      "标签：甲项说明；乙项说明；丙项说明；丁项说明" +
      "\n正文说明第一行，描述一种较长的使用情境与适用条件。" +
      "\n正文说明第二行，描述另一种较长的使用情境与适用条件。";
    expect(needsReformat(c)).toBe(false);
  });
});

describe("parseReformatContent", () => {
  it("裸对象 / 围栏均能解析", () => {
    expect(parseReformatContent('{"content": "abc"}')).toBe("abc");
    expect(parseReformatContent("```json\n" + JSON.stringify({ content: REFORMATTED }) + "\n```")).toBe(REFORMATTED);
  });
  it("非法/缺字段/空值 → null", () => {
    expect(parseReformatContent("不是 JSON")).toBe(null);
    expect(parseReformatContent('{"other": 1}')).toBe(null);
    expect(parseReformatContent('{"content": ""}')).toBe(null);
  });
});


describe("reformatKpContents 批量执行", () => {
  it("只整理预筛命中的知识点，落库结果可验证", async () => {
    current = makeData();
    saves.length = 0;
    let lastProgress: { done: number; total: number } | null = null;
    const res = await reformatKpContents(1, (p) => (lastProgress = p));
    expect(res).toEqual({ done: 1, changed: 1, failed: 0 });
    expect(current.knowledgePoints[0].content).toBe(REFORMATTED);
    expect(current.knowledgePoints[1].content).toBe("短内容");
    expect(lastProgress).toEqual({ done: 1, total: 1 });
  });

  it("无预筛命中 → 不调 AI 直接返回", async () => {
    current = makeData();
    current.knowledgePoints[0].content = "已结构化\n内容行二";
    saves.length = 0;
    const res = await reformatKpContents(1);
    expect(res).toEqual({ done: 0, changed: 0, failed: 0 });
    expect(saves).toHaveLength(0);
  });

  it("AI 调用期间内存对象被替换，最终落库的是最新对象而非旧引用", async () => {
    current = makeData();
    saves.length = 0;
    const staleRef = current;
    let v2: AppData | null = null;
    hooks.onAi = () => {
      v2 = makeData();
      current = v2;
    };
    const res = await reformatKpContents(1);
    expect(res.changed).toBe(1);
    expect(v2).not.toBeNull();
    expect(saves[saves.length - 1]).toBe(v2);
    expect(v2!.knowledgePoints[0].content).toBe(REFORMATTED);
    // 旧对象未被回填（若发生脏写，这里会看到整理后的内容）
    expect(staleRef.knowledgePoints[0].content).not.toBe(REFORMATTED);
    hooks.onAi = null;
  });
});
