import { describe, expect, it } from "vitest";
import { resumeShiftDays, shiftPlanTasksForward } from "../plan";
import type { StudyPlan, StudyTask } from "../../types/appData";

const plan = (over: Partial<StudyPlan> = {}): StudyPlan => ({
  id: 1,
  courseId: 1,
  planContent: "",
  status: "active",
  targetDate: "2026-11-20",
  dailyHour: "2",
  createTime: "2026-10-15T00:00:00.000Z",
  ...over,
});

const task = (over: Partial<StudyTask> = {}): StudyTask => ({
  id: 1,
  planId: 1,
  chapterId: null,
  kpId: null,
  taskType: "learn",
  title: "t",
  scheduledDate: "2026-10-20",
  status: "todo",
  sort: 1,
  ...over,
});

describe("resumeShiftDays", () => {
  it("暂停日到今天的天数", () => {
    expect(resumeShiftDays("2026-10-20", "2026-10-20")).toBe(0);
    expect(resumeShiftDays("2026-10-20", "2026-10-21")).toBe(1);
    expect(resumeShiftDays("2026-10-20", "2026-10-30")).toBe(10);
    expect(resumeShiftDays("2026-10-15", "2026-11-15")).toBe(31);
  });

  it("pausedAt 缺失为 0；异常（今天早于暂停日）收敛为 0", () => {
    expect(resumeShiftDays(undefined, "2026-10-30")).toBe(0);
    expect(resumeShiftDays("2026-11-01", "2026-10-30")).toBe(0);
  });
});

describe("shiftPlanTasksForward", () => {
  it("未完成任务与目标日期整体后移 n 天，返回影响条数", () => {
    const p = plan();
    const ts = [task({ id: 1, scheduledDate: "2026-10-20" }), task({ id: 2, scheduledDate: "2026-10-30" })];
    expect(shiftPlanTasksForward(p, ts, 5)).toBe(2);
    expect(ts.map((t) => t.scheduledDate)).toEqual(["2026-10-25", "2026-11-04"]); // 含跨月
    expect(p.targetDate).toBe("2026-11-25");
  });

  it("已完成任务不动", () => {
    const p = plan();
    const ts = [task({ id: 1, status: "done" }), task({ id: 2, status: "todo" })];
    expect(shiftPlanTasksForward(p, ts, 3)).toBe(1);
    expect(ts[0].scheduledDate).toBe("2026-10-20");
    expect(ts[1].scheduledDate).toBe("2026-10-23");
  });

  it("只影响本计划的未完成任务", () => {
    const p = plan();
    const ts = [
      task({ id: 1, planId: 99, status: "todo" }),
      task({ id: 2, status: "todo" }),
    ];
    expect(shiftPlanTasksForward(p, ts, 2)).toBe(1);
    expect(ts[0].scheduledDate).toBe("2026-10-20");
    expect(ts[1].scheduledDate).toBe("2026-10-22");
  });

  it("n <= 0 无操作（同日恢复）", () => {
    const p = plan();
    const ts = [task()];
    expect(shiftPlanTasksForward(p, ts, 0)).toBe(0);
    expect(ts[0].scheduledDate).toBe("2026-10-20");
    expect(p.targetDate).toBe("2026-11-20");
  });

  it("含已过期任务：相对欠账不变", () => {
    const p = plan();
    const ts = [task({ id: 1, scheduledDate: "2026-10-24" })]; // 暂停日 10-25 时已过期 1 天
    expect(shiftPlanTasksForward(p, ts, 10)).toBe(1);
    // 恢复日 11-04：10-24 + 10 = 11-03，仍恰差 1 天
    expect(ts[0].scheduledDate).toBe("2026-11-03");
  });
});
