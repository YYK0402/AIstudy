import { beforeEach, describe, expect, it } from "vitest";
import { createEmptyData } from "../../types/appData";
import type { AppData } from "../../types/appData";

// 有状态 mock：getData 返回最近一次 saveData 的数据
//（createSampleCourse 先落盘内容，generateStudyPlan 再读取——必须读到落盘后的数据）
let store: AppData = createEmptyData();
(globalThis as Record<string, unknown>).window = {
  addEventListener: () => undefined,
  dispatchEvent: () => true,
  siyuanAiStudy: {
    getData: async () => store,
    saveData: async (d: AppData) => {
      store = d;
      return { code: 0, msg: "" };
    },
  },
};

const { createSampleCourse, hasSampleCourse } = await import("../sampleCourse");

beforeEach(() => {
  store = createEmptyData();
});

describe("createSampleCourse", () => {
  it("空数据下添加示例课：isSample=true，实体归属本课程，外键正确，无资料", async () => {
    const res = await createSampleCourse();
    const c = store.courses.find((x) => x.id === res.courseId)!;
    expect(c).toBeDefined();
    expect(c.isSample).toBe(true);
    expect(c.name).toBe("示例课：中国近代史");
    const kps = store.knowledgePoints.filter((k) => k.courseId === res.courseId);
    expect(kps).toHaveLength(12);
    const chIds = new Set(store.chapters.filter((ch) => ch.courseId === res.courseId).map((ch) => ch.id));
    expect(chIds.size).toBe(4);
    for (const k of kps) expect(chIds.has(k.chapterId!)).toBe(true);
    const kpIds = new Set(kps.map((k) => k.id));
    const qs = store.questions.filter((q) => q.courseId === res.courseId);
    expect(qs).toHaveLength(20);
    for (const q of qs) {
      for (const n of q.kpIds.split(",").map((s) => Number(s.trim())).filter((n) => n > 0)) {
        expect(kpIds.has(n)).toBe(true);
      }
    }
    expect(store.flashCards.filter((card) => card.courseId === res.courseId)).toHaveLength(10);
    expect(store.materials).toEqual([]);
    expect(res.counts).toEqual({ chapters: 4, kps: 12, questions: 20, cards: 10 });
  });

  it("生成现成学习计划 + 确定性任务（12 条 learn + 章末/结业 test），日期相对今天", async () => {
    await createSampleCourse();
    const plans = store.studyPlans;
    expect(plans).toHaveLength(1);
    // targetDate = startDate + 14 天（关系式断言，避免跨午夜 flaky）
    const s = new Date(plans[0].startDate + "T00:00:00");
    const t = new Date(plans[0].targetDate + "T00:00:00");
    expect(Math.round((t.getTime() - s.getTime()) / 86400000)).toBe(14);
    const tasks = store.studyTasks.filter((t) => t.planId === plans[0].id);
    expect(tasks.filter((t) => t.taskType === "learn")).toHaveLength(12);
    expect(tasks.some((t) => t.taskType === "test")).toBe(true);
    // learn 任务 100% 挂 kpId
    for (const t of tasks.filter((t) => t.taskType === "learn")) {
      expect(t.kpId).not.toBeNull();
    }
  });

  it("无 gen_plan 绑定时计划为确定性骨架（planContent 含「确定性骨架」，无 AI 补充）", async () => {
    await createSampleCourse();
    const plan = store.studyPlans[0];
    expect(plan.status).toBe("active");
    expect(plan.planContent).toContain("确定性骨架");
  });

  it("幂等：已有示例课时再次调用不新增课程", async () => {
    const first = await createSampleCourse();
    const before = store.courses.length;
    const second = await createSampleCourse();
    expect(store.courses.length).toBe(before);
    expect(second.courseId).toBe(first.courseId);
    expect(store.studyPlans).toHaveLength(1);
  });

  it("hasSampleCourse：无示例课为 false，添加后为 true", async () => {
    expect(hasSampleCourse(store)).toBe(false);
    await createSampleCourse();
    expect(hasSampleCourse(store)).toBe(true);
  });
});
