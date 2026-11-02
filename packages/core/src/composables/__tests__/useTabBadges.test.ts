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

describe("useTabBadges", () => {
  it("错题徽标 = 活跃课程在管（未毕业）错题求和，归档课程与已毕业不计入", async () => {
    const { useTabBadges } = await import("../useTabBadges");
    const badges = useTabBadges();
    await badges.refresh();
    // 课程A：q1（active）+ q2（active）= 2；q1 的 graduated 记录不计；课程B 归档不计
    expect(badges.wrongTotal.value).toBe(2);
  });

  it("闪卡徽标 = 活跃课程到期触点求和", async () => {
    const { useTabBadges } = await import("../useTabBadges");
    const badges = useTabBadges();
    await badges.refresh();
    // 课程A 卡 71 到期 1；课程B 归档不计
    expect(badges.cardDueTotal.value).toBe(1);
  });

  it("数据变化后 refresh 得到新值", async () => {
    const { useTabBadges } = await import("../useTabBadges");
    const badges = useTabBadges();
    await badges.refresh();
    dataRef.data.wrongQuestions = dataRef.data.wrongQuestions.slice(0, 1);
    await badges.refresh();
    expect(badges.wrongTotal.value).toBe(1);
  });
});
