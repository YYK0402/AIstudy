import type { AppData } from "../types/appData";
import { isReviewScheduleDue } from "./reviewDue";

export interface DailyReminderSummary {
  planCount: number;
  reviewCount: number;
  courses: { name: string; count: number }[];
  text: string;
}

/**
 * 今日任务摘要（启动时学习提醒用；口径与首页今日任务完全一致）：
 * 未完成计划任务（今天排期）+ 到期 SM2 复习项（KP/错题/闪卡触点，引用有效）。
 * 排除：归档课程、暂停计划、复习暂停课程的复习项、悬挂引用排期。
 * 零任务返回 null（不打扰）。
 */
export function buildDailyReminderSummary(data: AppData, today: string): DailyReminderSummary | null {
  const perCourse = new Map<number, number>();
  let planCount = 0;
  for (const c of data.courses) {
    if (c.status === "archived") continue;
    for (const p of data.studyPlans) {
      if (p.courseId !== c.id || p.status === "paused") continue;
      for (const t of data.studyTasks) {
        if (t.planId !== p.id || t.scheduledDate !== today || t.status === "done") continue;
        planCount += 1;
        perCourse.set(c.id, (perCourse.get(c.id) ?? 0) + 1);
      }
    }
  }
  let reviewCount = 0;
  for (const c of data.courses) {
    if (c.status === "archived" || c.reviewPaused) continue;
    const kpIds = new Set(data.knowledgePoints.filter((k) => k.courseId === c.id).map((k) => k.id));
    const qIds = new Set(data.questions.filter((q) => q.courseId === c.id).map((q) => q.id));
    const cardIds = new Set(data.flashCards.filter((f) => f.courseId === c.id).map((f) => f.id));
    for (const s of data.reviewSchedules) {
      if (!isReviewScheduleDue(s, today, kpIds, qIds, cardIds)) continue;
      reviewCount += 1;
      perCourse.set(c.id, (perCourse.get(c.id) ?? 0) + 1);
    }
  }
  const total = planCount + reviewCount;
  if (total === 0) return null;
  const courses = data.courses
    .filter((c) => (perCourse.get(c.id) ?? 0) > 0)
    .map((c) => ({ name: c.name, count: perCourse.get(c.id)! }));
  const parts: string[] = [];
  if (planCount > 0) parts.push(`${planCount} 项计划任务`);
  if (reviewCount > 0) parts.push(`${reviewCount} 项复习到期`);
  return {
    planCount,
    reviewCount,
    courses,
    text: `今日：${parts.join("、")}（${courses.map((c) => `${c.name} ${c.count}`).join(" / ")}）`,
  };
}
