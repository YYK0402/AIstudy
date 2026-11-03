import { describe, expect, it } from "vitest";
import type {
  AppData,
  Course,
  KnowledgePoint,
  ReviewSchedule,
  StudyPlan,
  StudyTask,
} from "../../types/appData";
import { buildDailyReminderSummary } from "../dailyReminder";

function course(id: number, name: string, over: Partial<Course> = {}): Course {
  return {
    id,
    siyuanDocId: null,
    name,
    description: "",
    target: "",
    totalCycle: "",
    status: "active",
    createTime: "2026-11-01T00:00:00.000Z",
    ...over,
  };
}

function plan(id: number, courseId: number, over: Partial<StudyPlan> = {}): StudyPlan {
  return {
    id,
    courseId,
    planContent: "",
    status: "active",
    targetDate: "2026-12-31",
    dailyHour: "2",
    createTime: "2026-11-01T00:00:00.000Z",
    ...over,
  };
}

function task(id: number, planId: number, scheduledDate: string, status = "todo"): StudyTask {
  return {
    id,
    planId,
    chapterId: null,
    kpId: null,
    taskType: "learn",
    title: `t${id}`,
    scheduledDate,
    status,
    sort: id,
  };
}

function kp(id: number, courseId: number): KnowledgePoint {
  return {
    id,
    courseId,
    chapterId: null,
    blockId: null,
    name: `kp${id}`,
    content: "",
    mastery: "unlearn",
    sourceAssetIds: "",
    prevKpIds: "",
    chapterName: "",
    sort: id,
    createTime: "2026-11-01T00:00:00.000Z",
  };
}

function schedule(id: number, kpId: number | null, dueTime: string): ReviewSchedule {
  return {
    id,
    kpId,
    qId: null,
    stage: 0,
    dueTime,
    easeFactor: 2.5,
    intervalDays: 1,
    lastReviewTime: null,
    reviewTimes: 0,
  };
}

function makeData(over: Partial<AppData> = {}): AppData {
  return {
    providers: [],
    models: [],
    taskModels: [],
    logs: [],
    courses: [],
    chapters: [],
    knowledgePoints: [],
    materials: [],
    materialChapters: [],
    questions: [],
    examPapers: [],
    answerRecords: [],
    questionAsks: [],
    wrongQuestions: [],
    studyPlans: [],
    studyTasks: [],
    explainRecords: [],
    reviewSchedules: [],
    flashCards: [],
    studyLogs: [],
    studyLogMonthly: [],
    answerStatsMonthly: [],
    settings: { chapterMode: "manual", persistToSiyuan: false, notebookName: "" },
    ...over,
  };
}

const TODAY = "2026-11-03";

describe("buildDailyReminderSummary", () => {
  it("聚合今日未完成计划任务 + 到期复习项（跨课程；已完成/未排到今天的不计）", () => {
    const data = makeData({
      courses: [course(1, "财务管理学"), course(2, "英语")],
      studyPlans: [plan(10, 1)],
      studyTasks: [task(101, 10, TODAY), task(102, 10, TODAY, "done"), task(103, 10, "2026-11-04")],
      knowledgePoints: [kp(1, 1)],
      reviewSchedules: [schedule(1, 1, TODAY), schedule(2, 1, "2026-11-05")],
    });
    const s = buildDailyReminderSummary(data, TODAY);
    expect(s).not.toBeNull();
    expect(s!.planCount).toBe(1);
    expect(s!.reviewCount).toBe(1);
    expect(s!.text).toBe("今日：1 项计划任务、1 项复习到期（财务管理学 2）");
  });

  it("零任务返回 null（不打扰）", () => {
    const data = makeData({
      courses: [course(1, "财务管理学")],
      studyPlans: [plan(10, 1)],
      studyTasks: [task(101, 10, TODAY, "done")],
      knowledgePoints: [kp(1, 1)],
      reviewSchedules: [schedule(1, 1, "2026-11-05")],
    });
    expect(buildDailyReminderSummary(data, TODAY)).toBeNull();
  });

  it("归档课程的任务与复习不计", () => {
    const data = makeData({
      courses: [course(1, "归档课", { status: "archived" })],
      studyPlans: [plan(10, 1)],
      studyTasks: [task(101, 10, TODAY)],
      knowledgePoints: [kp(1, 1)],
      reviewSchedules: [schedule(1, 1, TODAY)],
    });
    expect(buildDailyReminderSummary(data, TODAY)).toBeNull();
  });

  it("暂停计划的任务不计", () => {
    const data = makeData({
      courses: [course(1, "课")],
      studyPlans: [plan(10, 1, { status: "paused" })],
      studyTasks: [task(101, 10, TODAY)],
    });
    expect(buildDailyReminderSummary(data, TODAY)).toBeNull();
  });

  it("复习暂停课程的复习项不计，但其计划任务仍计", () => {
    const data = makeData({
      courses: [course(1, "课", { reviewPaused: true })],
      studyPlans: [plan(10, 1)],
      studyTasks: [task(101, 10, TODAY)],
      knowledgePoints: [kp(1, 1)],
      reviewSchedules: [schedule(1, 1, TODAY)],
    });
    const s = buildDailyReminderSummary(data, TODAY);
    expect(s).not.toBeNull();
    expect(s!.planCount).toBe(1);
    expect(s!.reviewCount).toBe(0);
    expect(s!.text).toBe("今日：1 项计划任务（课 1）");
  });

  it("悬挂引用排期（kpId 不属于本课程）不计", () => {
    const data = makeData({
      courses: [course(1, "课1"), course(2, "课2")],
      knowledgePoints: [kp(1, 1)],
      // 排期引用 kp1（属于课1）但挂到课2 的检查口径：按触点引用有效性，课2 的集合不含 kp1
      reviewSchedules: [schedule(1, 1, TODAY), schedule(2, 999, TODAY)],
    });
    const s = buildDailyReminderSummary(data, TODAY);
    expect(s).not.toBeNull();
    expect(s!.reviewCount).toBe(1);
    expect(s!.courses).toEqual([{ name: "课1", count: 1 }]);
  });

  it("多课程文本：按课程顺序带各自计数", () => {
    const data = makeData({
      courses: [course(1, "财务管理学"), course(2, "英语")],
      studyPlans: [plan(10, 1), plan(11, 2)],
      studyTasks: [task(101, 10, TODAY), task(102, 10, TODAY), task(201, 11, TODAY)],
      knowledgePoints: [kp(1, 2)],
      reviewSchedules: [schedule(1, 1, TODAY)],
    });
    const s = buildDailyReminderSummary(data, TODAY);
    expect(s!.text).toBe("今日：3 项计划任务、1 项复习到期（财务管理学 2 / 英语 2）");
  });
});
