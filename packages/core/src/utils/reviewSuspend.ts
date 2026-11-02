import type { StudyPlan } from "../types/appData";

/**
 * 课程复习触点是否整体挂起：该课程存在 ≥1 个学习计划且全部暂停。
 * 挂起时到期复习项不在首页/徽标/统计浮现（数据不动，恢复计划后自动恢复）。
 * 无计划课程（自学 KP）与旧数据 status 缺失（按 active）均不挂起。
 */
export function isCourseReviewSuspended(
  plans: Pick<StudyPlan, "courseId" | "status">[],
  courseId: number,
): boolean {
  const own = plans.filter((p) => p.courseId === courseId);
  return own.length > 0 && own.every((p) => p.status === "paused");
}
