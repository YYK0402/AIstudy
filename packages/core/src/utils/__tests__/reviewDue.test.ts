import { describe, expect, it } from "vitest";
import { isReviewScheduleDue } from "../reviewDue";

const today = "2026-10-28";
const kpIds = new Set([1]);

describe("isReviewScheduleDue（U14：非法 dueTime 过滤）", () => {
  it("到期日到达 → 到期", () => {
    expect(isReviewScheduleDue({ dueTime: "2026-10-28", kpId: 1, qId: null }, today, kpIds, new Set(), new Set())).toBe(true);
  });

  it("已过期 → 到期", () => {
    expect(isReviewScheduleDue({ dueTime: "2026-10-01", kpId: 1, qId: null }, today, kpIds, new Set(), new Set())).toBe(true);
  });

  it("未到期 → 未到期", () => {
    expect(isReviewScheduleDue({ dueTime: "2026-10-29", kpId: 1, qId: null }, today, kpIds, new Set(), new Set())).toBe(false);
  });

  it("空串 dueTime 视为未到期（字典序小于今天不再误判到期）", () => {
    expect(isReviewScheduleDue({ dueTime: "", kpId: 1, qId: null }, today, kpIds, new Set(), new Set())).toBe(false);
  });

  it("'NaN' dueTime 视为未到期", () => {
    expect(isReviewScheduleDue({ dueTime: "NaN", kpId: 1, qId: null }, today, kpIds, new Set(), new Set())).toBe(false);
  });

  it("悬挂引用不浮现（原有行为保持）", () => {
    expect(isReviewScheduleDue({ dueTime: "2026-10-28", kpId: 99, qId: null }, today, kpIds, new Set(), new Set())).toBe(false);
  });
});
