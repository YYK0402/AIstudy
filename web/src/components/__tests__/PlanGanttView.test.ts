// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import PlanGanttView from "../PlanGanttView.vue";
import { buildGanttModel } from "../../api/planGantt";
import type { Chapter, KnowledgePoint, StudyPlan, StudyTask } from "../../types/appData";

function makePlan(): StudyPlan {
  return {
    id: 1,
    courseId: 1,
    planContent: "",
    startDate: "2026-10-01",
    targetDate: "2026-10-10",
    dailyHour: "2",
    createTime: "2026-10-01T00:00:00.000Z",
  };
}

function makeChapter(): Chapter {
  return { id: 1, courseId: 1, parentId: null, siyuanBlockId: null, name: "第一章", level: "chapter", sort: 1 };
}

function makeKp(): KnowledgePoint {
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
  };
}

function makeTask(over: Partial<StudyTask> = {}): StudyTask {
  return {
    id: 1,
    planId: 1,
    chapterId: 1,
    kpId: 1,
    taskType: "learn",
    title: "学习：知识点一",
    scheduledDate: "2026-10-01",
    status: "todo",
    sort: 1,
    ...over,
  };
}

const TODAY = "2026-10-05";

function buildModel(tasks: StudyTask[]) {
  return buildGanttModel(makePlan(), tasks, [makeChapter()], [makeKp()], TODAY);
}

function mountGantt(props: Record<string, unknown> = {}, model?: ReturnType<typeof buildModel>) {
  return mount(PlanGanttView, {
    props: {
      model: model ?? buildModel([makeTask(), makeTask({ id: 2, scheduledDate: "2026-10-02", taskType: "practice" })]),
      archived: false,
      pendingTaskIds: new Set<number>(),
      expandedChapters: new Set(["ch:1"]),
      expandedCells: new Set<string>(),
      postponeBusy: false,
      ...props,
    },
    global: {
      stubs: {
        RouterLink: { name: "RouterLink", props: ["to"], template: "<a class='rl'><slot /></a>" },
        AppIcon: { name: "AppIcon", template: "<i class='app-icon' />" },
        ProgressBar: { name: "ProgressBar", props: ["value", "max"], template: "<i class='progress' />" },
      },
    },
  });
}

describe("PlanGanttView", () => {
  it("渲染月份/周/星期表头与今天线", () => {
    const w = mountGantt();
    expect(w.find(".gantt-month").text()).toBe("2026年10月");
    // 10-01 周四起：首段（周四~周日）周一为 09/28，第二段自 10/05 周一
    expect(w.findAll(".gantt-week").map((n) => n.text())).toEqual(["09/28", "10/05"]);
    expect(w.findAll(".gantt-wd").length).toBe(10);
    expect(w.findAll(".gantt-wd.wknd").length).toBe(3);
    expect(w.find(".gantt-wd.today").text()).toBe("一");
  });

  it("渲染章行与进度，展开后渲染 KP 行与色块", () => {
    const w = mountGantt();
    expect(w.find(".gantt-ch-name").text()).toBe("第一章");
    expect(w.find(".gantt-ch-prog").text()).toBe("0/2");
    expect(w.find(".gantt-kp-name").text()).toBe("知识点一");
    expect(w.findAll(".gantt-cell").length).toBe(2);
  });

  it("收起的章不渲染 KP 行", () => {
    const w = mountGantt({ expandedChapters: new Set<string>() });
    expect(w.find(".gantt-kp-name").exists()).toBe(false);
  });

  it("行勾选 emit toggle-row 带该行任务", async () => {
    const w = mountGantt();
    await w.find(".gantt-kp-left button.task-check").trigger("click");
    const emitted = w.emitted("toggle-row");
    expect(emitted).toHaveLength(1);
    expect((emitted![0][0] as StudyTask[]).map((t) => t.id)).toEqual([1, 2]);
  });

  it("点色块 emit toggle-cell 带 行:列下标 键", async () => {
    const w = mountGantt();
    await w.find(".gantt-cell").trigger("click");
    expect(w.emitted("toggle-cell")).toEqual([["kp:1:0"]]);
  });

  it("expandedCells 含键时渲染明细行（任务+类型标签）", () => {
    const w = mountGantt({ expandedCells: new Set(["kp:1:0"]) });
    expect(w.find(".gantt-detail-row").exists()).toBe(true);
    expect(w.find(".gantt-detail-title").text()).toBe("学习：知识点一");
    expect(w.find(".gantt-detail .tag").text()).toContain("新知");
  });

  it("点章行左侧 emit toggle-chapter", async () => {
    const w = mountGantt();
    await w.find(".gantt-ch-left").trigger("click");
    expect(w.emitted("toggle-chapter")).toEqual([["ch:1"]]);
  });

  it("archived 时勾选禁用", () => {
    const w = mountGantt({ archived: true });
    expect(w.find(".gantt-kp-left button.task-check").attributes("disabled")).toBeDefined();
  });

  it("pendingTaskIds 命中时显示转圈", () => {
    const w = mountGantt({ pendingTaskIds: new Set([1]) });
    expect(w.find(".gantt-kp-left .task-check-spinner").exists()).toBe(true);
  });

  it("周列模式：渲染周标签行，不渲染周/星期行", () => {
    const model = buildGanttModel(makePlan(), [makeTask()], [makeChapter()], [makeKp()], TODAY, {
      colUnit: "week",
      range: { start: "2026-09-28", end: "2026-10-11" },
    });
    const w = mountGantt({ expandedChapters: new Set(["ch:1"]) }, model);
    expect(w.findAll(".gantt-wklabel").map((n) => n.text())).toEqual(["09/28", "10/05"]);
    expect(w.find(".gantt-week").exists()).toBe(false);
    expect(w.find(".gantt-wd").exists()).toBe(false);
    expect(w.find(".gantt-cell").exists()).toBe(true);
  });

  it("月列模式：月份行显示月标签，无周标签/星期行", () => {
    const model = buildGanttModel(makePlan(), [], [makeChapter()], [makeKp()], TODAY, {
      colUnit: "month",
      range: { start: "2026-09-01", end: "2026-11-30" },
    });
    const w = mountGantt({}, model);
    expect(w.findAll(".gantt-month").map((n) => n.text())).toEqual(["2026年9月", "10月", "11月"]);
    expect(w.find(".gantt-wklabel").exists()).toBe(false);
    expect(w.find(".gantt-wd").exists()).toBe(false);
  });
});
