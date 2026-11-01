import { describe, expect, it } from "vitest";
import { createEmptyData } from "../../types/appData";
import type { AppData, KnowledgePoint } from "../../types/appData";
import { adjustMasteryInData, kpHasOpenWrong, parseAiGradeResponse } from "../quiz";

describe("parseAiGradeResponse（AI 阅卷结果解析）", () => {
  it("裸 JSON 对象", () => {
    expect(parseAiGradeResponse('{"score": 78, "feedback": "要点齐全"}')).toEqual({ score: 78, feedback: "要点齐全" });
  });

  it("json 围栏包裹", () => {
    expect(parseAiGradeResponse('```json\n{"score": 90, "feedback": "优秀"}\n```')).toEqual({ score: 90, feedback: "优秀" });
  });

  it("带前缀说明文字的 JSON", () => {
    expect(parseAiGradeResponse('评分如下：{"score": 60, "feedback": "一般"}')).toEqual({ score: 60, feedback: "一般" });
  });

  it("分数钳制到 0-100 并四舍五入", () => {
    expect(parseAiGradeResponse('{"score": 150, "feedback": ""}')).toEqual({ score: 100, feedback: "" });
    expect(parseAiGradeResponse('{"score": -5, "feedback": ""}')).toEqual({ score: 0, feedback: "" });
    expect(parseAiGradeResponse('{"score": 73.6, "feedback": ""}')).toEqual({ score: 74, feedback: "" });
  });

  it("缺 score 或 score 非有限数 → null（触发重新判分）", () => {
    expect(parseAiGradeResponse('{"feedback": "没有分数"}')).toBeNull();
    expect(parseAiGradeResponse('{"score": "80", "feedback": ""}')).toBeNull();
    expect(parseAiGradeResponse('{"score": NaN, "feedback": ""}')).toBeNull();
    expect(parseAiGradeResponse("无法解析这段回答")).toBeNull();
  });

  it("feedback 非字符串时置空", () => {
    expect(parseAiGradeResponse('{"score": 50, "feedback": 1}')).toEqual({ score: 50, feedback: "" });
  });
});

describe("adjustMasteryInData（掌握度阶梯升降）", () => {
  function withKp(mastery: KnowledgePoint["mastery"]): AppData {
    const data = createEmptyData();
    data.knowledgePoints = [
      {
        id: 1,
        courseId: 1,
        chapterId: null,
        blockId: null,
        name: "KP",
        content: "",
        mastery,
        sourceAssetIds: "",
        prevKpIds: "",
        chapterName: "",
        sort: 0,
        createTime: "2026-01-01T00:00:00Z",
      },
    ];
    return data;
  }

  it("降档/升档返回说明", () => {
    const data = withKp("mastered");
    expect(adjustMasteryInData(data, 1, -1)).toBe("掌握 → 了解");
    expect(data.knowledgePoints[0].mastery).toBe("known");
    expect(adjustMasteryInData(withKp("unlearn"), 1, -1)).toBeNull(); // 已在最低档
  });

  it("升档钳制在最高档", () => {
    const data = withKp("proficient");
    expect(adjustMasteryInData(data, 1, 1)).toBeNull();
    expect(data.knowledgePoints[0].mastery).toBe("proficient");
  });

  it("知识点不存在返回 null", () => {
    expect(adjustMasteryInData(withKp("known"), 999, -1)).toBeNull();
  });
});

describe("kpHasOpenWrong（知识点在管错题判断）", () => {
  function base(): AppData {
    const data = createEmptyData();
    data.questions = [
      { id: 10, courseId: 1, kpIds: "1,2", title: "q10", options: "[]", answer: "A", analysis: "", qType: "single", difficulty: "easy", source: "manual", paperId: null, createTime: "2026-01-01T00:00:00Z" },
      { id: 11, courseId: 1, kpIds: "3", title: "q11", options: "[]", answer: "B", analysis: "", qType: "single", difficulty: "easy", source: "manual", paperId: null, createTime: "2026-01-01T00:00:00Z" },
    ];
    return data;
  }

  function wrong(qId: number, status?: "active" | "graduated") {
    return { id: 1, recordId: null, qId, reviewTimes: 0, createTime: "2026-01-01T00:00:00Z", status, correctStreak: 0 };
  }

  it("在管错题关联知识点 → true", () => {
    const data = base();
    data.wrongQuestions = [wrong(10, "active")];
    expect(kpHasOpenWrong(data, 1)).toBe(true);
    expect(kpHasOpenWrong(data, 3)).toBe(false);
  });

  it("已毕业错题不计", () => {
    const data = base();
    data.wrongQuestions = [wrong(10, "graduated")];
    expect(kpHasOpenWrong(data, 1)).toBe(false);
  });

  it("错题题目缺失不计", () => {
    const data = base();
    data.wrongQuestions = [wrong(999, "active")];
    expect(kpHasOpenWrong(data, 1)).toBe(false);
  });
});
