import { describe, expect, it } from "vitest";
import { createEmptyData } from "../../types/appData";
import type { AppData } from "../../types/appData";
import { isEffectivelyEmptyGlobal, shouldRejectEmptyOverwrite } from "../emptyGuard";

describe("isEffectivelyEmptyGlobal", () => {
  it("纯空结构（createEmptyData）判定为空", () => {
    expect(isEffectivelyEmptyGlobal(createEmptyData())).toBe(true);
  });

  it("null / undefined / 空对象判定为空", () => {
    expect(isEffectivelyEmptyGlobal(null)).toBe(true);
    expect(isEffectivelyEmptyGlobal(undefined)).toBe(true);
    expect(isEffectivelyEmptyGlobal({} as AppData)).toBe(true);
  });

  it("任一集合有内容即非空", () => {
    for (const key of [
      "providers",
      "courses",
      "chapters",
      "knowledgePoints",
      "questions",
      "studyPlans",
      "wrongQuestions",
      "flashCards",
      "logs",
      "studyLogs",
      "answerRecords",
    ] as const) {
      const data = createEmptyData();
      (data[key] as unknown[]).push({ id: 1 });
      expect(isEffectivelyEmptyGlobal(data)).toBe(false);
    }
  });

  it("settings 偏离默认值即非空", () => {
    const data = createEmptyData();
    data.settings.persistToSiyuan = true;
    expect(isEffectivelyEmptyGlobal(data)).toBe(false);
  });

  it("settings 等于默认值仍为空", () => {
    const data = createEmptyData();
    data.settings = { chapterMode: "manual", persistToSiyuan: false, notebookName: "AI 研习" };
    expect(isEffectivelyEmptyGlobal(data)).toBe(true);
  });

  it("使用痕迹字段（reminders/cryptoKeyMaterial/promptTemplates/docRegions）任一存在即非空", () => {
    const base = createEmptyData();
    const withReminders = { ...base, reminders: { lastReminderDate: "2026-11-06" } };
    const withKeyMaterial = { ...base, cryptoKeyMaterial: "abcd1234" };
    const withTemplates = { ...base, promptTemplates: { quiz: { system: "s", user: "u" } } };
    const withRegions = { ...base, docRegions: { doc1: { h: "abc", ids: [1] } } };
    const withEmptyReminders = { ...base, reminders: {} };
    expect(isEffectivelyEmptyGlobal(withReminders)).toBe(false);
    expect(isEffectivelyEmptyGlobal(withKeyMaterial)).toBe(false);
    expect(isEffectivelyEmptyGlobal(withTemplates)).toBe(false);
    expect(isEffectivelyEmptyGlobal(withRegions)).toBe(false);
    // 空 reminders 对象（无实际值）不算使用痕迹
    expect(isEffectivelyEmptyGlobal(withEmptyReminders)).toBe(true);
  });
});

describe("shouldRejectEmptyOverwrite", () => {
  function nonEmptyGlobal(): AppData {
    const data = createEmptyData();
    data.courses = [
      { id: 1, siyuanDocId: "d", name: "课程", description: "", target: "", totalCycle: "", status: "active", createTime: "2026-01-01T00:00:00Z" },
    ];
    return data;
  }

  it("非空状态写非空状态：不拒绝", () => {
    expect(shouldRejectEmptyOverwrite(nonEmptyGlobal(), JSON.stringify(nonEmptyGlobal()))).toBe(false);
  });

  it("空覆盖非空（核心事故场景）：拒绝", () => {
    expect(shouldRejectEmptyOverwrite(createEmptyData(), JSON.stringify(nonEmptyGlobal()))).toBe(true);
  });

  it("基线缺失（新设备首启，从未写盘）：不拒绝", () => {
    expect(shouldRejectEmptyOverwrite(createEmptyData(), undefined)).toBe(false);
  });

  it("空覆盖空（首启后连续空写）：不拒绝", () => {
    expect(shouldRejectEmptyOverwrite(createEmptyData(), JSON.stringify(createEmptyData()))).toBe(false);
  });

  it("基线解析失败：fail-closed 拒绝", () => {
    expect(shouldRejectEmptyOverwrite(createEmptyData(), "not-json")).toBe(true);
  });
});
