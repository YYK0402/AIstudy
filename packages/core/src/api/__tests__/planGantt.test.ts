import { describe, expect, it } from "vitest";
import {
  addDaysLocal,
  addMonthsLocal,
  addYearsLocal,
  buildGanttModel,
  dowOf,
  monthRangeOf,
  mondayOf,
  quarterRangeOf,
  weekRangeOf,
} from "../planGantt";
import type { Chapter, KnowledgePoint, StudyPlan, StudyTask } from "../../types/appData";

function makePlan(over: Partial<StudyPlan> = {}): StudyPlan {
  return {
    id: 1,
    courseId: 1,
    planContent: "",
    targetDate: "2026-10-10",
    dailyHour: "2",
    createTime: "2026-10-01T00:00:00.000Z",
    ...over,
  };
}

function makeChapter(over: Partial<Chapter> = {}): Chapter {
  return {
    id: 1,
    courseId: 1,
    parentId: null,
    siyuanBlockId: null,
    name: "第一章",
    level: "chapter",
    sort: 1,
    ...over,
  };
}

function makeKp(over: Partial<KnowledgePoint> = {}): KnowledgePoint {
  return {
    id: 1,
    courseId: 1,
    chapterId: 1,
    blockId: null,
    name: "知识点一",
    content: "",
    mastery: "unlearn",
    sourceAssetIds: "",
    prevKpIds: "",
    chapterName: "第一章",
    sort: 1,
    createTime: "2026-10-01T00:00:00.000Z",
    ...over,
  };
}

function makeTask(over: Partial<StudyTask> = {}): StudyTask {
  return {
    id: 1,
    planId: 1,
    chapterId: 1,
    kpId: 1,
    taskType: "learn",
    title: "学习",
    scheduledDate: "2026-10-01",
    status: "todo",
    sort: 1,
    ...over,
  };
}

const TODAY = "2026-10-05";

describe("addDaysLocal", () => {
  it("跨月", () => {
    expect(addDaysLocal("2026-10-31", 1)).toBe("2026-11-01");
  });
  it("跨年", () => {
    expect(addDaysLocal("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("回退", () => {
    expect(addDaysLocal("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("dowOf / mondayOf", () => {
  it("2026-10-01 是周四（dow=3），所在周周一为 09-28", () => {
    expect(dowOf("2026-10-01")).toBe(3);
    expect(mondayOf("2026-10-01")).toBe("2026-09-28");
  });
  it("周一 dow=0，mondayOf 返回自身", () => {
    expect(dowOf("2026-10-05")).toBe(0);
    expect(mondayOf("2026-10-05")).toBe("2026-10-05");
  });
});

describe("区间/翻页辅助函数", () => {
  it("monthRangeOf / quarterRangeOf / weekRangeOf", () => {
    expect(monthRangeOf("2026-10-15")).toEqual({ start: "2026-10-01", end: "2026-10-31" });
    expect(quarterRangeOf("2026-10-15")).toEqual({ start: "2026-10-01", end: "2026-12-31" });
    expect(quarterRangeOf("2026-01-31")).toEqual({ start: "2026-01-01", end: "2026-03-31" });
    // 2026-10-15 是周四，所在周周一为 10-12
    expect(weekRangeOf("2026-10-15")).toEqual({ start: "2026-10-12", end: "2026-10-18" });
  });

  it("addMonthsLocal 跨月/跨年/月末收敛", () => {
    expect(addMonthsLocal("2026-10-15", 1)).toBe("2026-11-15");
    expect(addMonthsLocal("2026-10-15", -10)).toBe("2025-12-15");
    expect(addMonthsLocal("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsLocal("2024-01-31", 1)).toBe("2024-02-29"); // 闰年
  });

  it("addYearsLocal 跨年/2-29 收敛", () => {
    expect(addYearsLocal("2026-10-15", 1)).toBe("2027-10-15");
    expect(addYearsLocal("2026-10-15", -2)).toBe("2024-10-15");
    expect(addYearsLocal("2024-02-29", 1)).toBe("2025-02-28");
  });
});

describe("buildGanttModel", () => {
  it("日期范围 = 计划区间；任务越界时扩展", () => {
    const m = buildGanttModel(makePlan({ startDate: "2026-10-01" }), [makeTask({ scheduledDate: "2026-09-30" })], [], [], TODAY);
    expect(m.start).toBe("2026-09-30");
    expect(m.end).toBe("2026-10-10");
  });

  it("开始日晚于目标日时交换", () => {
    const m = buildGanttModel(makePlan({ startDate: "2026-10-10", targetDate: "2026-10-01" }), [], [], [], TODAY);
    expect(m.start).toBe("2026-10-01");
    expect(m.end).toBe("2026-10-10");
  });

  it("月份表头分段与年份标注", () => {
    const m = buildGanttModel(makePlan({ startDate: "2026-10-28", targetDate: "2026-12-02" }), [], [], [], TODAY);
    expect(m.months.map((x) => x.label)).toEqual(["2026年10月", "11月", "12月"]);
    expect(m.months[0]).toMatchObject({ start: 0, count: 4 });
    expect(m.months[1]).toMatchObject({ start: 4, count: 30 });
    expect(m.months[2]).toMatchObject({ start: 34, count: 2 });
  });

  it("跨年时新年首月带年份", () => {
    const m = buildGanttModel(makePlan({ startDate: "2026-12-30", targetDate: "2027-01-02" }), [], [], [], TODAY);
    expect(m.months.map((x) => x.label)).toEqual(["2026年12月", "2027年1月"]);
  });

  it("周表头周一对齐分段；weekShift = 起始日到周一天数", () => {
    // 2026-10-15 周四 → weekShift=3；首段 10-15~10-18（4 天）周一为 10-12
    const m = buildGanttModel(makePlan({ startDate: "2026-10-15", targetDate: "2026-11-20" }), [], [], [], TODAY);
    expect(m.weekShift).toBe(3);
    expect(m.weeks.map((w) => [w.label, w.start, w.count])).toEqual([
      ["10/12", 0, 4],
      ["10/19", 4, 7],
      ["10/26", 11, 7],
      ["11/02", 18, 7],
      ["11/09", 25, 7],
      ["11/16", 32, 5],
    ]);
  });

  it("起始日即周一时 weekShift=0 且首段完整 7 天", () => {
    const m = buildGanttModel(makePlan({ startDate: "2026-10-05", targetDate: "2026-10-18" }), [], [], [], TODAY);
    expect(m.weekShift).toBe(0);
    expect(m.weeks).toEqual([
      { label: "10/05", start: 0, count: 7 },
      { label: "10/12", start: 7, count: 7 },
    ]);
  });

  it("todayIndex 在区间内/外", () => {
    const inRange = buildGanttModel(makePlan({ startDate: "2026-10-01", targetDate: "2026-10-10" }), [], [], [], TODAY);
    expect(inRange.todayIndex).toBe(4);
    const outRange = buildGanttModel(makePlan({ startDate: "2026-11-01", targetDate: "2026-11-10" }), [], [], [], TODAY);
    expect(outRange.todayIndex).toBe(-1);
  });

  it("KP 行：单元格聚合、条范围、完成数、过期数", () => {
    const tasks = [
      makeTask({ id: 1, scheduledDate: "2026-10-01", status: "done" }),
      makeTask({ id: 2, scheduledDate: "2026-10-02", taskType: "practice", status: "todo" }),
      makeTask({ id: 3, scheduledDate: "2026-10-04", taskType: "review", status: "todo" }),
    ];
    const m = buildGanttModel(makePlan({ startDate: "2026-10-01" }), tasks, [], [makeKp()], TODAY);
    const row = m.chapters[0].rows[0];
    expect(row.key).toBe("kp:1");
    expect(row.cells.map((c) => c.start)).toEqual(["2026-10-01", "2026-10-02", "2026-10-04"]);
    expect(row.barStart).toBe("2026-10-01");
    expect(row.barEnd).toBe("2026-10-04");
    expect(row.total).toBe(3);
    expect(row.done).toBe(1);
    expect(row.overdue).toBe(2); // 10-02、10-04 均早于今天且未完成（10-01 已完成不算）
    expect(row.cells[1].overdue).toBe(true);
    expect(row.cells[2].overdue).toBe(true);
    expect(row.cells[0].overdue).toBe(false);
  });

  it("单元格多类型分段按 学→练→复→测 排序", () => {
    const tasks = [
      makeTask({ id: 1, taskType: "test" }),
      makeTask({ id: 2, taskType: "learn" }),
      makeTask({ id: 3, taskType: "practice" }),
      makeTask({ id: 4, taskType: "review" }),
    ];
    const m = buildGanttModel(makePlan({ startDate: "2026-10-01", targetDate: "2026-10-01" }), tasks, [], [makeKp()], TODAY);
    const cell = m.chapters[0].rows[0].cells[0];
    expect(cell.segments.map((s) => s.type)).toEqual(["learn", "practice", "review", "test"]);
    expect(cell.total).toBe(4);
  });

  it("章 → 节 → KP 分组顺序（教材序），章直属排节后", () => {
    const chs = [
      makeChapter({ id: 1, name: "第一章", sort: 1 }),
      makeChapter({ id: 2, name: "第二节", parentId: 1, level: "unit", sort: 2 }),
      makeChapter({ id: 3, name: "第一章A", sort: 0 }),
    ];
    const kps = [
      makeKp({ id: 10, name: "KP-节", chapterId: 2, sort: 2 }),
      makeKp({ id: 11, name: "KP-直属", chapterId: 1, sort: 1 }),
      makeKp({ id: 12, name: "KP-首章", chapterId: 3, sort: 1 }),
    ];
    const tasks = [makeTask({ kpId: 10, chapterId: 2 }), makeTask({ kpId: 11, chapterId: 1 }), makeTask({ kpId: 12, chapterId: 3 })];
    const m = buildGanttModel(makePlan({ startDate: "2026-10-01" }), tasks, chs, kps, TODAY);
    expect(m.chapters.map((c) => c.name)).toEqual(["第一章A", "第一章"]);
    const ch = m.chapters[1];
    expect(ch.units.map((u) => u.name)).toEqual(["第二节", null]);
    expect(ch.units[0].rows.map((r) => r.name)).toEqual(["KP-节"]);
    expect(ch.units[1].rows.map((r) => r.name)).toEqual(["KP-直属"]);
  });

  it("无 KP 任务归入测评/其他行，落在所属章", () => {
    const tasks = [
      makeTask({ id: 1, kpId: null, chapterId: 1, taskType: "test", title: "章测" }),
      makeTask({ id: 2, kpId: null, chapterId: 1, taskType: "review", title: "整体复习" }),
    ];
    const m = buildGanttModel(makePlan({ startDate: "2026-10-01" }), tasks, [makeChapter()], [], TODAY);
    const rows = m.chapters[0].rows;
    expect(rows.map((r) => r.name)).toEqual(["其他任务", "测评"]);
    expect(rows[0].kind).toBe("other");
    expect(rows[1].kind).toBe("test");
    expect(rows[1].key).toBe("test:1");
  });

  it("悬空 kpId 成行且名称带已删除", () => {
    const tasks = [makeTask({ kpId: 99, chapterId: 1 })];
    const m = buildGanttModel(makePlan({ startDate: "2026-10-01" }), tasks, [makeChapter()], [], TODAY);
    const row = m.chapters[0].rows[0];
    expect(row.name).toBe("#99（已删除）");
    expect(row.kind).toBe("kp");
  });

  it("未归入任何章的归「未分组」", () => {
    const tasks = [makeTask({ kpId: 5, chapterId: 77 })];
    const m = buildGanttModel(makePlan({ startDate: "2026-10-01" }), tasks, [makeChapter()], [makeKp({ id: 5, chapterId: 77 })], TODAY);
    expect(m.chapters.map((c) => c.name)).toEqual(["未分组"]);
  });

  it("未排期 KP 不出现；空任务时章不出现", () => {
    const m = buildGanttModel(
      makePlan({ startDate: "2026-10-01" }),
      [makeTask({ kpId: 1 })],
      [makeChapter()],
      [makeKp({ id: 1 }), makeKp({ id: 2, name: "无任务KP" })],
      TODAY,
    );
    expect(m.chapters[0].rows.map((r) => r.name)).toEqual(["知识点一"]);
    const empty = buildGanttModel(makePlan({ startDate: "2026-10-01" }), [], [makeChapter()], [makeKp()], TODAY);
    expect(empty.chapters).toEqual([]);
    expect(empty.dates).toHaveLength(10);
  });

  it("章聚合 total/done/overdue 等于行之和", () => {
    const tasks = [
      makeTask({ id: 1, scheduledDate: "2026-10-01", status: "done" }),
      makeTask({ id: 2, scheduledDate: "2026-10-02", taskType: "practice", kpId: 2, chapterId: 1 }),
    ];
    const m = buildGanttModel(makePlan({ startDate: "2026-10-01" }), tasks, [makeChapter()], [makeKp(), makeKp({ id: 2, name: "KP2" })], TODAY);
    const ch = m.chapters[0];
    expect(ch.total).toBe(2);
    expect(ch.done).toBe(1);
    expect(ch.overdue).toBe(1);
    expect(ch.rows).toHaveLength(2);
  });

  it("聚焦区间过滤任务：区间外的行/单元格不出现", () => {
    const tasks = [
      makeTask({ id: 1, scheduledDate: "2026-10-01", kpId: 1 }),
      makeTask({ id: 2, scheduledDate: "2026-10-08", kpId: 2 }),
    ];
    const m = buildGanttModel(
      makePlan({ startDate: "2026-10-01", targetDate: "2026-10-10" }),
      tasks,
      [makeChapter()],
      [makeKp(), makeKp({ id: 2, name: "KP2" })],
      TODAY,
      { colUnit: "day", range: { start: "2026-10-06", end: "2026-10-10" } },
    );
    expect(m.start).toBe("2026-10-06");
    expect(m.end).toBe("2026-10-10");
    expect(m.chapters[0].rows.map((r) => r.name)).toEqual(["KP2"]); // KP1 任务在区间外
  });

  it("周列（季度聚焦）：完整 ISO 周、首尾周可越界、多天任务聚合进同一周列", () => {
    // 2026 Q4：10-01(周四) 所在周周一=09-28；12-31(周四) 所在周周一=12-28
    const tasks = [
      makeTask({ id: 1, scheduledDate: "2026-10-14" }), // 周三，周一=10-12 周
      makeTask({ id: 2, scheduledDate: "2026-10-16", taskType: "practice" }), // 周五，同周
      makeTask({ id: 3, scheduledDate: "2026-12-01", taskType: "review" }), // 同周 11-30
    ];
    const m = buildGanttModel(
      makePlan({ startDate: "2026-10-01", targetDate: "2026-12-31" }),
      tasks,
      [makeChapter()],
      [makeKp()],
      "2026-10-29",
      { colUnit: "week", range: { start: "2026-10-01", end: "2026-12-31" } },
    );
    expect(m.colUnit).toBe("week");
    expect(m.columns[0]).toMatchObject({ start: "2026-09-28", end: "2026-10-04", label: "09/28" });
    expect(m.columns[m.columns.length - 1]).toMatchObject({ start: "2026-12-28", end: "2027-01-03", label: "12/28" });
    // 09-28,10-05,10-12,10-19,10-26,11-02,11-09,11-16,11-23,11-30,12-07,12-14,12-21,12-28 = 14 周
    expect(m.columns).toHaveLength(14);
    // 10-14 与 10-16 同周（周一 10-12）聚合成一个单元格
    const row = m.chapters[0].rows[0];
    expect(row.cells).toHaveLength(2);
    const firstCell = row.cells[0];
    expect(firstCell.start).toBe("2026-10-12");
    expect(firstCell.end).toBe("2026-10-18");
    expect(firstCell.total).toBe(2);
    expect(firstCell.segments.map((s) => s.type)).toEqual(["learn", "practice"]);
    // barCol 范围 = 首末有任务列
    expect(row.barColStart).toBe(2); // 10-12 周是第 3 列（09-28, 10-05, 10-12）
    expect(row.barColEnd).toBe(9); // 11-30 周
  });

  it("月列（年度聚焦）：12 个月列、首月带年份、整月任务聚合", () => {
    const tasks = [
      makeTask({ id: 1, scheduledDate: "2026-10-14" }),
      makeTask({ id: 2, scheduledDate: "2026-10-28", taskType: "practice" }),
      makeTask({ id: 3, scheduledDate: "2027-01-05", taskType: "review" }),
    ];
    const m = buildGanttModel(
      makePlan({ startDate: "2026-01-01", targetDate: "2026-12-31" }),
      tasks,
      [makeChapter()],
      [makeKp()],
      "2026-10-29",
      { colUnit: "month", range: { start: "2026-01-01", end: "2026-12-31" } },
    );
    expect(m.colUnit).toBe("month");
    expect(m.columns).toHaveLength(12);
    expect(m.columns[0]).toMatchObject({ start: "2026-01-01", end: "2026-01-31", label: "2026年1月" });
    expect(m.columns[9]).toMatchObject({ start: "2026-10-01", end: "2026-10-31", label: "10月" });
    // 10 月两个任务聚合成一个月单元格；2027-01 任务在区间外被过滤
    const row = m.chapters[0].rows[0];
    expect(row.cells).toHaveLength(1);
    expect(row.cells[0].start).toBe("2026-10-01");
    expect(row.cells[0].total).toBe(2);
  });

  it("todayFrac：天列=0.5，周列=(星期+0.5)/7，月列=(日-0.5)/月天数", () => {
    const day = buildGanttModel(makePlan({ startDate: "2026-10-01", targetDate: "2026-10-10" }), [], [], [], TODAY);
    expect(day.todayIndex).toBe(4);
    expect(day.todayFrac).toBeCloseTo(0.5);
    const week = buildGanttModel(
      makePlan({ startDate: "2026-10-01", targetDate: "2026-12-31" }),
      [],
      [],
      [],
      "2026-10-29", // 周四 dow=3
      { colUnit: "week", range: { start: "2026-10-19", end: "2026-10-25" } },
    );
    // 10-29 不在 10-19~10-25 周列内 → -1
    expect(week.todayIndex).toBe(-1);
    const week2 = buildGanttModel(
      makePlan({ startDate: "2026-10-01", targetDate: "2026-12-31" }),
      [],
      [],
      [],
      "2026-10-29",
      { colUnit: "week", range: { start: "2026-10-26", end: "2026-11-01" } },
    );
    expect(week2.todayIndex).toBe(0);
    expect(week2.todayFrac).toBeCloseTo((3 + 0.5) / 7);
    const month = buildGanttModel(
      makePlan({ startDate: "2026-01-01", targetDate: "2026-12-31" }),
      [],
      [],
      [],
      "2026-10-29",
      { colUnit: "month", range: { start: "2026-10-01", end: "2026-10-31" } },
    );
    expect(month.todayIndex).toBe(0);
    expect(month.todayFrac).toBeCloseTo((29 - 0.5) / 31);
  });
});
