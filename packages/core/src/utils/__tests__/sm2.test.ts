import { describe, expect, it } from "vitest";
import { nextSm2 } from "../sm2";

const base = { stage: 1, intervalDays: 1, easeFactor: 2.5 };

describe("nextSm2", () => {
  it("忘了：重置到一阶并降低难度因子", () => {
    expect(nextSm2({ stage: 5, intervalDays: 20, easeFactor: 2.5 }, 0)).toEqual({
      stage: 1,
      intervalDays: 1,
      easeFactor: 2.3,
    });
  });

  it("模糊（n=3）：升阶、因子下调", () => {
    expect(nextSm2(base, 3)).toEqual({ stage: 2, intervalDays: 1, easeFactor: 2.36 });
  });

  it("牢固（n=5）：按新因子拉长间隔", () => {
    expect(nextSm2({ stage: 2, intervalDays: 1, easeFactor: 2.5 }, 5)).toEqual({
      stage: 3,
      intervalDays: 3,
      easeFactor: 2.6,
    });
  });

  it("难度因子下限 1.3", () => {
    expect(nextSm2({ stage: 1, intervalDays: 1, easeFactor: 1.35 }, 0).easeFactor).toBe(1.3);
  });

  it("难度因子上限 2.8", () => {
    expect(nextSm2({ stage: 3, intervalDays: 5, easeFactor: 2.75 }, 5).easeFactor).toBe(2.8);
  });

  it("阶数上限 8", () => {
    const next = nextSm2({ stage: 8, intervalDays: 100, easeFactor: 2.5 }, 5);
    expect(next.stage).toBe(8);
    expect(next.intervalDays).toBe(260);
  });

  it("较差（n=1/2）一律重置到一阶并降低难度因子（U6，对齐标准 SM-2）", () => {
    expect(nextSm2({ stage: 5, intervalDays: 20, easeFactor: 2.5 }, 1)).toEqual({
      stage: 1,
      intervalDays: 1,
      easeFactor: 2.3,
    });
    expect(nextSm2({ stage: 3, intervalDays: 7, easeFactor: 2.5 }, 2)).toEqual({
      stage: 1,
      intervalDays: 1,
      easeFactor: 2.3,
    });
  });

  it("非法评分（非整数 / 越界）抛错（U6）", () => {
    expect(() => nextSm2(base, -1)).toThrow();
    expect(() => nextSm2(base, 6)).toThrow();
    expect(() => nextSm2(base, 2.5)).toThrow();
  });
});
