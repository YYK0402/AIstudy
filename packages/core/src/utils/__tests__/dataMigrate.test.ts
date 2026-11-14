import { describe, expect, it } from "vitest";
import type { AppData } from "../../types/appData";
import { createEmptyData } from "../../types/appData";
import { normalizeAppDataShape } from "../dataMigrate";

function seed(): AppData {
  const d = createEmptyData();
  d.chapters = [
    { id: 1, courseId: 1, parentId: null, siyuanBlockId: null, name: "第一章", level: "chapter" as unknown as number, sort: 1 },
    { id: 2, courseId: 1, parentId: 1, siyuanBlockId: null, name: "1.1 节", level: "unit" as unknown as number, sort: 1 },
  ];
  return d;
}

describe("normalizeAppDataShape", () => {
  it("旧版 level 字符串升为数字", () => {
    const d = seed();
    normalizeAppDataShape(d);
    expect(d.chapters[0].level).toBe(1);
    expect(d.chapters[1].level).toBe(2);
  });
  it("幂等：数字 level 与已有 tocMappings 不被破坏", () => {
    const d = seed();
    d.tocMappings = [{ id: 9, materialId: 5, courseId: 1, materialPath: "第一章", chapterId: 1 }];
    normalizeAppDataShape(d);
    normalizeAppDataShape(d);
    expect(d.chapters[0].level).toBe(1);
    expect(d.tocMappings).toHaveLength(1);
    expect(d.tocMappings[0].id).toBe(9);
  });
  it("缺失 tocMappings 时补空数组", () => {
    const d = createEmptyData();
    delete (d as { tocMappings?: unknown }).tocMappings;
    normalizeAppDataShape(d);
    expect(d.tocMappings).toEqual([]);
  });
  it("课程存量非通用内置题型题：自动补入课程附加题型清单（幂等）", () => {
    const d = createEmptyData();
    d.courses = [
      { id: 1, siyuanDocId: null, name: "英语", description: "", target: "", totalCycle: "", status: "active", createTime: "2026-01-01T00:00:00" },
    ];
    d.questions = [
      {
        id: 1, courseId: 1, kpIds: "", title: "t", options: "[]", answer: "",
        analysis: "", qType: "cloze", difficulty: "medium", source: "ai",
        paperId: null, createTime: "2026-01-01T00:00:00",
      },
    ];
    normalizeAppDataShape(d);
    expect(d.courses[0].extraQuestionTypes).toEqual([{ name: "cloze", mode: "passage" }]);
    normalizeAppDataShape(d);
    expect(d.courses[0].extraQuestionTypes).toEqual([{ name: "cloze", mode: "passage" }]);
  });
});
