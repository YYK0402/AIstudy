import { ref } from "vue";
import { queryWrongQuestions, queryDueFlashcardCount, queryDueReviews, queryStudyPlans } from "../api";
import type { Course } from "../api";
import { isCourseReviewSuspended } from "../utils/reviewSuspend";

/**
 * TabBar/更多弹层徽标：只统计**当前课程**，与对应页面内容口径一致
 * （错题本页 / 闪卡组 / 复习页都只展示当前课程的数据，跨课程求和会让徽标
 * 与实际内容对不上）。未选择课程或当前课程已归档 → 全 0。
 * DATA_SAVED 订阅与切课刷新由消费组件（TabBar）负责，本函数保持无组件上下文依赖。
 */
export function useTabBadges(getCurrentCourse: () => Pick<Course, "id" | "status"> | null) {
  const wrongTotal = ref(0);
  const cardDueTotal = ref(0);
  const dueReviewTotal = ref(0);

  async function refresh(): Promise<void> {
    const course = getCurrentCourse();
    if (!course || course.status === "archived") {
      wrongTotal.value = 0;
      cardDueTotal.value = 0;
      dueReviewTotal.value = 0;
      return;
    }
    try {
      const [wrong, cards, due, plans] = await Promise.all([
        queryWrongQuestions(course.id),
        queryDueFlashcardCount(course.id),
        queryDueReviews(course.id),
        queryStudyPlans(course.id),
      ]);
      wrongTotal.value = wrong.length;
      cardDueTotal.value = cards;
      // 课程计划全部暂停 → 复习触点挂起，徽标归零（数据不动）
      dueReviewTotal.value = isCourseReviewSuspended(plans, course.id) ? 0 : due.length;
    } catch (e) {
      console.error("徽标刷新失败:", e);
    }
  }

  return { wrongTotal, cardDueTotal, dueReviewTotal, refresh };
}
