import { describe, expect, it } from "vitest";
import { createEmptyData } from "../../../core/src/types/appData";
import type { AppData, StudyLog, AnswerRecord } from "../../../core/src/types/appData";
import { applyRetention, getRetentionDays, localDateOfSafe } from "../retention";

// 固定 ref = 本地 2026-10-28，保留 90 天 → cutoffDay = 本地 2026-07-30（该天保留，之前归档）
const REF = new Date(2026, 9, 28);

/** 本地日期 → ISO 字符串（正午构造，避免时区边界漂移） */
function localIso(year: number, month: number, day: number): string {
  return new Date(year, month - 1, day, 12).toISOString();
}

function baseData(): AppData {
  const data = createEmptyData();
  data.courses = [
    { id: 1, siyuanDocId: "doc1", name: "课程一", description: "", target: "", totalCycle: "", status: "active", createTime: "2026-01-01T00:00:00Z" },
  ];
  data.questions = [
    { id: 10, courseId: 1, kpIds: "", title: "单", options: "[]", answer: "A", analysis: "", qType: "single", difficulty: "easy", source: "manual", paperId: null, createTime: "2026-01-01T00:00:00Z" },
    { id: 11, courseId: 1, kpIds: "", title: "简", options: "[]", answer: "要", analysis: "", qType: "essay", difficulty: "easy", source: "manual", paperId: null, createTime: "2026-01-01T00:00:00Z" },
  ];
  return data;
}

function log(id: number, day: [number, number, number], duration: number, courseId = 1): StudyLog {
  return { id, courseId, kpId: null, taskId: null, action: "quiz", duration, createTime: localIso(day[0], day[1], day[2]) };
}

function rec(id: number, qId: number, isCorrect: boolean, score: string, day: [number, number, number], assisted?: boolean): AnswerRecord {
  return { id, qId, userAnswer: "x", isCorrect, score, createTime: localIso(day[0], day[1], day[2]), ...(assisted ? { assisted: true } : {}) };
}

describe("getRetentionDays", () => {
  it("缺失/非法值按 90，0 保留", () => {
    expect(getRetentionDays({})).toBe(90);
    expect(getRetentionDays(undefined)).toBe(90);
    expect(getRetentionDays(null)).toBe(90);
    expect(getRetentionDays({ studyRetentionDays: -5 })).toBe(90);
    expect(getRetentionDays({ studyRetentionDays: 180 })).toBe(180);
    expect(getRetentionDays({ studyRetentionDays: 0 })).toBe(0);
  });
});

describe("localDateOfSafe", () => {
  it("非法时间返回 null", () => {
    expect(localDateOfSafe("not-a-date")).toBeNull();
    expect(localDateOfSafe("")).toBeNull();
  });
});

describe("applyRetention（studyLogs）", () => {
  it("归档边界：cutoffDay（07-30）当天保留，之前归档", () => {
    const data = baseData();
    data.studyLogs = [
      log(1, [2026, 7, 30], 60), // cutoffDay 当天 → 保留
      log(2, [2026, 7, 29], 30), // 归档
      log(3, [2026, 10, 27], 120), // 近期 → 保留
    ];
    const n = applyRetention(data, REF);
    expect(n).toBe(1);
    expect(data.studyLogs.map((l) => l.id)).toEqual([1, 3]);
    expect(data.studyLogMonthly).toEqual([
      { courseId: 1, month: "2026-07", seconds: 30, actions: 1, lastDay: "2026-07-29" },
    ]);
  });

  it("跨月归档各自成月；0 秒/负数不计时但计动作；与既有聚合合并", () => {
    const data = baseData();
    data.studyLogMonthly = [
      { courseId: 1, month: "2026-06", seconds: 10, actions: 2, lastDay: "2026-06-05" },
    ];
    data.studyLogs = [
      log(1, [2026, 6, 15], 0),
      log(2, [2026, 6, 20], 100),
      log(3, [2026, 7, 10], -5),
    ];
    const n = applyRetention(data, REF);
    expect(n).toBe(3);
    expect(data.studyLogs).toEqual([]);
    expect(data.studyLogMonthly).toHaveLength(2);
    const june = data.studyLogMonthly.find((m) => m.month === "2026-06");
    const july = data.studyLogMonthly.find((m) => m.month === "2026-07");
    expect(june).toEqual({ courseId: 1, month: "2026-06", seconds: 10 + 0 + 100, actions: 2 + 2, lastDay: "2026-06-20" });
    expect(july).toEqual({ courseId: 1, month: "2026-07", seconds: 0, actions: 1, lastDay: "2026-07-10" });
  });

  it("永久保留（0 天）不归档；幂等：二次执行返回 0", () => {
    const data = baseData();
    data.settings.studyRetentionDays = 0;
    data.studyLogs = [log(1, [2020, 1, 1], 60)];
    expect(applyRetention(data, REF)).toBe(0);
    expect(data.studyLogs).toHaveLength(1);

    const data2 = baseData();
    data2.studyLogs = [log(1, [2020, 1, 1], 60)];
    expect(applyRetention(data2, REF)).toBe(1);
    expect(applyRetention(data2, REF)).toBe(0);
    expect(data2.studyLogs).toEqual([]);
  });

  it("非法 createTime 不归档", () => {
    const data = baseData();
    data.studyLogs = [
      { id: 1, courseId: 1, kpId: null, taskId: null, action: "quiz", duration: 60, createTime: "bad" },
    ];
    expect(applyRetention(data, REF)).toBe(0);
    expect(data.studyLogs).toHaveLength(1);
  });
});

describe("applyRetention（answerRecords）", () => {
  it("归档归属题目所属课程；简答仅统计现存 essay 题的可解析得分；题目已删的记录直接丢弃（报表口径本就不统计）", () => {
    const data = baseData();
    data.answerRecords = [
      rec(1, 10, true, "100", [2026, 6, 1]), // 单题答对
      rec(2, 11, false, "75", [2026, 6, 2]), // 简答 75
      rec(3, 999, true, "100", [2026, 6, 3]), // 题目已删 → 丢弃
      rec(4, 11, true, "N/A", [2026, 10, 27]), // 保留期内
    ];
    const n = applyRetention(data, REF);
    expect(n).toBe(2);
    expect(data.answerRecords.map((r) => r.id)).toEqual([4]);
    expect(data.answerStatsMonthly).toEqual([
      { courseId: 1, month: "2026-06", total: 2, correct: 1, essayTotalScore: 75, essayCount: 1, assistedTotal: 0, assistedCorrect: 0 },
    ]);
  });

  it("受助口径：assisted 记录单独计数，答对再细分；与旧归档（缺字段）合并不产生 NaN", () => {
    const data = baseData();
    // 旧归档无受助字段（旧数据形态）
    data.answerStatsMonthly = [
      { courseId: 1, month: "2026-05", total: 3, correct: 2, essayTotalScore: 0, essayCount: 0 },
    ];
    data.answerRecords = [
      rec(1, 10, true, "100", [2026, 6, 1], true), // 受助对
      rec(2, 10, false, "0", [2026, 6, 2], true), // 受助错
      rec(3, 10, true, "100", [2026, 6, 3]), // 独立对
    ];
    const n = applyRetention(data, REF);
    expect(n).toBe(3);
    expect(data.answerStatsMonthly).toHaveLength(2);
    const june = data.answerStatsMonthly.find((m) => m.month === "2026-06");
    expect(june).toEqual({ courseId: 1, month: "2026-06", total: 3, correct: 2, essayTotalScore: 0, essayCount: 0, assistedTotal: 2, assistedCorrect: 1 });
    // 旧归档归一化：缺失受助字段补 0（不产生 NaN）
    const may = data.answerStatsMonthly.find((m) => m.month === "2026-05");
    expect(may).toEqual({ courseId: 1, month: "2026-05", total: 3, correct: 2, essayTotalScore: 0, essayCount: 0, assistedTotal: 0, assistedCorrect: 0 });
  });

  it("保留期内的记录不受影响", () => {
    const data = baseData();
    data.answerRecords = [rec(1, 10, true, "100", [2026, 10, 27])];
    expect(applyRetention(data, REF)).toBe(0);
    expect(data.answerStatsMonthly).toEqual([]);
  });
});
