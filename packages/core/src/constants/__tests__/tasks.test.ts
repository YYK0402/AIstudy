import { describe, expect, it } from "vitest";
import { taskAction, taskCountsSummary, taskTypeIcon, taskTypeLabel } from "../tasks";

describe("taskAction", () => {
  it("新知有知识点时去学习页", () => {
    expect(taskAction({ taskType: "learn", kpId: 7 })).toEqual({
      to: { path: "/study", query: { kp: "7" } },
      label: "去学习",
    });
  });

  it("新知无知识点时没有去处", () => {
    expect(taskAction({ taskType: "learn", kpId: null })).toBeNull();
  });

  it("练习按知识点去刷题", () => {
    expect(taskAction({ taskType: "practice", kpId: 9 })?.to).toEqual({ path: "/quiz", query: { kp: "9" } });
  });

  it("测评按章节组卷，缺章节时走结业模考", () => {
    expect(taskAction({ taskType: "test", chapterId: 3 })?.to).toEqual({ path: "/quiz", query: { set: "3" } });
    expect(taskAction({ taskType: "test", chapterId: null })?.to).toEqual({ path: "/quiz", query: { exam: "1" } });
  });

  it("复习去复习页", () => {
    expect(taskAction({ taskType: "review", kpId: 2 })?.label).toBe("去复习");
  });
});

describe("任务类型元数据", () => {
  it("已知类型有标签与图标，未知类型原样回退", () => {
    expect(taskTypeLabel("learn")).toBe("新知");
    expect(taskTypeIcon("test")).toBe("check-square");
    expect(taskTypeLabel("other")).toBe("other");
    expect(taskTypeIcon("other")).toBe("book");
  });
});

describe("taskCountsSummary", () => {
  it("按类型顺序输出计数摘要", () => {
    expect(taskCountsSummary({ review: 1, learn: 2, practice: 3 })).toBe("新知 2 · 练习 3 · 复习 1");
  });

  it("空计数为空串", () => {
    expect(taskCountsSummary({})).toBe("");
  });

  it("未知类型不计入", () => {
    expect(taskCountsSummary({ other: 5 })).toBe("");
  });
});
