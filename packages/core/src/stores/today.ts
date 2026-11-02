import { defineStore } from "pinia";
import { computed, reactive, ref } from "vue";
import router from "../router";
import { useCourseStore } from "./course";
import { getBridge } from "../bridge";
import { getData, queryDueReviews, updateStudyTask, formatLocalDate, truncateText } from "../api";
import { taskAction } from "../constants/tasks";

export interface TodayTaskItem {
  id: number;
  courseId: number;
  /** plan=计划任务（可手动勾选）；review=到期 SM2 复习项（评级即完成，id 取负 schedule.id 防冲突） */
  kind: "plan" | "review";
  planId: number;
  chapterId: number | null;
  kpId: number | null;
  taskType: string;
  scheduledDate: string;
  sort: number;
  title: string;
  course: string;
  done: boolean;
}

export interface CourseDayGroup {
  courseId: number;
  courseName: string;
  tasks: TodayTaskItem[];
  counts: Record<string, number>;
  doneCount: number;
}

/**
 * 跨课程今日任务（桌面首页与移动首页共用）：
 * 计划任务（今天排期，可手动勾选）+ 到期 SM2 复习项（KP/错题/闪卡触点，评级即完成）。
 * 已归档课程仅查看：其任务与到期复习不浮现。
 */
export const useTodayStore = defineStore("today", () => {
  const courseStore = useCourseStore();
  const items = reactive<TodayTaskItem[]>([]);
  const loading = ref(false);
  const loadError = ref("");
  /** 正在写入的任务：防止连点，勾选框显示转圈 */
  const pendingTaskIds = ref<Set<number>>(new Set());
  /** 课程行展开状态：仅一门课程有任务时默认展开，多门默认收起 */
  const expandedCourses = ref<Set<number>>(new Set());
  let loadedGroupsKey = "";

  /** 今日任务按课程归组（组间保持课程原顺序，组内未完成在前） */
  const groups = computed<CourseDayGroup[]>(() => {
    const map = new Map<number, CourseDayGroup>();
    for (const t of items) {
      const g = map.get(t.courseId) ?? {
        courseId: t.courseId,
        courseName: t.course,
        tasks: [],
        counts: {},
        doneCount: 0,
      };
      g.tasks.push(t);
      g.counts[t.taskType] = (g.counts[t.taskType] ?? 0) + 1;
      if (t.done) g.doneCount += 1;
      map.set(t.courseId, g);
    }
    return [...map.values()];
  });

  function isCourseOpen(courseId: number): boolean {
    return expandedCourses.value.has(courseId);
  }

  function toggleCourse(courseId: number): void {
    const next = new Set(expandedCourses.value);
    if (next.has(courseId)) next.delete(courseId);
    else next.add(courseId);
    expandedCourses.value = next;
  }

  function applyDefaultExpand(): void {
    const key = groups.value
      .map((g) => `${g.courseId}:${g.tasks.map((t) => t.id).join(",")}`)
      .join("|");
    if (key === loadedGroupsKey) return;
    loadedGroupsKey = key;
    expandedCourses.value =
      groups.value.length === 1 ? new Set([groups.value[0].courseId]) : new Set();
  }

  async function load(): Promise<void> {
    loading.value = true;
    loadError.value = "";
    try {
      const data = await getData();
      const activeCourses = data.courses.filter((c) => c.status !== "archived");
      const today = formatLocalDate();
      const next: TodayTaskItem[] = [];
      for (const c of activeCourses) {
        const plans = data.studyPlans.filter((p) => p.courseId === c.id && p.status !== "paused");
        for (const p of plans) {
          const tasks = data.studyTasks.filter((t) => t.planId === p.id && t.scheduledDate === today);
          for (const t of tasks) {
            next.push({
              id: t.id,
              courseId: c.id,
              kind: "plan",
              planId: t.planId,
              chapterId: t.chapterId,
              kpId: t.kpId ?? null,
              taskType: t.taskType,
              scheduledDate: t.scheduledDate,
              sort: t.sort,
              title: t.title,
              course: c.name,
              done: t.status === "done",
            });
          }
        }
      }
      // 到期间隔复习项：完成 = 复习计划页评级（dueTime 推后后自动消失）
      for (const c of activeCourses) {
        for (const item of await queryDueReviews(c.id)) {
          const kp = item.knowledgePoint;
          const q = item.question;
          const card = item.flashcard;
          next.push({
            id: -item.schedule.id,
            courseId: c.id,
            kind: "review",
            planId: 0,
            chapterId: null,
            kpId: item.schedule.kpId,
            taskType: "review",
            scheduledDate: item.schedule.dueTime,
            sort: 0,
            title: kp ? `复习：${kp.name}` : q ? `错题复习：${q.title}` : card ? `闪卡：${truncateText(card.front, 24)}` : `复习 #${item.schedule.id}`,
            course: c.name,
            done: false,
          });
        }
      }
      next.sort((a, b) => Number(a.done) - Number(b.done));
      items.splice(0, items.length, ...next);
      applyDefaultExpand();
    } catch (e) {
      loadError.value = e instanceof Error ? e.message : "加载失败";
      console.error("加载今日任务失败:", e);
    } finally {
      loading.value = false;
    }
  }

  /** 任务行点击：先切到任务归属课程（跨课程队列场景，避免串课程上下文），再按任务类型直达 */
  function openTask(task: TodayTaskItem): void {
    if (task.courseId !== courseStore.currentCourseId) {
      courseStore.setCurrent(task.courseId);
    }
    const action = taskAction(task);
    if (action) {
      void router.push(action.to);
      return;
    }
    void router.push("/plan");
    getBridge().showMessage("该任务无绑定知识点，请在学习计划页处理");
  }

  async function toggleTask(task: TodayTaskItem): Promise<void> {
    if (pendingTaskIds.value.has(task.id)) return;
    pendingTaskIds.value = new Set(pendingTaskIds.value).add(task.id);
    try {
      await updateStudyTask({
        id: task.id,
        planId: task.planId,
        chapterId: task.chapterId,
        kpId: task.kpId,
        taskType: task.taskType,
        title: task.title,
        scheduledDate: task.scheduledDate,
        status: task.done ? "todo" : "done",
        sort: task.sort,
      });
      task.done = !task.done;
    } catch (e) {
      console.error("更新任务状态失败:", e);
      getBridge().showMessage(e instanceof Error ? e.message : "更新任务状态失败", 4000, "error");
    } finally {
      const next = new Set(pendingTaskIds.value);
      next.delete(task.id);
      pendingTaskIds.value = next;
    }
  }

  return {
    items,
    groups,
    loading,
    loadError,
    pendingTaskIds,
    load,
    isCourseOpen,
    toggleCourse,
    openTask,
    toggleTask,
  };
});
