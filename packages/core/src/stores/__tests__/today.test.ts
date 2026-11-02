// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "vue";
import { createEmptyData, type AppData } from "../../types/appData";
import { setBridge } from "../../bridge";
import type { StudyBridge } from "../../bridge/types";
import { createPinia, setActivePinia } from "pinia";
import { formatLocalDate } from "../../api";

// 与生产同口径的「今天」（load 内部用 formatLocalDate 比较）
const TODAY = formatLocalDate();

// 数据：课程 A（active，今日任务+到期复习）+ 课程 B（archived，有今日任务但应被排除）
const dataRef: { data: AppData } = {
  data: {
    ...createEmptyData(),
    courses: [
      { id: 1, siyuanDocId: null, name: "课程A", description: "", target: "", totalCycle: "", status: "active", createTime: "2026-10-01T00:00:00Z", modelId: null },
      { id: 2, siyuanDocId: null, name: "课程B", description: "", target: "", totalCycle: "", status: "archived", createTime: "2026-10-01T00:00:00Z", modelId: null },
    ] as AppData["courses"],
    knowledgePoints: [
      { id: 11, courseId: 1, chapterId: null, blockId: null, name: "知识点甲", content: "", mastery: "unlearn", sourceAssetIds: "", prevKpIds: "", chapterName: "", sort: 1, createTime: "2026-10-01T00:00:00Z" },
    ],
    questions: [
      { id: 91, courseId: 1, kpIds: "", title: "错题一", options: "A. 甲\nB. 乙", answer: "A", analysis: "", qType: "single", difficulty: "", source: "ai", paperId: null, createTime: "2026-10-01T00:00:00Z" },
    ],
    flashCards: [
      { id: 71, courseId: 1, kpId: 11, front: "闪卡正面", back: "闪卡背面", source: "ai", createTime: "2026-10-01T00:00:00Z" },
    ],
    studyPlans: [
      { id: 1, courseId: 1, planContent: "计划一", status: "active", startDate: "2026-11-01", targetDate: "2026-11-07", dailyHour: "1", createTime: "2026-11-01T00:00:00Z" },
      { id: 2, courseId: 2, planContent: "计划二", status: "active", startDate: "2026-11-01", targetDate: "2026-11-07", dailyHour: "1", createTime: "2026-11-01T00:00:00Z" },
    ],
    studyTasks: [
      { id: 101, planId: 1, chapterId: null, kpId: 11, taskType: "learn", title: "学习：知识点甲", scheduledDate: TODAY, status: "todo", sort: 1 },
      { id: 201, planId: 2, chapterId: null, kpId: null, taskType: "learn", title: "归档课任务", scheduledDate: TODAY, status: "todo", sort: 1 },
    ],
    reviewSchedules: [
      { id: 301, kpId: 11, qId: null, cardId: null, stage: 1, dueTime: TODAY, easeFactor: 2.5, intervalDays: 1, lastReviewTime: null },
      { id: 302, kpId: null, qId: null, cardId: 71, stage: 1, dueTime: TODAY, easeFactor: 2.5, intervalDays: 1, lastReviewTime: null },
      { id: 303, kpId: null, qId: 91, cardId: null, stage: 1, dueTime: TODAY, easeFactor: 2.5, intervalDays: 1, lastReviewTime: null },
    ] as AppData["reviewSchedules"],
  },
};

let showMessages: string[] = [];
setBridge({
  getData: async () => dataRef.data,
  saveData: async (next: AppData) => {
    dataRef.data = next;
    return { code: 0 };
  },
  showMessage: (msg?: string) => {
    if (msg) showMessages.push(msg);
  },
} as unknown as StudyBridge);

import router from "../../router";
import { useTodayStore } from "../today";
import { useCourseStore } from "../course";

// 安装真实 router（jsdom），openTask 的跳转可断言
beforeAll(async () => {
  const app = createApp({ render: () => null });
  app.use(router);
  router.push("/");
  await router.isReady();
});

async function makeStore() {
  const store = useTodayStore();
  await store.load();
  return store;
}

// 路由为懒加载组件，push 后轮询等待导航完成
async function waitForRoute(path: string) {
  for (let i = 0; i < 100 && router.currentRoute.value.path !== path; i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("useTodayStore", () => {
  it("跨课程聚合：active 课程今日计划任务 + 到期复习（KP/错题/闪卡触点）", async () => {
    setActivePinia(createPinia());
    const store = await makeStore();
    expect(store.groups).toHaveLength(1);
    expect(store.groups[0].courseName).toBe("课程A");
    // 计划任务 1 + KP 复习 1 + 错题复习 1 + 闪卡复习 1
    expect(store.groups[0].tasks).toHaveLength(4);
    expect(store.items.some((t) => t.title === "学习：知识点甲")).toBe(true);
    expect(store.items.some((t) => t.title === "复习：知识点甲")).toBe(true);
    expect(store.items.some((t) => t.title === "错题复习：错题一")).toBe(true);
    expect(store.items.some((t) => t.title === "闪卡：闪卡正面")).toBe(true);
  });

  it("归档课程的任务与复习不浮现", async () => {
    setActivePinia(createPinia());
    const store = await makeStore();
    expect(store.items.some((t) => t.courseId === 2)).toBe(false);
    expect(store.items.some((t) => t.title === "归档课任务")).toBe(false);
  });

  it("课程计划全部暂停 → 该课程计划任务与到期复习均不浮现（数据不动）", async () => {
    dataRef.data.studyPlans[0] = { ...dataRef.data.studyPlans[0], status: "paused" };
    try {
      setActivePinia(createPinia());
      const store = await makeStore();
      // 课程 A 的计划任务 101 与 3 个到期复习触点全部挂起
      expect(store.items.filter((t) => t.courseId === 1)).toHaveLength(0);
      // 排期数据未被修改
      expect(dataRef.data.reviewSchedules).toHaveLength(3);
      // 恢复计划 → 任务与复习回来
      dataRef.data.studyPlans[0] = { ...dataRef.data.studyPlans[0], status: "active" };
      setActivePinia(createPinia());
      const restored = await makeStore();
      expect(restored.items.filter((t) => t.courseId === 1)).toHaveLength(4);
    } finally {
      dataRef.data.studyPlans[0] = { ...dataRef.data.studyPlans[0], status: "active" };
    }
  });

  it("归组：组内未完成在前，counts/doneCount 正确", async () => {
    setActivePinia(createPinia());
    dataRef.data.studyTasks[0] = { ...dataRef.data.studyTasks[0], status: "done" };
    const store = await makeStore();
    const g = store.groups[0];
    expect(g.tasks[0].done).toBe(false);
    expect(g.tasks[3].done).toBe(true);
    expect(g.doneCount).toBe(1);
    expect(g.counts.learn).toBe(1);
    expect(g.counts.review).toBe(3);
    dataRef.data.studyTasks[0] = { ...dataRef.data.studyTasks[0], status: "todo" };
  });

  it("单课程默认展开，toggleCourse 切换收起", async () => {
    setActivePinia(createPinia());
    const store = await makeStore();
    expect(store.isCourseOpen(1)).toBe(true);
    store.toggleCourse(1);
    expect(store.isCourseOpen(1)).toBe(false);
    store.toggleCourse(1);
    expect(store.isCourseOpen(1)).toBe(true);
  });

  it("toggleTask：乐观更新 + updateStudyTask 落库", async () => {
    setActivePinia(createPinia());
    const store = await makeStore();
    const task = store.items.find((t) => t.kind === "plan")!;
    expect(task.done).toBe(false);
    await store.toggleTask(task);
    expect(task.done).toBe(true);
    expect(dataRef.data.studyTasks[0].status).toBe("done");
    // 再勾回复原
    await store.toggleTask(task);
    expect(task.done).toBe(false);
    expect(dataRef.data.studyTasks[0].status).toBe("todo");
  });

  it("openTask：先切到任务归属课程，再跳转（learn→/study?kp=）", async () => {
    setActivePinia(createPinia());
    const courseStore = useCourseStore();
    courseStore.setCourses([
      { id: 1, siyuanDocId: null, name: "课程A", description: "", target: "", totalCycle: "", status: "active", createTime: "2026-10-01T00:00:00Z", modelId: null },
      { id: 2, siyuanDocId: null, name: "课程B", description: "", target: "", totalCycle: "", status: "active", createTime: "2026-10-01T00:00:00Z", modelId: null },
    ]);
    courseStore.setCurrent(2); // 当前在课程 B
    const store = await makeStore();
    const task = store.items.find((t) => t.kind === "plan")!; // 属课程 A
    store.openTask(task);
    expect(courseStore.currentCourseId).toBe(1);
    await waitForRoute("/study");
    expect(router.currentRoute.value.path).toBe("/study");
    expect(router.currentRoute.value.query.kp).toBe("11");
  });

  it("openTask：无 taskAction 的 taskType 落 /plan 并提示", async () => {
    setActivePinia(createPinia());
    const store = await makeStore();
    const task = store.items.find((t) => t.kind === "review")!;
    // review 有 action，改成一个不认识的 taskType 走兜底分支
    store.openTask({ ...task, taskType: "unknown" });
    await waitForRoute("/plan");
    expect(router.currentRoute.value.path).toBe("/plan");
    expect(showMessages.at(-1)).toBe("该任务无绑定知识点，请在学习计划页处理");
  });
});
