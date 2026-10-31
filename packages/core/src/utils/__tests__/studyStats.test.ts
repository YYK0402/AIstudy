import { describe, expect, it } from "vitest";
import type { ReviewSchedule, StudyLog, WrongQuestion } from "../../api";
import { capStudySec, MAX_ITEM_STUDY_SEC } from "../../constants/study";
import { reviewForecast, studyStreak, wrongSnapshot } from "../studyStats";

const REF = new Date(2026, 9, 27); // 2026-10-27（周二）

function log(date: string): StudyLog {
  return { id: 1, courseId: 1, kpId: null, taskId: null, action: "review", duration: 60, createTime: date };
}

describe("studyStreak", () => {
  it("连续多日含今天", () => {
    expect(studyStreak([log("2026-10-27T09:00:00"), log("2026-10-26T20:00:00"), log("2026-10-25T08:00:00")], REF)).toBe(3);
  });

  it("今天未学从昨天起算不算断档", () => {
    expect(studyStreak([log("2026-10-26T20:00:00"), log("2026-10-25T08:00:00")], REF)).toBe(2);
  });

  it("中间断档清零", () => {
    expect(studyStreak([log("2026-10-27T09:00:00"), log("2026-10-25T08:00:00")], REF)).toBe(1);
  });

  it("昨天未学今天新学", () => {
    expect(studyStreak([log("2026-10-27T09:00:00")], REF)).toBe(1);
  });

  it("空日志为 0", () => {
    expect(studyStreak([], REF)).toBe(0);
  });
});

describe("reviewForecast", () => {
  function sched(due: string): ReviewSchedule {
    return { id: 1, kpId: null, qId: null, stage: 0, dueTime: due, easeFactor: 2.5, intervalDays: 0, lastReviewTime: null, reviewTimes: 0 };
  }

  it("按天计数与标签（生产纯日期格式）", () => {
    const out = reviewForecast(
      [sched("2026-10-27"), sched("2026-10-27"), sched("2026-10-28"), sched("2026-10-30")],
      7,
      REF,
    );
    expect(out).toHaveLength(7);
    expect(out[0]).toMatchObject({ label: "今天", count: 2 });
    expect(out[1]).toMatchObject({ label: "明天", count: 1 });
    expect(out[3]).toMatchObject({ label: "周五", count: 1 });
    expect(out.reduce((s, d) => s + d.count, 0)).toBe(4);
  });

  it("过期与超窗口不计", () => {
    const out = reviewForecast([sched("2026-10-20"), sched("2026-11-05")], 7, REF);
    expect(out.reduce((s, d) => s + d.count, 0)).toBe(0);
  });

  it("非法 dueTime 跳过", () => {
    const out = reviewForecast([sched("not-a-date"), sched(""), sched("NaN")], 7, REF);
    expect(out.reduce((s, d) => s + d.count, 0)).toBe(0);
  });
});

describe("wrongSnapshot", () => {
  function wrong(partial: Partial<WrongQuestion>): WrongQuestion {
    return {
      id: 1, recordId: null, qId: 1, reviewTimes: 1, createTime: "2026-10-25T10:00:00",
      status: "active", correctStreak: 0, graduatedAt: null, ...partial,
    };
  }

  it("在管 / 本周新增 / 接近毕业", () => {
    const list = [
      wrong({ id: 1, correctStreak: 1 }), // 在管 + 本周 + 快毕业（阈值 2，streak 1）
      wrong({ id: 2, correctStreak: 0 }), // 在管 + 本周
      wrong({ id: 3, status: "graduated", graduatedAt: "2026-10-26T10:00:00", correctStreak: 2 }), // 已毕业不计在管
      wrong({ id: 4, createTime: "2026-10-01T10:00:00" }), // 在管，非本周
    ];
    expect(wrongSnapshot(list, REF)).toEqual({ active: 3, weekNew: 3, nearGraduate: 1 });
  });

  it("旧数据缺省 status 按 active 处理", () => {
    const list = [{ id: 1, recordId: null, qId: 1, reviewTimes: 1, createTime: "2026-10-25T10:00:00" } as WrongQuestion];
    expect(wrongSnapshot(list, REF).active).toBe(1);
  });

  it("空列表全 0", () => {
    expect(wrongSnapshot([], REF)).toEqual({ active: 0, weekNew: 0, nearGraduate: 0 });
  });
});

describe("capStudySec", () => {
  it("封顶与取整", () => {
    expect(capStudySec(120)).toBe(120);
    expect(capStudySec(99999)).toBe(MAX_ITEM_STUDY_SEC);
    expect(capStudySec(-5)).toBe(0);
    expect(capStudySec(59.6)).toBe(60);
  });
});
