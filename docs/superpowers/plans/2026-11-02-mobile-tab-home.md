# 移动端 Tab 导航 + 移动首页 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 思源手机端获得底部 Tab 导航（首页/学习/刷题/复习/更多）+ 独立移动首页（课程行切换 + 跨课程今日任务聚合队列），桌面端行为零变化。

**Architecture:** 同一 bundle 响应式（`matchMedia ≤768px` 分支），不做独立移动端入口。今日任务逻辑从 `HomeView` 抽成 pinia store（`stores/today.ts`）供桌面首页/移动首页/TabBar 徽标三方共用。TabBar 为 `.main` 内 in-flow 元素（非 fixed）；思源移动端宿主胶囊底栏 `#mobileBottomBar` 在插件 app 可见时以 `visibility:hidden` 隐藏、不可见时移除 inline 归还宿主。

**Tech Stack:** Vue 3 + pinia + vue-router + vitest（node 环境，桥 mock 用 `setBridge`）

**Spec:** `docs/superpowers/specs/2026-11-02-mobile-tab-home-design.md`（含附录 A 移动端环境实测证据）

## Global Constraints

- 2 空格缩进、camelCase、函数名动词开头、中文注释
- 禁止 `any`、禁止 `eslint-disable` / `@ts-ignore`
- 前端样式一律写 `packages/core/src/style.css`（组件 `<style scoped>` 不生效）
- 每个任务完成标准：`npx vue-tsc --noEmit -p packages/siyuan/tsconfig.json && npx vue-tsc --noEmit -p packages/core/tsconfig.json && npx vitest run` 全绿
- 桌面行为零变化：1127px 页签无 TabBar、侧边栏/桌面首页/Topbar 与改动前一致
- 发版时 core 改动双端同发（`build:web` + `build:plugin` + `make_install.js` + `pack:fnos`）
- 测试 mock 模式（参照 `packages/core/src/api/__tests__/chapterTree.test.ts`）：`setBridge({getData, saveData, showMessage} as unknown as StudyBridge)` + `createEmptyData()` 造数据 + 覆盖 `globalThis.window` 桩（须保留 `addEventListener`/`dispatchEvent`，storage.ts 顶层依赖）

---

### Task 1: `useIsMobile` 断点 composable

**Files:**
- Create: `packages/core/src/composables/useIsMobile.ts`
- Test: `packages/core/src/composables/__tests__/useIsMobile.test.ts`

**Interfaces:**
- Produces: `useIsMobile(): { isMobile: Ref<boolean> }`——模块级单例（单一 matchMedia 实例，多消费方同步）；断点 `(max-width: 768px)`
- 后续任务（3/4/6/7）均消费此接口

- [ ] **Step 1: 写失败测试**

```ts
// packages/core/src/composables/__tests__/useIsMobile.test.ts
import { describe, expect, it } from "vitest";

// matchMedia 桩：currentMatches 控制命中，changeHandlers 记录监听（模拟视口变化）
let currentMatches = false;
const changeHandlers = new Set<(e: { matches: boolean }) => void>();
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    addEventListener: () => {},
    dispatchEvent: () => true,
    matchMedia: (media: string) => ({
      matches: currentMatches,
      media,
      addEventListener: (_type: string, cb: (e: { matches: boolean }) => void) => changeHandlers.add(cb),
      removeEventListener: () => {},
    }),
  },
});

async function fireChange() {
  for (const cb of changeHandlers) cb({ matches: currentMatches });
}

describe("useIsMobile", () => {
  it("初始未命中（>768px）：isMobile 为 false", async () => {
    currentMatches = false;
    const { useIsMobile } = await import("../useIsMobile");
    const { isMobile } = useIsMobile();
    expect(isMobile.value).toBe(false);
  });

  it("视口缩到 ≤768px：change 事件后为 true，再恢复回 false", async () => {
    const { useIsMobile } = await import("../useIsMobile");
    const first = useIsMobile();
    currentMatches = true;
    await fireChange();
    expect(first.isMobile.value).toBe(true);
    // 第二个消费方拿到同一响应式状态
    const second = useIsMobile();
    expect(second.isMobile.value).toBe(true);
    currentMatches = false;
    await fireChange();
    expect(first.isMobile.value).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/core/src/composables/__tests__/useIsMobile.test.ts`
Expected: FAIL（`../useIsMobile` 不存在）

- [ ] **Step 3: 实现**

```ts
// packages/core/src/composables/useIsMobile.ts
import { ref, type Ref } from "vue";

// 断点：思源手机 webview ~375-430px；桌面窄页签 1127px 不误触发
const MOBILE_QUERY = "(max-width: 768px)";

// 模块级单例：所有消费方（App/Topbar/Home/TabBar）共享一个 matchMedia 实例与同一响应式状态
let isMobile: Ref<boolean> | null = null;

export function useIsMobile(): { isMobile: Ref<boolean> } {
  if (isMobile == null) {
    const mq = window.matchMedia(MOBILE_QUERY);
    isMobile = ref(mq.matches);
    mq.addEventListener("change", (e) => {
      isMobile!.value = e.matches;
    });
  }
  return { isMobile };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run packages/core/src/composables/__tests__/useIsMobile.test.ts`
Expected: PASS（2 例）

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/composables/useIsMobile.ts packages/core/src/composables/__tests__/useIsMobile.test.ts
git commit -m "feat(mobile): useIsMobile 断点 composable（≤768px 单例 matchMedia）"
```

---

### Task 2: `stores/today.ts` 跨课程今日任务 store（抽自 HomeView）

**Files:**
- Create: `packages/core/src/stores/today.ts`
- Create: `packages/core/src/stores/__tests__/today.test.ts`
- Modify: `packages/core/src/views/HomeView.vue`（删内联今日任务逻辑，改消费 store；模板绑定同步改）

**Interfaces:**
- Produces（后续任务 3/6 依赖，签名锁定）:
  - `TodayTaskItem { id, courseId, kind: "plan"|"review", planId, chapterId, kpId, taskType, scheduledDate, sort, title, course, done }`（从 HomeView 原 interface 原样搬）
  - `CourseDayGroup { courseId, courseName, tasks, counts, doneCount }`
  - `useTodayStore()`（pinia setup store）暴露：`items: TodayTaskItem[]`、`groups: CourseDayGroup[]`、`loading: boolean`、`loadError: string`、`pendingTaskIds: Set<number>`、`dueReviewTotal: number`（getter，kind=review 计数，TabBar 徽标用）、`load(): Promise<void>`、`isCourseOpen(id): boolean`、`toggleCourse(id): void`、`openTask(t): void`、`toggleTask(t): Promise<void>`
- 行为与现 `HomeView` 完全一致，**唯一例外**：`openTask` 增加「任务归属课程 ≠ 当前课程时先 `courseStore.setCurrent(task.courseId)`」——修复现有跨课程队列点击串课程上下文的隐患（桌面同步受益）
- `useDataSavedRefresh` 订阅留在消费方（HomeView/MobileHomePanel 各自 `useDataSavedRefresh(() => todayStore.load())`），store 不订阅（store 在首个消费方 setup 时创建，避免无组件上下文时误建）

- [ ] **Step 1: 写失败测试**

```ts
// packages/core/src/stores/__tests__/today.test.ts
import { describe, expect, it } from "vitest";
import { createEmptyData, type AppData } from "../../types/appData";
import { setBridge } from "../../bridge";
import type { StudyBridge } from "../../bridge/types";

// 数据：课程 A（active，有今日任务+到期复习）+ 课程 B（archived，有今日任务但应被排除）
const dataRef: { data: AppData } = {
  data: {
    ...createEmptyData(),
    courses: [
      { id: 1, siyuanDocId: null, name: "课程A", description: "", target: "", totalCycle: "", status: "active", createTime: "2026-10-01T00:00:00Z", modelId: null },
      { id: 2, siyuanDocId: null, name: "课程B", description: "", target: "", totalCycle: "", status: "archived", createTime: "2026-10-01T00:00:00Z", modelId: null },
    ],
    knowledgePoints: [
      { id: 11, courseId: 1, chapterId: null, blockId: null, name: "知识点甲", content: "", mastery: "unlearn", sourceAssetIds: "", prevKpIds: "", chapterName: "", sort: 1, createTime: "2026-10-01T00:00:00Z" },
    ] as AppData["knowledgePoints"],
    flashCards: [
      { id: 71, courseId: 1, kpId: null, front: "闪卡正面", back: "闪卡背面", sort: 1, createTime: "2026-10-01T00:00:00Z" },
    ] as AppData["flashCards"],
    studyPlans: [
      { id: 1, courseId: 1, startDate: "2026-11-01", targetDate: "2026-11-07", status: "active", pausedAt: null, dailyHour: 1, createTime: "2026-11-01T00:00:00Z" },
      { id: 2, courseId: 2, startDate: "2026-11-01", targetDate: "2026-11-07", status: "active", pausedAt: null, dailyHour: 1, createTime: "2026-11-01T00:00:00Z" },
    ] as AppData["studyPlans"],
    studyTasks: [
      { id: 101, planId: 1, chapterId: null, kpId: 11, taskType: "learn", title: "学习：知识点甲", scheduledDate: TODAY, status: "todo", sort: 1 },
      { id: 201, planId: 2, chapterId: null, kpId: null, taskType: "learn", title: "归档课任务", scheduledDate: TODAY, status: "todo", sort: 1 },
    ] as AppData["studyTasks"],
    reviewSchedules: [
      { id: 301, courseId: 1, kpId: 11, qId: null, cardId: null, dueTime: TODAY, stage: 1, intervalDays: 1, easeFactor: 2.5, lastReview: null, createTime: "2026-10-01T00:00:00Z" },
      { id: 302, courseId: 1, kpId: null, qId: null, cardId: 71, dueTime: TODAY, stage: 1, intervalDays: 1, easeFactor: 2.5, lastReview: null, createTime: "2026-10-01T00:00:00Z" },
    ] as AppData["reviewSchedules"],
  },
};
// 与生产同口径的「今天」（load 内部用 formatLocalDate 比较）
const TODAY = new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD 本地时区

(globalThis as Record<string, unknown>).window = {
  addEventListener: () => {},
  dispatchEvent: () => true,
};
setBridge({
  getData: async () => dataRef.data,
  saveData: async (next: AppData) => { dataRef.data = next; return { code: 0 }; },
  showMessage: () => {},
} as unknown as StudyBridge);

import { createPinia, setActivePinia } from "pinia";

async function makeStore() {
  const { useTodayStore } = await import("../today");
  const store = useTodayStore();
  await store.load();
  return store;
}

describe("useTodayStore", () => {
  it("跨课程聚合：active 课程今日计划任务 + 到期复习（含闪卡触点）", async () => {
    setActivePinia(createPinia());
    const store = await makeStore();
    expect(store.groups).toHaveLength(1);
    expect(store.groups[0].courseName).toBe("课程A");
    // 计划任务 1 + KP 复习 1 + 闪卡复习 1
    expect(store.groups[0].tasks).toHaveLength(3);
    expect(store.items.some((t) => t.title === "学习：知识点甲")).toBe(true);
    expect(store.items.some((t) => t.title === "复习：知识点甲")).toBe(true);
    expect(store.items.some((t) => t.title === "闪卡：闪卡正面")).toBe(true);
  });

  it("归档课程的任务与复习不浮现", async () => {
    setActivePinia(createPinia());
    const store = await makeStore();
    expect(store.items.some((t) => t.courseId === 2)).toBe(false);
  });

  it("dueReviewTotal = 到期复习触点总数（TabBar 徽标口径）", async () => {
    setActivePinia(createPinia());
    const store = await makeStore();
    expect(store.dueReviewTotal).toBe(2);
  });

  it("归组：组内未完成在前，counts/doneCount 正确", async () => {
    setActivePinia(createPinia());
    dataRef.data.studyTasks[0].status = "done";
    const store = await makeStore();
    const g = store.groups[0];
    expect(g.tasks[0].kind).toBe("plan"); // done 沉底
    expect(g.doneCount).toBe(1);
    expect(g.counts.learn).toBe(1);
    expect(g.counts.review).toBe(2);
  });

  it("单课程默认展开，多课程默认收起；toggleCourse 切换", async () => {
    setActivePinia(createPinia());
    const store = await makeStore();
    expect(store.isCourseOpen(1)).toBe(true);
    store.toggleCourse(1);
    expect(store.isCourseOpen(1)).toBe(false);
  });

  it("toggleTask：乐观更新 + updateStudyTask 落库", async () => {
    setActivePinia(createPinia());
    let saved = false;
    (setBridge as unknown as (b: unknown) => void)({
      getData: async () => dataRef.data,
      saveData: async () => { saved = true; return { code: 0 }; },
      showMessage: () => {},
      // updateStudyTask 走 api 层（内部 getData/saveData 改 studyTasks）
    } as unknown as StudyBridge);
    const store = await makeStore();
    const task = store.items.find((t) => t.kind === "plan")!;
    await store.toggleTask(task);
    expect(task.done).toBe(true);
    expect(dataRef.data.studyTasks[0].status).toBe("done");
    expect(saved).toBe(true);
  });
});
```

注意：`updateStudyTask` 若内部走的是 `getBridge().updateStudyTask`（而非 getData/saveData 组合），mock 按实际调用点补齐——实现前先看 `packages/core/src/api/plan.ts` 的 `updateStudyTask` 实现，mock 对它的桥调用（`setBridge` 对象补同名方法）。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/core/src/stores/__tests__/today.test.ts`
Expected: FAIL（`../today` 不存在）

- [ ] **Step 3: 实现 store**

把 `HomeView.vue` 中以下代码**原样搬移**（304-351 行 `TodayTaskItem`/`CourseDayGroup`/`todayGroups`、334-351 归组、359-382 `expandedCourses`/`applyDefaultExpand`/`toggleCourse`、414-489 `load()` 中今日任务段（`activeCourses` 起到 `todayTasks.splice` 止）、496-530 `openTask`/`toggleTask`），组装成 setup store：

```ts
// packages/core/src/stores/today.ts
import { defineStore } from "pinia";
import { computed, reactive, ref } from "vue";
import router from "../router";
import { useCourseStore } from "./course";
import { getBridge } from "../bridge";
import { getData, queryDueReviews, updateStudyTask, formatLocalDate, truncateText } from "../api";
import { taskAction } from "../constants/tasks";

export interface TodayTaskItem { /* 同 HomeView 原 interface，原样 */ }
export interface CourseDayGroup { /* 同上 */ }

export const useTodayStore = defineStore("today", () => {
  const courseStore = useCourseStore();
  const items = reactive<TodayTaskItem[]>([]);
  const loading = ref(false);
  const loadError = ref("");
  const pendingTaskIds = ref<Set<number>>(new Set());
  const expandedCourses = ref<Set<number>>(new Set());
  let loadedGroupsKey = "";

  const groups = computed<CourseDayGroup[]>(() => { /* HomeView todayGroups 原样 */ });

  /** 全局到期复习数（含闪卡触点），TabBar 复习徽标 */
  const dueReviewTotal = computed(() => items.reduce((n, t) => n + (t.kind === "review" ? 1 : 0), 0));

  function applyDefaultExpand() { /* HomeView 原样：key 比对，单课程展开/多课程收起 */ }
  function isCourseOpen(courseId: number): boolean { /* 原样 */ }
  function toggleCourse(courseId: number) { /* 原样 */ }

  async function load(): Promise<void> {
    /* HomeView load() 中今日任务段原样（getData → activeCourses → 计划任务 → queryDueReviews 逐课程 → sort → items.splice → applyDefaultExpand），
       外层 try/catch 写 loadError，finally loading=false */
  }

  /** 任务行点击：先切到任务归属课程（跨课程队列场景，修复串课程上下文），再跳转 */
  function openTask(task: TodayTaskItem): void {
    if (task.courseId !== courseStore.currentCourseId) courseStore.setCurrent(task.courseId);
    const action = taskAction(task);
    if (action) {
      void router.push(action.to);
      return;
    }
    void router.push("/plan");
    getBridge().showMessage("该任务无绑定知识点，请在学习计划页处理");
  }

  async function toggleTask(task: TodayTaskItem): Promise<void> { /* HomeView 原样 */ }

  return { items, groups, loading, loadError, pendingTaskIds, dueReviewTotal,
    load, isCourseOpen, toggleCourse, openTask, toggleTask };
});
```

- [ ] **Step 4: 重构 HomeView 消费 store**

`HomeView.vue` 改动（模板今日任务段绑定同步改）：
- 删：`TodayTaskItem`/`CourseDayGroup` interface、`todayTasks`、`todayGroups`、`groupSummary` 保留（改用 `store.groups`）、`expandedCourses`/`isCourseOpen`/`toggleCourse`/`applyDefaultExpand`、`pendingTaskIds`、`openTask`/`toggleTask`、`load()` 中今日任务段
- 加：`const todayStore = useTodayStore();`；`load()` 内 `await getData()` 后调用 `void todayStore.load()`（两负载独立：store 自读今日任务，view 读仪表盘数据）；模板 `todayGroups`→`todayStore.groups`、`loading`→`todayStore.loading`、`loadError`→`todayStore.loadError`、`isCourseOpen`/`toggleCourse`/`openTask`/`toggleTask`→`todayStore.xxx`、`pendingTaskIds`→`todayStore.pendingTaskIds`
- `useDataSavedRefresh(() => load())` 保留（load 内部触发 todayStore.load）

- [ ] **Step 5: 全量验证（重构无回归）**

Run: `npx vitest run && npx vue-tsc --noEmit -p packages/siyuan/tsconfig.json && npx vue-tsc --noEmit -p packages/core/tsconfig.json`
Expected: 全绿（含新 today.test 6 例；桌面 HomeView 逻辑行为不变由既有测试 + 后续冒烟把关）

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/stores/today.ts packages/core/src/stores/__tests__/today.test.ts packages/core/src/views/HomeView.vue
git commit -m "refactor(mobile): 今日任务逻辑抽成 stores/today（跨课程聚合+归组+勾选），HomeView 改消费；openTask 先切任务归属课程（修复跨课程队列串上下文）"
```

---

### Task 3: TabBar 底部导航 + 「更多」弹层 + App 分支

**Files:**
- Create: `packages/core/src/composables/useTabBadges.ts`
- Test: `packages/core/src/composables/__tests__/useTabBadges.test.ts`
- Create: `packages/core/src/components/TabBar.vue`（组件本体不写单测，走 tsc + 冒烟，与视图层基线一致）
- Modify: `packages/core/src/App.vue`（Sidebar/TabBar 分支）
- Modify: `packages/core/src/style.css`（TabBar/弹层/安全区/触控）

**Interfaces:**
- Produces:
  - `useTabBadges(): { wrongTotal: number; cardDueTotal: number; refresh(): Promise<void> }`——活跃课程（非归档）`queryWrongQuestions(c.id).length` 求和 / `queryDueFlashcardCount(c.id)` 求和；内部 `useDataSavedRefresh(refresh, { scope: "any" })`（任意课程数据变化都刷新徽标，200ms 防抖）
  - TabBar 模板契约：5 项 = 首页 `/`、学习 `/study`、刷题 `/quiz`、复习 `/review`（徽标 `todayStore.dueReviewTotal`）、更多（按钮，非路由）；更多弹层 7 项两列：错题本 `/wrong`（徽标 wrongTotal）、闪卡组 `/cards`（徽标 cardDueTotal）、课程内容 `/content`、学习计划 `/plan`、知识图谱 `/graph`、学习报告 `/report`、模型设置 `/settings` + 快捷入口「＋新建课程」「上传资料」
- Consumes: `useIsMobile()`（Task 1）、`useTodayStore().dueReviewTotal`（Task 2）、`modalStore.openNewCourse()` / `modalStore.openUploadMaterial(courseId: number)`（现 `stores/modal.ts:36/60`）、`courseStore`
- 「上传资料」需当前课程：`courseStore.currentCourseId == null` 时 `showMessage("请先创建课程")`，不弹窗

- [ ] **Step 1: 写 useTabBadges 失败测试**

```ts
// packages/core/src/composables/__tests__/useTabBadges.test.ts
import { describe, expect, it } from "vitest";
import { createEmptyData, type AppData } from "../../types/appData";
import { setBridge } from "../../bridge";
import type { StudyBridge } from "../../bridge/types";

const dataRef: { data: AppData } = {
  data: {
    ...createEmptyData(),
    courses: [
      { id: 1, siyuanDocId: null, name: "课程A", description: "", target: "", totalCycle: "", status: "active", createTime: "2026-10-01T00:00:00Z", modelId: null },
      { id: 2, siyuanDocId: null, name: "课程B", description: "", target: "", totalCycle: "", status: "archived", createTime: "2026-10-01T00:00:00Z", modelId: null },
    ],
    questions: [
      { id: 1, courseId: 1, chapterId: null, kpId: null, type: "single", title: "错题1", options: ["A"], answer: "A", wrongStreak: 1, sourceAssetIds: "", examId: null, sort: 1, createTime: "2026-10-01T00:00:00Z" },
      { id: 2, courseId: 1, chapterId: null, kpId: null, type: "judge", title: "错题2", options: ["A"], answer: "A", wrongStreak: 2, sourceAssetIds: "", examId: null, sort: 2, createTime: "2026-10-01T00:00:00Z" },
      { id: 3, courseId: 2, chapterId: null, kpId: null, type: "single", title: "归档课错题", options: ["A"], answer: "A", wrongStreak: 1, sourceAssetIds: "", examId: null, sort: 1, createTime: "2026-10-01T00:00:00Z" },
    ] as AppData["questions"],
  },
};
(globalThis as Record<string, unknown>).window = {
  addEventListener: () => {},
  dispatchEvent: () => true,
};
setBridge({
  getData: async () => dataRef.data,
  saveData: async (next: AppData) => { dataRef.data = next; return { code: 0 }; },
  showMessage: () => {},
} as unknown as StudyBridge);

describe("useTabBadges", () => {
  it("错题徽标 = 活跃课程未毕业错题求和，归档课程不计入", async () => {
    const { useTabBadges } = await import("../useTabBadges");
    const badges = useTabBadges();
    await badges.refresh();
    expect(badges.wrongTotal).toBe(2);
  });

  it("数据变化后 refresh 得到新值", async () => {
    const { useTabBadges } = await import("../useTabBadges");
    const badges = useTabBadges();
    await badges.refresh();
    dataRef.data.questions = dataRef.data.questions.slice(0, 1);
    await badges.refresh();
    expect(badges.wrongTotal).toBe(1);
  });
});
```

注意：`queryWrongQuestions` 的「未毕业」过滤口径以 `packages/core/src/api/quiz.ts:256` 实现为准（wrongStreak 阈值），测试数据按实际过滤规则调整（若 `wrongStreak>=1` 即入错题本则 2 题均计）。`cardDueTotal` 用例按 `queryDueFlashcardCount` 的到期口径补 1 例（有到期闪卡课程计 1）。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/core/src/composables/__tests__/useTabBadges.test.ts`
Expected: FAIL（`../useTabBadges` 不存在）

- [ ] **Step 3: 实现 useTabBadges**

```ts
// packages/core/src/composables/useTabBadges.ts
import { ref } from "vue";
import { getData, queryWrongQuestions, queryDueFlashcardCount } from "../api";
import { useDataSavedRefresh } from "./useDataSaved";

/** TabBar/更多弹层徽标：活跃课程错题数与到期闪卡数求和（复习徽标取 todayStore.dueReviewTotal，不在这里重复查） */
export function useTabBadges() {
  const wrongTotal = ref(0);
  const cardDueTotal = ref(0);

  async function refresh(): Promise<void> {
    try {
      const data = await getData();
      const active = data.courses.filter((c) => c.status !== "archived");
      let wrong = 0;
      let cards = 0;
      for (const c of active) {
        wrong += (await queryWrongQuestions(c.id)).length;
        cards += await queryDueFlashcardCount(c.id);
      }
      wrongTotal.value = wrong;
      cardDueTotal.value = cards;
    } catch (e) {
      console.error("徽标刷新失败:", e);
    }
  }

  useDataSavedRefresh(refresh, { scope: "any" });
  void refresh();

  return { wrongTotal, cardDueTotal, refresh };
}
```

（`useDataSavedRefresh` 的 scope 取值以 `composables/useDataSaved.ts` 实际类型为准；无 "any" 选项时用 "global"——两者行为差异需先读该文件确认，计划实施时以现有实现为唯一事实。）

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run packages/core/src/composables/__tests__/useTabBadges.test.ts`
Expected: PASS

- [ ] **Step 5: 实现 TabBar.vue**

```vue
<template>
  <nav class="tabbar" aria-label="主导航">
    <router-link v-for="t in tabs" :key="t.to" :to="t.to" class="tab" active-class="active">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" v-html="icons[t.icon]"></svg>
      <span class="t-lbl">{{ t.label }}</span>
      <span v-if="t.badge > 0" class="tab-badge">{{ t.badge > 99 ? "99+" : t.badge }}</span>
    </router-link>
    <button type="button" class="tab" :class="{ active: moreOpen }" :aria-expanded="String(moreOpen)" @click="moreOpen = !moreOpen">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" v-html="icons.more"></svg>
      <span class="t-lbl">更多</span>
    </button>

    <!-- 更多：底部弹层（复用 .more-mask/.more-sheet 样式） -->
    <template v-if="moreOpen">
      <div class="more-mask" @click.self="closeMore"></div>
      <div class="more-sheet" role="dialog" aria-label="更多功能">
        <div class="more-grid">
          <button v-for="m in moreItems" :key="m.to" type="button" class="more-item" @click="go(m.to)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" v-html="icons[m.icon]"></svg>
            <span class="m-lbl">{{ m.label }}</span>
            <span v-if="m.badge > 0" class="tab-badge">{{ m.badge > 99 ? "99+" : m.badge }}</span>
          </button>
        </div>
        <div class="more-quick">
          <button type="button" class="btn" @click="quickNewCourse">＋ 新建课程</button>
          <button type="button" class="btn" @click="quickUpload">上传资料</button>
        </div>
      </div>
    </template>
  </nav>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useModalStore } from "../stores/modal";
import { useCourseStore } from "../stores/course";
import { getBridge } from "../bridge";
import { useIsMobile } from "../composables/useIsMobile";
import { useTodayStore } from "../stores/today";
import { useTabBadges } from "../composables/useTabBadges";

// 图标与 Sidebar 同源（viewBox 24 线性），抽到共享常量或本文件内联同一份记录
const icons = { /* 复用 Sidebar.vue 的 icons 记录：home/study/quiz/wrong/cards/plan/review/graph/report/settings/more 对应 path 片段 */ };

const router = useRouter();
const modalStore = useModalStore();
const courseStore = useCourseStore();
const { isMobile } = useIsMobile();
const todayStore = useTodayStore();
const badges = useTabBadges();
const moreOpen = ref(false);

const tabs = computed(() => [
  { to: "/", label: "首页", icon: "home" },
  { to: "/study", label: "学习", icon: "study" },
  { to: "/quiz", label: "刷题", icon: "quiz" },
  { to: "/review", label: "复习", icon: "review", badge: todayStore.dueReviewTotal },
]);
const moreItems = computed(() => [
  { to: "/wrong", label: "错题本", icon: "wrong", badge: badges.wrongTotal.value },
  { to: "/cards", label: "闪卡组", icon: "cards", badge: badges.cardDueTotal.value },
  { to: "/content", label: "课程内容", icon: "content", badge: 0 },
  { to: "/plan", label: "学习计划", icon: "plan", badge: 0 },
  { to: "/graph", label: "知识图谱", icon: "graph", badge: 0 },
  { to: "/report", label: "学习报告", icon: "report", badge: 0 },
  { to: "/settings", label: "模型设置", icon: "settings", badge: 0 },
]);

function closeMore(): void { moreOpen.value = false; }
function go(to: string): void { closeMore(); void router.push(to); }
function quickNewCourse(): void { closeMore(); modalStore.openNewCourse(); }
function quickUpload(): void {
  closeMore();
  if (courseStore.currentCourseId == null) {
    getBridge().showMessage("请先创建课程");
    return;
  }
  modalStore.openUploadMaterial(courseStore.currentCourseId);
}
function onKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") closeMore();
}
onMounted(() => { if (isMobile.value) document.addEventListener("keydown", onKeydown); });
onBeforeUnmount(() => document.removeEventListener("keydown", onKeydown));
</script>
```

图标记录：把 `Sidebar.vue` 的 `icons` 抽到 `packages/core/src/components/icons.ts` 导出（Sidebar 同步改 import，避免两份拷贝）；缺的 `content`/`more` 图标按现有风格补 path（more 用九宫格）。

- [ ] **Step 6: App.vue 分支**

`packages/core/src/App.vue`：
```vue
<template>
  <div class="ai-study-app">
    <Sidebar v-if="!isMobile" />
    <main class="main">
      <Topbar />
      <div class="content">
        <router-view v-slot="{ Component }">
          <keep-alive :include="cachedViews">
            <component :is="Component" />
          </keep-alive>
        </router-view>
      </div>
      <TabBar v-if="isMobile" />
    </main>
    <!-- 既有 modal 区不动 -->
  </div>
</template>
```
script 增加 `const { isMobile } = useIsMobile();` + `import TabBar from "./components/TabBar.vue";`。
（TabBar 在 `.main` 内、`.content` 之后 → in-flow 布局：`.main` 是 flex column，`.content` flex:1，TabBar 自然贴底；键盘弹起 in-flow 整体上移。）

- [ ] **Step 7: style.css 追加**

```css
/* ===== 移动端：底部 TabBar（in-flow，不用 fixed，键盘弹起自动让位）===== */
.tabbar {
  display: flex;
  flex-shrink: 0;
  border-top: 1px solid var(--as-border-soft);
  background: var(--as-bg-elev);
  padding-bottom: env(safe-area-inset-bottom);
}
.tabbar .tab {
  position: relative;
  flex: 1;
  min-height: 52px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  color: var(--as-text-faint);
  text-decoration: none;
}
.tabbar .tab svg { width: 22px; height: 22px; }
.tabbar .tab .t-lbl { font-size: 11px; line-height: 1; }
.tabbar .tab.active { color: var(--as-accent); }
.tab-badge {
  position: absolute;
  top: 6px;
  right: calc(50% - 22px);
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--as-accent);
  color: #fff;
  font-size: 10px;
  line-height: 16px;
  text-align: center;
  pointer-events: none;
}

/* ===== 移动端：底部弹层（更多/切课程共用）===== */
.more-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 60;
}
.more-sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 61;
  background: var(--as-bg-elev);
  border-radius: 16px 16px 0 0;
  padding: 16px 16px calc(16px + env(safe-area-inset-bottom));
  animation: sheet-up 0.18s ease;
}
@keyframes sheet-up {
  from { transform: translateY(40%); opacity: 0; }
  to { transform: none; opacity: 1; }
}
.more-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
.more-item {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  min-height: 64px;
  border: none;
  background: var(--as-bg-soft);
  border-radius: 10px;
  color: var(--as-text);
}
.more-item svg { width: 22px; height: 22px; }
.more-item .m-lbl { font-size: 12px; }
.more-quick {
  display: flex;
  gap: 10px;
  margin-top: 14px;
}
.more-quick .btn { flex: 1; }

/* ===== 移动端：内容区与触控目标 ===== */
@media (max-width: 768px) {
  .content { padding: 14px; }
  .task-row { min-height: 44px; }
  .chip { min-height: 40px; }
}
```

（类名 `--as-*` 变量、`.task-row`/`.chip` 以 style.css 现有实际命名为准；触控目标 44px 若现有类名不同，实施时按实际类名调整，规则不变：可点击热区 ≥44px。）

- [ ] **Step 8: 全量验证**

Run: `npx vitest run && npx vue-tsc --noEmit -p packages/siyuan/tsconfig.json && npx vue-tsc --noEmit -p packages/core/tsconfig.json`
Expected: 全绿

- [ ] **Step 9: 提交**

```bash
git add packages/core/src/composables/useTabBadges.ts packages/core/src/composables/__tests__/useTabBadges.test.ts packages/core/src/components/TabBar.vue packages/core/src/components/icons.ts packages/core/src/components/Sidebar.vue packages/core/src/App.vue packages/core/src/style.css
git commit -m "feat(mobile): 底部 TabBar（首页/学习/刷题/复习/更多+徽标）与更多弹层，App 按断点分支 Sidebar/TabBar"
```

---

### Task 4: 思源宿主底栏隐藏 `useMobileHostBar`

**Files:**
- Create: `packages/core/src/composables/useMobileHostBar.ts`
- Test: `packages/core/src/composables/__tests__/useMobileHostBar.test.ts`
- Modify: `packages/core/src/App.vue`（根节点 template ref + 接线）

**Interfaces:**
- Produces:
  - `applyHostBarVisibility(bar: { style: { setProperty(k: string, v: string): void; removeProperty(k: string): void } }, visible: boolean): void`——纯函数：插件 app 可见 → `visibility:hidden`；不可见 → `removeProperty("visibility")`（把元素完全归还宿主；宿主滚动显隐只写 `--mobile-bar-translate-y/--mobile-bar-opacity` 两个 inline 变量，不碰 visibility，互不干扰）
  - `useMobileHostBar(target: () => HTMLElement | null): void`——`watch(isMobile, { immediate: true })`：mobile 时 `IntersectionObserver` 观察 target（`.ai-study-app` 根；思源切 tab 用 display:none，IO 可判）；非 mobile 或无 `#mobileBottomBar` 或无 IO 时静默跳过；组件卸载（插件 unmount）必须 teardown：`disconnect()` + `removeProperty`
- 风险对策（spec 风险表）：unmount 未清理 → 宿主底栏永久消失，测试必覆盖 teardown 路径

- [ ] **Step 1: 写失败测试**

```ts
// packages/core/src/composables/__tests__/useMobileHostBar.test.ts
import { describe, expect, it } from "vitest";

// 纯函数 + 假 style 对象（node 环境无 DOM，不测 IO 接线，接线由冒烟把关）
describe("applyHostBarVisibility", () => {
  it("插件可见：宿主底栏 visibility=hidden", () => {
    const { applyHostBarVisibility } = require("../useMobileHostBar") as typeof import("../useMobileHostBar");
    const style: Record<string, string> = {};
    const bar = {
      style: {
        setProperty: (k: string, v: string) => { style[k] = v; },
        removeProperty: (k: string) => { delete style[k]; },
      },
    };
    applyHostBarVisibility(bar, true);
    expect(style.visibility).toBe("hidden");
  });

  it("插件不可见：移除 visibility，完全归还宿主", () => {
    const { applyHostBarVisibility } = require("../useMobileHostBar") as typeof import("../useMobileHostBar");
    const style: Record<string, string> = { visibility: "hidden" };
    const bar = {
      style: {
        setProperty: (k: string, v: string) => { style[k] = v; },
        removeProperty: (k: string) => { delete style[k]; },
      },
    };
    applyHostBarVisibility(bar, false);
    expect(style.visibility).toBeUndefined();
  });
});
```

（实施说明：node 环境用 `vi.importActual`/`await import` 替代 `require`，按项目 ESM 测试惯例写成 `const { applyHostBarVisibility } = await import("../useMobileHostBar");`，`describe` 内用顶层 `await import` 前置。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/core/src/composables/__tests__/useMobileHostBar.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
// packages/core/src/composables/useMobileHostBar.ts
import { onBeforeUnmount, watch } from "vue";
import { useIsMobile } from "./useIsMobile";

type StyleLike = { setProperty(k: string, v: string): void; removeProperty(k: string): void };

/** 纯函数：控制思源移动端宿主胶囊底栏（#mobileBottomBar）显隐。
 *  用 visibility 而非 display/opacity：宿主滚动显隐逻辑只写 --mobile-bar-translate-y /
 *  --mobile-bar-opacity 两个 inline 变量，不碰 visibility，两套机制不互相覆盖。 */
export function applyHostBarVisibility(bar: { style: StyleLike }, visible: boolean): void {
  if (visible) bar.style.setProperty("visibility", "hidden");
  else bar.style.removeProperty("visibility");
}

/** 插件 app 可见时隐藏宿主底栏，切走/卸载时归还。
 *  思源切 tab 用 display:none（元素留 DOM）→ IntersectionObserver 可判定；
 *  键盘弹起宿主自身会让位，in-flow TabBar 自然上移，无需额外处理。 */
export function useMobileHostBar(target: () => HTMLElement | null): void {
  const { isMobile } = useIsMobile();
  let io: IntersectionObserver | null = null;
  let bar: HTMLElement | null = null;

  function teardown(): void {
    io?.disconnect();
    io = null;
    bar?.style.removeProperty("visibility");
    bar = null;
  }

  function setup(): void {
    const root = target();
    if (!root || typeof IntersectionObserver === "undefined") return;
    bar = document.getElementById("mobileBottomBar");
    if (!bar) return;
    io = new IntersectionObserver((entries) => {
      applyHostBarVisibility(bar!, entries.some((e) => e.isIntersecting));
    });
    io.observe(root);
    applyHostBarVisibility(bar, true);
  }

  watch(isMobile, (mobile) => {
    teardown();
    if (mobile) setup();
  }, { immediate: true });

  onBeforeUnmount(teardown);
}
```

- [ ] **Step 4: App.vue 接线**

`App.vue`：根节点 `<div ref="appRoot" class="ai-study-app">`，script：
```ts
import { ref } from "vue";
import { useMobileHostBar } from "./composables/useMobileHostBar";
const appRoot = ref<HTMLElement | null>(null);
useMobileHostBar(() => appRoot.value);
```

- [ ] **Step 5: 全量验证**

Run: `npx vitest run && npx vue-tsc --noEmit -p packages/siyuan/tsconfig.json && npx vue-tsc --noEmit -p packages/core/tsconfig.json`
Expected: 全绿

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/composables/useMobileHostBar.ts packages/core/src/composables/__tests__/useMobileHostBar.test.ts packages/core/src/App.vue
git commit -m "feat(mobile): 插件可见时隐藏思源宿主胶囊底栏（visibility+IO），切走/卸载归还"
```

---

### Task 5: 课程列表/切换弹层 `CourseSwitcherSheet`

**Files:**
- Create: `packages/core/src/components/CourseSwitcherSheet.vue`
- Modify: `packages/core/src/stores/course.ts`（加 `ensureLoaded()`）
- Modify: `packages/core/src/App.vue`（onMounted 调 `courseStore.ensureLoaded()`）

**Interfaces:**
- Produces: `<CourseSwitcherSheet :open="boolean" @close />`——选中课程 = `courseStore.setCurrent(c.id)` + emit close（**不导航**，移动端首页原地切换；当前页是课程内容/计划等课程级页面时由各自视图响应 currentCourseId 变化）
- courseStore 新增 action：`ensureLoaded(): Promise<void>`——`courses.length > 0` 直接返回，否则 `refresh()`（幂等；解决移动端 Sidebar 不挂载时课程列表无人加载的问题；桌面 Sidebar 的 onMounted 重复调用无害）
- 弹层内容：标题「切换课程」+ 全部课程行（emoji + 名称 + 归档置灰加「已归档」tag + 当前课程 ✓）+ 底部「＋新建课程」（`modalStore.openNewCourse()`）
- 点击遮罩 / Esc 关闭

- [ ] **Step 1: courseStore.ensureLoaded**

```ts
// stores/course.ts actions 内追加
async ensureLoaded() {
  if (this.courses.length > 0) return;
  await this.refresh();
},
```
`App.vue` script：`import { useCourseStore } from "./stores/course"; const courseStore = useCourseStore();` + `onMounted(() => { void courseStore.ensureLoaded(); })`

- [ ] **Step 2: 实现 CourseSwitcherSheet.vue**

```vue
<template>
  <template v-if="open">
    <div class="more-mask" @click.self="close"></div>
    <div class="more-sheet" role="dialog" aria-label="切换课程">
      <div class="cs-head">切换课程</div>
      <div v-if="courses.length === 0" class="empty">
        还没有课程，先创建一个吧
      </div>
      <div v-for="c in courses" :key="c.id" class="cs-item" :class="{ active: c.id === currentCourseId, archived: c.status === 'archived' }" @click="select(c.id)">
        <span class="cs-emoji">{{ c.emoji }}</span>
        <span class="cs-name">{{ c.name }}</span>
        <span v-if="c.status === 'archived'" class="tag archived-tag">已归档</span>
        <span v-if="c.id === currentCourseId" class="cs-check">✓</span>
      </div>
      <div class="more-quick">
        <button type="button" class="btn" @click="addNew">＋ 新建课程</button>
      </div>
    </div>
  </template>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from "vue";
import { useCourseStore } from "../stores/course";
import { useModalStore } from "../stores/modal";
import type { Course } from "../api";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: "close"): void }>();

const courseStore = useCourseStore();
const modalStore = useModalStore();
const courses = computed(() => courseStore.courses);

function close(): void { emit("close"); }
function select(id: number): void {
  if (id !== courseStore.currentCourseId) courseStore.setCurrent(id);
  close();
}
function addNew(): void { close(); modalStore.openNewCourse(); }
function onKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") close();
}
onMounted(() => {
  void courseStore.ensureLoaded();
  if (props.open) document.addEventListener("keydown", onKeydown);
});
onBeforeUnmount(() => document.removeEventListener("keydown", onKeydown));
</script>
```

- [ ] **Step 3: style.css 追加弹层行样式**

```css
/* 课程切换弹层行 */
.cs-head { font-size: 15px; font-weight: 600; margin-bottom: 12px; color: var(--as-text); }
.cs-item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 48px;
  padding: 6px 10px;
  border-radius: 10px;
  cursor: pointer;
  color: var(--as-text);
}
.cs-item:active { background: var(--as-bg-soft); }
.cs-item.active { background: var(--as-accent-soft, rgba(59, 130, 246, 0.1)); }
.cs-item.archived { opacity: 0.55; }
.cs-emoji { font-size: 18px; line-height: 1; }
.cs-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cs-check { color: var(--as-accent); font-weight: 600; }
```
（`.empty`/`.tag`/`.archived-tag`/`--as-accent-soft` 以 style.css 现有同名类与变量为准；缺 `--as-accent-soft` 时用 `color-mix` 或现有 soft 变量。）

- [ ] **Step 4: 全量验证**

Run: `npx vitest run && npx vue-tsc --noEmit -p packages/siyuan/tsconfig.json && npx vue-tsc --noEmit -p packages/core/tsconfig.json`
Expected: 全绿

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/components/CourseSwitcherSheet.vue packages/core/src/stores/course.ts packages/core/src/App.vue packages/core/src/style.css
git commit -m "feat(mobile): 课程切换底部弹层（当前✓/归档置灰/新建入口），courseStore.ensureLoaded 兜底课程加载"
```

---

### Task 6: 移动首页 `MobileHomePanel` + HomeView 分支

**Files:**
- Create: `packages/core/src/components/home/MobileHomePanel.vue`
- Modify: `packages/core/src/views/HomeView.vue`（模板根部 `v-if="isMobile"` 分支）

**Interfaces:**
- Produces: `<MobileHomePanel />`（无 props）——结构：
  1. 课程行（点击弹 `CourseSwitcherSheet`）：emoji + 当前课程名 + `M/N 已掌握`（当前课程 KP 按 mastery 聚合，非归档）+ `▾`
  2. 「今日任务」段（复用 HomeView 既有 markup 与 `StudyTaskRow`）：跨课程聚合、按课程归组、未完成在前、可勾选、点击直达；标题旁 hint「跨课程 · 计划 + 到期间隔复习」
- Consumes: `useTodayStore`（Task 2）、`CourseSwitcherSheet`（Task 5）、`useIsMobile`、`useDataSavedRefresh`
- 桌面模板不动（Task 2 已把今日任务段改为消费 todayStore，桌面/移动共用 store）
- 已掌握口径：`data.knowledgePoints.filter(k => k.courseId === currentCourseId && k.mastery === "mastered").length` / 总数（与桌面课程卡片同一口径；实现前对照 `CourseHomeView.vue` 的 mastered 统计，若口径含 `known` 则一致跟随）

- [ ] **Step 1: 实现 MobileHomePanel.vue**

```vue
<template>
  <div class="page mobile-home">
    <!-- 课程行：当前课程 + 进度 + 切换入口 -->
    <button type="button" class="mh-course-row" @click="sheetOpen = true">
      <span class="cs-emoji">{{ currentCourse?.emoji }}</span>
      <span class="mh-course-name">{{ currentCourse?.name ?? "未选择课程" }}</span>
      <span v-if="kpTotal > 0" class="mh-course-prog">{{ kpMastered }}/{{ kpTotal }} 已掌握</span>
      <span class="chev" aria-hidden="true">▾</span>
    </button>

    <!-- 今日任务：跨课程聚合（与桌面首页同一数据源 todayStore） -->
    <div class="section-head">
      <h2>今日任务</h2>
      <span class="hint">跨课程 · 计划 + 到期间隔复习</span>
    </div>
    <div class="card">
      <SkeletonList v-if="todayStore.loading" :lines="4" />
      <LoadError v-else-if="todayStore.loadError" :message="todayStore.loadError" @retry="todayStore.load" />
      <div v-else-if="todayStore.groups.length === 0" class="empty">
        今日暂无任务<br /><span class="hint">去学习计划创建，或等待间隔复习到期</span>
      </div>
      <div v-else class="today-groups">
        <div v-for="g in todayStore.groups" :key="g.courseId" class="course-group">
          <div class="group-head" @click="todayStore.toggleCourse(g.courseId)">
            <span class="chev" :class="{ open: todayStore.isCourseOpen(g.courseId) }">▸</span>
            <span class="g-name">{{ g.courseName }}</span>
            <span class="g-counts">{{ groupSummary(g) }}</span>
          </div>
          <template v-if="todayStore.isCourseOpen(g.courseId)">
            <StudyTaskRow
              v-for="t in g.tasks"
              :key="t.id"
              :title="t.title"
              :task-type="t.taskType"
              :done="t.done"
              :checkable="t.kind === 'plan'"
              :busy="todayStore.pendingTaskIds.has(t.id)"
              :course-name="g.courseName"
              :dense="true"
              @click="todayStore.openTask(t)"
              @toggle="todayStore.toggleTask(t)"
            />
          </template>
        </div>
      </div>
    </div>

    <CourseSwitcherSheet :open="sheetOpen" @close="sheetOpen = false" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useCourseStore } from "../../stores/course";
import { useTodayStore, type CourseDayGroup } from "../../stores/today";
import { useDataSavedRefresh } from "../../composables/useDataSaved";
import { getData, countPlanDays } from "../../api"; // 以实际导出为准
import { TASK_TYPE_LABELS } from "../../constants/tasks";
import SkeletonList from "../../components/SkeletonList.vue";
import LoadError from "../../components/LoadError.vue";
import StudyTaskRow from "../../components/StudyTaskRow.vue";
import CourseSwitcherSheet from "../../components/CourseSwitcherSheet.vue";

const courseStore = useCourseStore();
const todayStore = useTodayStore();
const sheetOpen = ref(false);
const kpMastered = ref(0);
const kpTotal = ref(0);
const currentCourse = computed(() => courseStore.currentCourse);

function groupSummary(g: CourseDayGroup): string {
  const parts = Object.entries(g.counts).map(([type, n]) => `${TASK_TYPE_LABELS[type as keyof typeof TASK_TYPE_LABELS] ?? type} ×${n}`);
  return parts.join(" · ");
}

async function loadKpStats(): Promise<void> {
  try {
    const data = await getData();
    const kps = data.knowledgePoints.filter((k) => k.courseId === courseStore.currentCourseId);
    kpTotal.value = kps.length;
    kpMastered.value = kps.filter((k) => k.mastery === "mastered").length;
  } catch (e) {
    console.error("课程掌握统计失败:", e);
  }
}

function refresh(): void {
  void todayStore.load();
  void loadKpStats();
}

onMounted(() => {
  void courseStore.ensureLoaded();
  refresh();
});
useDataSavedRefresh(refresh, { scope: "global" });
</script>
```

- [ ] **Step 2: style.css 追加移动首页样式**

```css
/* 移动首页 */
.mobile-home { max-width: 640px; margin: 0 auto; }
.mh-course-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 48px;
  padding: 8px 12px;
  border: 1px solid var(--as-border-soft);
  border-radius: 12px;
  background: var(--as-bg-elev);
  color: var(--as-text);
  cursor: pointer;
}
.mh-course-name {
  flex: 1;
  font-size: 15px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mh-course-prog { font-size: 12px; color: var(--as-text-faint); }
.mobile-home .chev { color: var(--as-text-faint); font-size: 12px; }
```

- [ ] **Step 3: HomeView 分支**

`HomeView.vue` 模板：
```vue
<template>
  <MobileHomePanel v-if="isMobile" />
  <div v-else class="page">
    <!-- 既有桌面模板原样（hero/课程卡片/今日任务/dashboard） -->
  </div>
</template>
```
script 增加 `import { useIsMobile } from "../composables/useIsMobile"; const { isMobile } = useIsMobile();` + `import MobileHomePanel from "../components/home/MobileHomePanel.vue";`。
桌面分支的 onMounted/数据加载逻辑保留在 HomeView（v-else 不渲染时 setup 仍执行——可接受：`load()` 开销小；或把 onMounted 的加载包进 `if (!isMobile.value)`，实施时取后者避免移动端双加载）。

- [ ] **Step 4: 全量验证**

Run: `npx vitest run && npx vue-tsc --noEmit -p packages/siyuan/tsconfig.json && npx vue-tsc --noEmit -p packages/core/tsconfig.json`
Expected: 全绿

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/components/home/MobileHomePanel.vue packages/core/src/views/HomeView.vue packages/core/src/style.css
git commit -m "feat(mobile): 独立移动首页（课程行切换+跨课程今日任务聚合），HomeView 按断点分支"
```

---

### Task 7: Topbar 移动端简化

**Files:**
- Modify: `packages/core/src/components/Topbar.vue`

**Interfaces:**
- Produces: 移动端 Topbar = 左「当前课程名 ▾」（点击弹 `CourseSwitcherSheet`）+ 右「通知铃铛 + 主题钮」；**隐藏**面包屑、`topbar-today` 指标区、changelog/反馈入口（移动端不占位，功能经「更多」弹层/设置页可达）
- 桌面分支（`v-else`）原样不动
- 消费 `useIsMobile`（Task 1）、`CourseSwitcherSheet`（Task 5）

- [ ] **Step 1: 改造 Topbar.vue**

模板骨架（既有子块按实际类名对位）：
```vue
<template>
  <div class="topbar">
    <!-- 移动端：课程名入口 -->
    <button v-if="isMobile" type="button" class="topbar-course" @click="courseSheetOpen = true">
      <span class="topbar-course-name">{{ courseStore.currentCourse?.name ?? "未选择课程" }}</span>
      <span class="chev" aria-hidden="true">▾</span>
    </button>
    <!-- 桌面：面包屑原样 -->
    <div v-else class="crumbs">
      <!-- 既有 crumbs 内容不动 -->
    </div>

    <div class="spacer"></div>

    <!-- 桌面：今日指标（移动端隐藏，指标已在移动首页课程行/任务队列体现） -->
    <div v-if="!isMobile && currentCourseId" class="topbar-today">
      <!-- 既有指标不动 -->
    </div>

    <!-- 通知铃铛：两端保留 -->
    <div class="notify-wrap">
      <!-- 既有铃铛+面板不动 -->
    </div>

    <!-- 主题钮：两端保留 -->
    <button type="button" class="icon-btn" @click="toggleTheme">
      <!-- 既有图标不动 -->
    </button>

    <CourseSwitcherSheet v-if="isMobile" :open="courseSheetOpen" @close="courseSheetOpen = false" />
  </div>
</template>
```
script 增加 `useIsMobile` + `courseSheetOpen = ref(false)` + `CourseSwitcherSheet` import。changelog/反馈按钮（若在 Topbar）包 `v-if="!isMobile"`。

- [ ] **Step 2: style.css 追加**

```css
/* Topbar 移动端 */
.topbar-course {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 0 8px;
  border: none;
  background: none;
  color: var(--as-text);
  cursor: pointer;
}
.topbar-course-name {
  font-size: 15px;
  font-weight: 600;
  max-width: 48vw;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (max-width: 768px) {
  .topbar { padding: 0 10px; }
}
```

- [ ] **Step 3: 全量验证**

Run: `npx vitest run && npx vue-tsc --noEmit -p packages/siyuan/tsconfig.json && npx vue-tsc --noEmit -p packages/core/tsconfig.json`
Expected: 全绿

- [ ] **Step 4: 提交**

```bash
git add packages/core/src/components/Topbar.vue packages/core/src/style.css
git commit -m "feat(mobile): Topbar 移动端简化（课程名切换入口，隐藏面包屑与今日指标）"
```

---

### Task 8: 触控细调 + 全量验证 + 冒烟

**Files:**
- Modify: `packages/core/src/style.css`（触控目标/移动端滚动条/安全区收口）
- Modify: `packages/siyuan/plugin.json` 与根 `package.json` 的 changelog 条目（版本号由用户发布时定，本任务只写「移动端 Tab 导航 + 移动首页」条目文案）

**Interfaces:**
- 无新接口；产出 = 可发版的移动端体验 + 冒烟证据

- [ ] **Step 1: 触控目标收口**

逐页过一遍（375px 视口冒烟时同步核）：
- 可点击热区 ≥44px：`.task-row`、`.cs-item`（已 48）、TabBar `.tab`（已 52）、`.more-item`（已 64）、`.mh-course-row`（已 48）、`.topbar-course`（已 44）
- 间距不足处加 `padding` 而非 `margin`（热区扩大不挤布局）
- 移动端隐藏横向滚动条样式干扰：`@media (max-width: 768px) { .content { -webkit-overflow-scrolling: touch; } }`
- 横屏/宽手机（>768px 的手机，如 iPad 横放）回落桌面布局：可接受（spec 不覆盖平板）

- [ ] **Step 2: 全量验证（发布前门禁）**

Run:
```bash
npx vitest run
npx vue-tsc --noEmit -p packages/siyuan/tsconfig.json && npx vue-tsc --noEmit -p packages/core/tsconfig.json
npm run build:web && npm run build:plugin && node scripts/make_install.js && npm run pack:fnos
```
Expected: 测试全绿（含新增 ~15 例）、双 tsc 零错误、双端产物 + 安装包生成成功

- [ ] **Step 3: 冒烟（ego-browser，375/430 移动 + 1127 桌面回归）**

前置：`reloadPlugin AIstudy` + 整页刷新后开 `div[aria-label="AI 智能学习"]` 页签（web bundle 每页会话只加载一次）。

移动验证（taskSpace `aistudy-a7-audit` p2，390x844 `Emulation.setDeviceMetricsOverride`；再各验一次 375/430）：
1. `#mobileBottomBar` 在插件 app 可见时 `visibility:hidden`；切走 AIstudy 页签后 inline visibility 被移除（`getComputedStyle` 或读 `el.style.visibility === ""`）
2. 底栏 TabBar 五项齐全（首页/学习/刷题/复习/更多），当前路由 tab 高亮；复习徽标 = todayStore 到期复习数（造 1 个到期 schedule 验证数字）
3. 首页：课程行显示当前课程 + M/N；点击弹 CourseSwitcherSheet，选另一课程 → 课程行与内容切换、sheet 关闭
4. 今日任务：跨课程任务都浮现、按课程归组、未完成在前；勾选 → 落库（getData 复查 status）；点击 learn 任务 → 跳 `/study?kp=` 且**当前课程已切到任务归属课程**（验证 Task 2 修复）；点击 review 任务 → 跳 `/review?kp=`
5. 更多弹层：7 项齐全（错题本/闪卡组徽标数字正确）、点击跳转、Esc/遮罩关闭；「＋新建课程」弹新建流程、「上传资料」有课程时弹上传
6. Topbar：只显示课程名+铃铛+主题钮（无面包屑/指标）
7. 键盘：聚焦输入框（如刷题答题）→ TabBar in-flow 上移、不被遮挡
8. 学习/刷题/复习三个 tab 全链路各走一个最小用例（学一个 KP 讲解 / 刷一道题 / 完成一次复习评分），确认无布局破损、无控制台报错

桌面回归（1127px 页签）：
1. 无 TabBar、Sidebar 正常、Topbar 面包屑+指标齐全（`v-if` 分支零变化）
2. 桌面首页今日任务段与改动前一致（勾选/直达/归组行为不变）
3. `#mobileBottomBar` 在桌面端不存在 → `useMobileHostBar` 静默跳过（无控制台报错）

- [ ] **Step 4: 冒烟后清理**

删掉冒烟造数（临时 schedule/KP 等，`removeDoc`/数据接口清理），`getData` 复查无残留；多余页签中键点掉。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(mobile): 触控目标与安全区收口，移动端 Tab 导航 + 移动首页完成"
```

---

## Self-Review（写完计划后逐项核对）

- [x] Spec 覆盖核对：
  - 断点 useIsMobile → Task 1 ✓
  - TabBar 五项 + 徽标 + 更多弹层 → Task 3 ✓（徽标口径：复习=dueReviewTotal、错题/闪卡=跨课程求和，与 spec §2 一致）
  - 宿主底栏处理（visibility/IO/unmount 清理）→ Task 4 ✓（spec §2.1 风险表对应测试）
  - 课程切换弹层 → Task 5 ✓
  - 移动首页（课程行 + 跨课程聚合）→ Task 6 ✓（数据源 = todayStore，与 spec「复用既有聚合逻辑」一致）
  - Topbar 简化 → Task 7 ✓
  - 触控 ≥44px + 验证 → Task 8 ✓
  - spec「桌面零变化」→ 各任务 Step 的 v-else 原样约束 + Task 8 桌面回归冒烟 ✓
- [x] 无占位符：TabBar/HomeView 模板均给全量代码；`icons` 记录标注「复用 Sidebar 同源」为明确指令而非 TODO
- [x] 类型一致性：`TodayTaskItem`/`CourseDayGroup`/`dueReviewTotal`/`useTabBadges` 的 `wrongTotal`/`cardDueTotal` 在 Task 2/3/6 间签名一致；`CourseSwitcherSheet` props/emits 在 Task 5/6/7 间一致
- [x] 待实施时确认的事实（已显式标注，非盲区）：`useDataSavedRefresh` 的 scope 取值、`updateStudyTask` 内部桥调用点、`queryWrongQuestions` 毕业过滤口径、mastery 统计口径（mastered vs mastered+known）、style.css 现有类名/变量名——实施到对应 Step 时先读实际代码再落笔，不得凭本计划猜测
- [x] 测试策略：纯逻辑（store/composable/纯函数）全有 node 环境单测；UI 组件（TabBar/Sheet/Panel）走 tsc + 冒烟（与 R5.6 视图层不纳入单测的基线一致）
