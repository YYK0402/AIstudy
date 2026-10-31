import { describe, expect, it } from "vitest";
import { countPlanDays, distributeKpsByDay } from "../planSchedule";

describe("countPlanDays", () => {
  it("含首尾两天", () => {
    expect(countPlanDays("2026-10-01", "2026-10-01")).toBe(1);
    expect(countPlanDays("2026-10-01", "2026-10-03")).toBe(3);
  });

  it("目标日早于开始日时至少 1 天", () => {
    expect(countPlanDays("2026-10-03", "2026-10-01")).toBe(1);
  });
});

describe("distributeKpsByDay", () => {
  const kps = [1, 2, 3, 4, 5];

  it("知识点均分到每天", () => {
    const out = distributeKpsByDay(kps, 2, "2026-10-01");
    expect(out.map((d) => d.date)).toEqual(["2026-10-01", "2026-10-02"]);
    expect(out[0].kps).toEqual([1, 2, 3]);
    expect(out[1].kps).toEqual([4, 5]);
  });

  it("知识点少于天数时后段为空", () => {
    const out = distributeKpsByDay([1], 3, "2026-10-30");
    expect(out).toHaveLength(3);
    expect(out.map((d) => d.kps)).toEqual([[1], [], []]);
    expect(out.map((d) => d.date)).toEqual(["2026-10-30", "2026-10-31", "2026-11-01"]);
  });
});
