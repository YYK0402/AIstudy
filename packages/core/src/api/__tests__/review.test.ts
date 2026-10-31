import { describe, expect, it } from "vitest";
import type { AppData, ReviewSchedule } from "../../types/appData";
import { createEmptyData } from "../../types/appData";
import { ensureReviewTouchpointInData, reviewNextDue } from "../review";
import { ensureCardReviewInData } from "../flashcard";
import { formatLocalDate } from "../format";

function makeData(schedule?: Partial<ReviewSchedule> & { id: number }): AppData {
  const data = createEmptyData();
  if (schedule) {
    data.reviewSchedules.push({
      kpId: 1,
      qId: null,
      stage: 3,
      dueTime: "2026-10-30",
      easeFactor: 2.5,
      intervalDays: 5,
      lastReviewTime: null,
      reviewTimes: 4,
      ...schedule,
    });
  }
  return data;
}

describe("ensureReviewTouchpointInData（讲解达标）", () => {
  it("未到期：保持原排期不动（不重置 stage、不缩短间隔）", () => {
    const data = makeData({ id: 1, dueTime: reviewNextDue(3) });
    ensureReviewTouchpointInData(data, 1);
    const s = data.reviewSchedules[0];
    expect(s.stage).toBe(3);
    expect(s.intervalDays).toBe(5);
    expect(s.easeFactor).toBe(2.5);
    expect(s.dueTime).toBe(reviewNextDue(3));
  });

  it("已到期（今天）：按 SM-2 正常推进，间隔变长", () => {
    const data = makeData({ id: 1, dueTime: formatLocalDate() });
    ensureReviewTouchpointInData(data, 1);
    const s = data.reviewSchedules[0];
    expect(s.stage).toBe(4);
    // ease 2.5 → 2.6；interval = round(5 * 2.6) = 13
    expect(s.easeFactor).toBeCloseTo(2.6);
    expect(s.intervalDays).toBe(13);
    expect(s.dueTime).toBe(reviewNextDue(13));
  });

  it("已逾期多日：同样按 SM-2 推进（不重置一阶）", () => {
    const data = makeData({ id: 1, dueTime: "2026-01-01" });
    ensureReviewTouchpointInData(data, 1);
    const s = data.reviewSchedules[0];
    expect(s.stage).toBe(4);
    expect(s.intervalDays).toBe(13);
  });

  it("无触点：新建一阶触点排明天", () => {
    const data = createEmptyData();
    ensureReviewTouchpointInData(data, 9);
    expect(data.reviewSchedules).toHaveLength(1);
    const s = data.reviewSchedules[0];
    expect(s.kpId).toBe(9);
    expect(s.stage).toBe(1);
    expect(s.intervalDays).toBe(1);
    expect(s.dueTime).toBe(reviewNextDue(1));
  });
});

describe("ensureCardReviewInData（闪卡同语义）", () => {
  it("未到期：保持原排期", () => {
    const data = makeData({ id: 2, cardId: 7, dueTime: reviewNextDue(2) });
    ensureCardReviewInData(data, 7);
    const s = data.reviewSchedules[0];
    expect(s.stage).toBe(3);
    expect(s.dueTime).toBe(reviewNextDue(2));
  });

  it("已到期：SM-2 推进", () => {
    const data = makeData({ id: 3, cardId: 7, dueTime: "2026-01-01" });
    ensureCardReviewInData(data, 7);
    const s = data.reviewSchedules[0];
    expect(s.stage).toBe(4);
    expect(s.intervalDays).toBe(13);
  });

  it("无触点：新建", () => {
    const data = createEmptyData();
    ensureCardReviewInData(data, 5);
    expect(data.reviewSchedules).toHaveLength(1);
    expect(data.reviewSchedules[0].cardId).toBe(5);
    expect(data.reviewSchedules[0].stage).toBe(1);
  });
});
