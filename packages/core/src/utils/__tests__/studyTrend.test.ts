import { describe, expect, it } from "vitest";
import type { StudyLog } from "../../types/appData";
import { aggregateStudyTrend, formatDuration } from "../studyTrend";

describe("formatDuration", () => {
  it("秒/分钟/小时/X小时Y分 四档", () => {
    expect(formatDuration(59)).toBe("59 秒");
    expect(formatDuration(60)).toBe("1 分钟");
    // 分钟先四舍五入：3599s → 60 分 → 进小时档
    expect(formatDuration(3539)).toBe("59 分钟");
    expect(formatDuration(3599)).toBe("1 小时");
    expect(formatDuration(3600)).toBe("1 小时");
    expect(formatDuration(5400)).toBe("1 小时 30 分");
  });

  it("负数与小数：夹到 0 并四舍五入", () => {
    expect(formatDuration(-10)).toBe("0 秒");
    expect(formatDuration(59.6)).toBe("1 分钟");
  });
});

function logAt(dateKey: string, seconds: number, id: number): StudyLog {
  // 本地日期字符串构造（与生产 localDateOf 口径一致）
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(y, m - 1, d, 12, 0, 0);
  return {
    id,
    courseId: 1,
    kpId: null,
    taskId: null,
    action: "study",
    duration: seconds,
    createTime: dt.toISOString(),
  };
}

describe("aggregateStudyTrend", () => {
  const REF = new Date(2026, 10, 1, 12, 0, 0); // 2026-11-01 本地

  it("按本地日期聚合，返回最近 days 天（含 ref 当天）且倒推窗口", () => {
    const logs = [logAt("2026-11-01", 100, 1), logAt("2026-10-31", 50, 2)];
    const r = aggregateStudyTrend(logs, 3, REF);
    expect(r.daily.map((d) => d.date)).toEqual(["2026-10-30", "2026-10-31", "2026-11-01"]);
    expect(r.daily[1].seconds).toBe(50);
    expect(r.daily[2].seconds).toBe(100);
    expect(r.totalSeconds).toBe(150);
  });

  it("窗口外日期不计入", () => {
    const r = aggregateStudyTrend([logAt("2026-10-01", 999, 1)], 3, REF);
    expect(r.totalSeconds).toBe(0);
  });

  it("duration 仅累加正数（0/负数计动作不计时长）", () => {
    const r = aggregateStudyTrend(
      [logAt("2026-11-01", 0, 1), logAt("2026-11-01", -5, 2), logAt("2026-11-01", 30, 3)],
      1,
      REF,
    );
    expect(r.daily[0].seconds).toBe(30);
    expect(r.daily[0].actions).toBe(3);
  });

  it("非法 createTime 跳过", () => {
    const r = aggregateStudyTrend(
      [{ ...logAt("2026-11-01", 10, 1), createTime: "not-a-date" }],
      1,
      REF,
    );
    expect(r.daily[0].seconds).toBe(0);
    expect(r.daily[0].actions).toBe(0);
  });
});
