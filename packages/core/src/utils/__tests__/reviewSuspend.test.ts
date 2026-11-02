import { describe, it, expect } from "vitest";
import { isCourseReviewSuspended } from "../reviewSuspend";
import type { StudyPlan } from "../../types/appData";

function plan(p: Partial<StudyPlan>): StudyPlan {
  return {
    id: 1,
    courseId: 1,
    planContent: "",
    targetDate: "2026-12-31",
    dailyHour: "1",
    createTime: "2026-01-01T00:00:00.000Z",
    ...p,
  };
}

describe("isCourseReviewSuspended", () => {
  it("无计划课程不挂起（自学 KP 正常复习）", () => {
    expect(isCourseReviewSuspended([], 1)).toBe(false);
  });

  it("该课程计划全部暂停 → 挂起", () => {
    expect(isCourseReviewSuspended([plan({ courseId: 1, status: "paused" })], 1)).toBe(true);
  });

  it("多计划全部暂停 → 挂起", () => {
    expect(
      isCourseReviewSuspended(
        [plan({ courseId: 1, status: "paused" }), plan({ id: 2, courseId: 1, status: "paused" })],
        1,
      ),
    ).toBe(true);
  });

  it("多计划有一个在跑 → 不挂起", () => {
    expect(
      isCourseReviewSuspended(
        [plan({ courseId: 1, status: "paused" }), plan({ id: 2, courseId: 1, status: "active" })],
        1,
      ),
    ).toBe(false);
  });

  it("其他课程的暂停计划不计入", () => {
    expect(isCourseReviewSuspended([plan({ courseId: 2, status: "paused" })], 1)).toBe(false);
    expect(isCourseReviewSuspended([plan({ courseId: 2, status: "paused" })], 2)).toBe(true);
  });

  it("旧数据 status 缺失按 active 处理 → 不挂起", () => {
    expect(isCourseReviewSuspended([plan({ courseId: 1 })], 1)).toBe(false);
  });
});
