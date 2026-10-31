import { describe, expect, it } from "vitest";
import { createEmptyCourseData, createEmptyData } from "../../types/appData";
import type { AppData } from "../../types/appData";
import {
  courseStorageName,
  hasCourseEntities,
  mergeAppData,
  normalizeCourseData,
  splitAppData,
} from "../courseSplit";

// 构造两课程样例数据：课程 1 有全套实体，课程 2 只有知识点/题目
function makeData(): AppData {
  const data = createEmptyData();
  data.courses = [
    { id: 1, siyuanDocId: "doc1", name: "课程一", description: "", target: "", totalCycle: "", status: "active", createTime: "2026-01-01T00:00:00Z" },
    { id: 2, siyuanDocId: null, name: "课程二", description: "", target: "", totalCycle: "", status: "active", createTime: "2026-01-02T00:00:00Z" },
  ];
  data.providers = [{ id: 9, name: "p", baseUrl: "http://x", apiKey: "enc1:k", timeout: 60000, enabled: true, createTime: "2026-01-01T00:00:00Z" }];
  data.settings.persistToSiyuan = true;
  data.cryptoKeyMaterial = "abcd";

  data.chapters = [
    { id: 10, courseId: 1, parentId: null, siyuanBlockId: null, name: "章A", level: "chapter", sort: 1 },
    { id: 11, courseId: 2, parentId: null, siyuanBlockId: null, name: "章B", level: "chapter", sort: 1 },
    { id: 12, courseId: 99, parentId: null, siyuanBlockId: null, name: "孤儿章", level: "chapter", sort: 1 },
  ];
  data.knowledgePoints = [
    { id: 100, courseId: 1, chapterId: 10, blockId: null, name: "KP1", content: "c", mastery: "unlearn", sourceAssetIds: "", prevKpIds: "", chapterName: "章A", sort: 1, createTime: "2026-01-01T00:00:00Z" },
    { id: 101, courseId: 2, chapterId: 11, blockId: null, name: "KP2", content: "c", mastery: "mastered", sourceAssetIds: "", prevKpIds: "", chapterName: "章B", sort: 1, createTime: "2026-01-01T00:00:00Z" },
  ];
  data.materials = [
    { id: 200, courseId: 1, name: "资料1", assetPath: "a.pdf", fileType: "pdf", contentText: "t", headings: "[]", siyuanDocId: null, status: "done", createTime: "2026-01-01T00:00:00Z" },
  ];
  data.materialChapters = [{ id: 300, materialId: 200, chapterId: 10 }];
  data.questions = [
    { id: 400, courseId: 1, kpIds: "100", title: "Q1", options: "[]", answer: "A", analysis: "", qType: "single", difficulty: "medium", source: "manual", paperId: null, createTime: "2026-01-01T00:00:00Z" },
    { id: 401, courseId: 2, kpIds: "101", title: "Q2", options: "[]", answer: "B", analysis: "", qType: "single", difficulty: "easy", source: "manual", paperId: null, createTime: "2026-01-01T00:00:00Z" },
  ];
  data.examPapers = [{ id: 500, courseId: 1, name: "卷", year: 2026, createTime: "2026-01-01T00:00:00Z" }];
  data.answerRecords = [
    { id: 600, qId: 400, userAnswer: "A", isCorrect: true, score: "1", createTime: "2026-01-01T00:00:00Z" },
    { id: 601, qId: 401, userAnswer: "C", isCorrect: false, score: "0", createTime: "2026-01-01T00:00:00Z" },
    { id: 602, qId: 999, userAnswer: "A", isCorrect: true, score: "1", createTime: "2026-01-01T00:00:00Z" },
  ];
  data.questionAsks = [
    { id: 1400, qId: 400, courseId: 1, turns: [{ role: "user", content: "为什么？", createTime: "2026-01-01T00:00:00Z" }], updateTime: "2026-01-01T00:00:00Z" },
    { id: 1401, qId: 401, courseId: 2, turns: [], updateTime: "2026-01-01T00:00:00Z" },
    { id: 1402, qId: 999, courseId: 99, turns: [], updateTime: "2026-01-01T00:00:00Z" },
  ];
  data.wrongQuestions = [{ id: 700, recordId: 601, qId: 401, reviewTimes: 0, createTime: "2026-01-01T00:00:00Z" }];
  data.studyPlans = [
    { id: 800, courseId: 1, planContent: "p", targetDate: "2026-02-01", dailyHour: "2", createTime: "2026-01-01T00:00:00Z" },
  ];
  data.studyTasks = [
    { id: 900, planId: 800, chapterId: 10, kpId: null, taskType: "learn", title: "T1", scheduledDate: "2026-01-02", status: "todo", sort: 1 },
    { id: 901, planId: 777, chapterId: null, kpId: null, taskType: "learn", title: "孤儿任务", scheduledDate: "2026-01-02", status: "todo", sort: 1 },
  ];
  data.explainRecords = [
    { id: 1000, courseId: 1, kpId: 100, userContent: "u", aiFeedback: "f", aiScore: "8", createTime: "2026-01-01T00:00:00Z" },
  ];
  data.reviewSchedules = [
    { id: 1100, kpId: 100, qId: null, stage: 0, dueTime: "2026-01-03T00:00:00Z", easeFactor: 2.5, intervalDays: 1, lastReviewTime: null, reviewTimes: 0 },
    { id: 1101, kpId: null, qId: 401, stage: 1, dueTime: "2026-01-03T00:00:00Z", easeFactor: 2.5, intervalDays: 2, lastReviewTime: null, reviewTimes: 0 },
  ];
  data.flashCards = [
    { id: 1200, courseId: 2, kpId: 101, front: "f", back: "b", source: "manual", createTime: "2026-01-01T00:00:00Z" },
  ];
  data.studyLogs = [
    { id: 1300, courseId: 1, kpId: 100, taskId: 900, action: "study", duration: 60, createTime: "2026-01-01T00:00:00Z" },
  ];
  data.conversationsDocs = {
    "10": { docId: "conv-ch10" },
    "course-2": { docId: "conv-fallback-2" },
    "888": { docId: "conv-orphan" },
  };
  return data;
}

describe("courseStorageName", () => {
  it("生成 course-<id> 文件名", () => {
    expect(courseStorageName(1)).toBe("course-1");
    expect(courseStorageName(42)).toBe("course-42");
  });
});

describe("splitAppData", () => {
  it("直接实体按 courseId 归属", () => {
    const { global, courses } = splitAppData(makeData());
    const c1 = courses.get(1)!;
    const c2 = courses.get(2)!;
    expect(c1.chapters.map((c) => c.id)).toEqual([10]);
    expect(c1.knowledgePoints.map((k) => k.id)).toEqual([100]);
    expect(c1.materials.map((m) => m.id)).toEqual([200]);
    expect(c1.questions.map((q) => q.id)).toEqual([400]);
    expect(c1.examPapers.map((p) => p.id)).toEqual([500]);
    expect(c1.studyPlans.map((p) => p.id)).toEqual([800]);
    expect(c1.explainRecords.map((r) => r.id)).toEqual([1000]);
    expect(c1.studyLogs.map((l) => l.id)).toEqual([1300]);
    expect(c2.chapters.map((c) => c.id)).toEqual([11]);
    expect(c2.knowledgePoints.map((k) => k.id)).toEqual([101]);
    expect(c2.flashCards.map((c) => c.id)).toEqual([1200]);
    expect(c1.questionAsks.map((a) => a.id)).toEqual([1400]);
    expect(c2.questionAsks.map((a) => a.id)).toEqual([1401]);
  });

  it("间接实体经引用链归属", () => {
    const { courses } = splitAppData(makeData());
    // answerRecords/wrongQuestions 经 qId；studyTasks 经 planId；reviewSchedules 经 kpId/qId
    expect(courses.get(1)!.answerRecords.map((r) => r.id)).toEqual([600]);
    expect(courses.get(1)!.reviewSchedules.map((s) => s.id)).toEqual([1100]);
    expect(courses.get(1)!.studyTasks.map((t) => t.id)).toEqual([900]);
    expect(courses.get(2)!.answerRecords.map((r) => r.id)).toEqual([601]);
    expect(courses.get(2)!.wrongQuestions.map((w) => w.id)).toEqual([700]);
    expect(courses.get(2)!.reviewSchedules.map((s) => s.id)).toEqual([1101]);
    // materialChapters 经 materialId
    expect(courses.get(1)!.materialChapters.map((mc) => mc.id)).toEqual([300]);
  });

  it("孤儿实体保留在全局部分", () => {
    const { global } = splitAppData(makeData());
    expect(global.chapters.map((c) => c.id)).toEqual([12]);
    expect(global.answerRecords.map((r) => r.id)).toEqual([602]);
    expect(global.studyTasks.map((t) => t.id)).toEqual([901]);
    expect(global.questionAsks.map((a) => a.id)).toEqual([1402]);
    expect(global.conversationsDocs).toEqual({ "888": { docId: "conv-orphan" } });
  });

  it("conversationsDocs 按 key 拆分到对应课程", () => {
    const { courses } = splitAppData(makeData());
    expect(courses.get(1)!.conversationsDocs).toEqual({ "10": { docId: "conv-ch10" } });
    expect(courses.get(2)!.conversationsDocs).toEqual({ "course-2": { docId: "conv-fallback-2" } });
  });

  it("全局配置原样保留，无实体课程也有空条目", () => {
    const data = makeData();
    const { global, courses } = splitAppData(data);
    expect(global.providers).toEqual(data.providers);
    expect(global.courses).toEqual(data.courses);
    expect(global.settings).toEqual(data.settings);
    expect(global.cryptoKeyMaterial).toBe("abcd");
    expect(courses.size).toBe(2);
  });
});

describe("mergeAppData", () => {
  it("拆分后再合并 = 原数据（两课程往返一致）", () => {
    const original = makeData();
    const { global, courses } = splitAppData(original);
    const merged = mergeAppData(global, courses);
    // 实体集合一致（顺序可能不同，按 id 排序比较）
    const byId = <T extends { id: number }>(arr: T[]) =>
      [...arr].sort((a, b) => a.id - b.id).map((x) => x.id);
    expect(byId(merged.chapters)).toEqual(byId(original.chapters));
    expect(byId(merged.knowledgePoints)).toEqual(byId(original.knowledgePoints));
    expect(byId(merged.materials)).toEqual(byId(original.materials));
    expect(byId(merged.materialChapters)).toEqual(byId(original.materialChapters));
    expect(byId(merged.questions)).toEqual(byId(original.questions));
    expect(byId(merged.examPapers)).toEqual(byId(original.examPapers));
    expect(byId(merged.answerRecords)).toEqual(byId(original.answerRecords));
    expect(byId(merged.questionAsks)).toEqual(byId(original.questionAsks));
    expect(byId(merged.wrongQuestions)).toEqual(byId(original.wrongQuestions));
    expect(byId(merged.studyPlans)).toEqual(byId(original.studyPlans));
    expect(byId(merged.studyTasks)).toEqual(byId(original.studyTasks));
    expect(byId(merged.explainRecords)).toEqual(byId(original.explainRecords));
    expect(byId(merged.reviewSchedules)).toEqual(byId(original.reviewSchedules));
    expect(byId(merged.flashCards)).toEqual(byId(original.flashCards));
    expect(byId(merged.studyLogs)).toEqual(byId(original.studyLogs));
    expect(merged.conversationsDocs).toEqual(original.conversationsDocs);
    expect(merged.courses).toEqual(original.courses);
    expect(merged.settings).toEqual(original.settings);
  });

  it("合并不修改入参数组", () => {
    const data = makeData();
    const { global, courses } = splitAppData(data);
    mergeAppData(global, courses);
    expect(global.chapters).toHaveLength(1); // 只有孤儿章
    expect(courses.get(1)!.chapters).toHaveLength(1);
  });
});

describe("hasCourseEntities", () => {
  it("旧布局（实体在内存全量数据里）返回 true", () => {
    expect(hasCourseEntities(makeData())).toBe(true);
  });

  it("已拆分后的全局部分返回 false", () => {
    const { global } = splitAppData(makeData());
    expect(hasCourseEntities(global)).toBe(false);
  });

  it("空数据返回 false", () => {
    expect(hasCourseEntities(createEmptyData())).toBe(false);
  });
});

describe("normalizeCourseData", () => {
  it("补齐缺失字段", () => {
    const out = normalizeCourseData({ chapters: [{ id: 1, courseId: 1, parentId: null, siyuanBlockId: null, name: "x", level: "chapter", sort: 1 }] });
    expect(out.chapters).toHaveLength(1);
    expect(out.questions).toEqual([]);
    expect(out.conversationsDocs).toBeUndefined();
  });

  it("非法输入返回空结构", () => {
    expect(normalizeCourseData(null)).toEqual(createEmptyCourseData());
    expect(normalizeCourseData("x")).toEqual(createEmptyCourseData());
    expect(normalizeCourseData({ chapters: "not-array" }).chapters).toEqual([]);
  });
});
