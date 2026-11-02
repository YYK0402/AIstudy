import { describe, expect, it } from "vitest";
import { createEmptyData, type AppData } from "../../types/appData";
import { setBridge } from "../../bridge";
import type { StudyBridge } from "../../bridge/types";
import { formatLocalDate } from "../../api";

const TODAY = formatLocalDate();

const dataRef: { data: AppData } = {
  data: {
    ...createEmptyData(),
    courses: [
      { id: 1, siyuanDocId: null, name: "课程A", description: "", target: "", totalCycle: "", status: "active", createTime: "2026-10-01T00:00:00Z", modelId: null },
      { id: 2, siyuanDocId: null, name: "课程B", description: "", target: "", totalCycle: "", status: "archived", createTime: "2026-10-01T00:00:00Z", modelId: null },
    ] as AppData["courses"],
    questions: [
      { id: 1, courseId: 1, kpIds: "", title: "错题1", options: "A. 甲", answer: "A", analysis: "", qType: "single", difficulty: "", source: "ai", paperId: null, createTime: "2026-10-01T00:00:00Z" },
      { id: 2, courseId: 1, kpIds: "", title: "错题2", options: "A. 乙", answer: "A", analysis: "", qType: "judge", difficulty: "", source: "ai", paperId: null, createTime: "2026-10-01T00:00:00Z" },
      { id: 3, courseId: 2, kpIds: "", title: "归档课错题", options: "A. 丙", answer: "A", analysis: "", qType: "single", difficulty: "", source: "ai", paperId: null, createTime: "2026-10-01T00:00:00Z" },
    ],
    wrongQuestions: [
      { id: 1, recordId: null, qId: 1, reviewTimes: 1, createTime: "2026-10-01T00:00:00Z", status: "active" },
      { id: 2, recordId: null, qId: 2, reviewTimes: 1, createTime: "2026-10-01T00:00:00Z", status: "active" },
      { id: 3, recordId: null, qId: 1, reviewTimes: 2, createTime: "2026-10-02T00:00:00Z", status: "graduated" },
      { id: 4, recordId: null, qId: 3, reviewTimes: 1, createTime: "2026-10-01T00:00:00Z", status: "active" },
    ],
    flashCards: [
      { id: 71, courseId: 1, kpId: 0, front: "卡A", back: "背A", source: "ai", createTime: "2026-10-01T00:00:00Z" },
      { id: 72, courseId: 2, kpId: 0, front: "卡B", back: "背B", source: "ai", createTime: "2026-10-01T00:00:00Z" },
    ],
    reviewSchedules: [
      { id: 301, kpId: null, qId: null, cardId: 71, stage: 1, dueTime: TODAY, easeFactor: 2.5, intervalDays: 1, lastReviewTime: null, reviewTimes: 0 },
      { id: 302, kpId: null, qId: null, cardId: 72, stage: 1, dueTime: TODAY, easeFactor: 2.5, intervalDays: 1, lastReviewTime: null, reviewTimes: 0 },
    ],
  },
};

(globalThis as Record<string, unknown>).window = {
  addEventListener: () => {},
  dispatchEvent: () => true,
};
setBridge({
  getData: async () => dataRef.data,
  saveData: async (next: AppData) => {
    dataRef.data = next;
    return { code: 0 };
  },
  showMessage: () => {},
} as unknown as StudyBridge);

describe("useTabBadges（当前课程口径，与页面内容一致）", () => {
  it("当前课程 A：错题=在管未毕业 2，闪卡=到期 1，复习=到期触点 1", async () => {
    const { useTabBadges } = await import("../useTabBadges");
    const badges = useTabBadges(() => ({ id: 1, status: "active" }));
    await badges.refresh();
    // q1（active）+ q2（active）= 2；q1 的 graduated 记录不计
    expect(badges.wrongTotal.value).toBe(2);
    // 卡 71 到期 1
    expect(badges.cardDueTotal.value).toBe(1);
    // 触点 301（卡 71）到期 1
    expect(badges.dueReviewTotal.value).toBe(1);
  });

  it("切到归档课程 → 全 0（归档课只读，与仪表盘口径一致）", async () => {
    const { useTabBadges } = await import("../useTabBadges");
    const badges = useTabBadges(() => ({ id: 2, status: "archived" }));
    await badges.refresh();
    expect(badges.wrongTotal.value).toBe(0);
    expect(badges.cardDueTotal.value).toBe(0);
    expect(badges.dueReviewTotal.value).toBe(0);
  });

  it("未选择课程 → 全 0", async () => {
    const { useTabBadges } = await import("../useTabBadges");
    const badges = useTabBadges(() => null);
    await badges.refresh();
    expect(badges.wrongTotal.value).toBe(0);
    expect(badges.cardDueTotal.value).toBe(0);
    expect(badges.dueReviewTotal.value).toBe(0);
  });

  it("徽标跟随当前课程 getter（模拟 Topbar 切课）", async () => {
    const { useTabBadges } = await import("../useTabBadges");
    let current: { id: number; status: string } | null = { id: 1, status: "active" };
    const badges = useTabBadges(() => current);
    await badges.refresh();
    expect(badges.wrongTotal.value).toBe(2);
    current = { id: 2, status: "archived" };
    await badges.refresh();
    expect(badges.wrongTotal.value).toBe(0);
    current = { id: 1, status: "active" };
    await badges.refresh();
    expect(badges.wrongTotal.value).toBe(2);
  });

  it("课程计划全部暂停 → 复习徽标归零（错题/闪卡徽标不受影响，数据不动）", async () => {
    dataRef.data.studyPlans = [
      { id: 51, courseId: 1, planContent: "", targetDate: "2026-12-31", dailyHour: "1", createTime: "2026-10-01T00:00:00Z", status: "paused" },
    ];
    const { useTabBadges } = await import("../useTabBadges");
    const badges = useTabBadges(() => ({ id: 1, status: "active" }));
    await badges.refresh();
    expect(badges.dueReviewTotal.value).toBe(0);
    // 错题/闪卡徽标语义独立，保持正常
    expect(badges.wrongTotal.value).toBe(2);
    expect(badges.cardDueTotal.value).toBe(1);
    // 恢复计划 → 复习徽标回来
    dataRef.data.studyPlans[0].status = "active";
    await badges.refresh();
    expect(badges.dueReviewTotal.value).toBe(1);
  });

  it("数据变化后 refresh 得到新值", async () => {
    const { useTabBadges } = await import("../useTabBadges");
    const badges = useTabBadges(() => ({ id: 1, status: "active" }));
    await badges.refresh();
    dataRef.data.wrongQuestions = dataRef.data.wrongQuestions.slice(0, 1);
    await badges.refresh();
    expect(badges.wrongTotal.value).toBe(1);
  });
});
