import type { AppData, FlashCard, KnowledgePoint, Question, ReviewSchedule } from "../types/appData";
import { getData, saveData } from "./storage";
import { formatLocalDate, nextId, now, parseQuestionKpIds } from "./format";
import { nextSm2 } from "../utils/sm2";
import { isReviewScheduleDue } from "../utils/reviewDue";
import { recordWrongResult } from "../utils/wrongStreak";
import { completeKpTasksInData, logStudyInData } from "./studyData";

export type ReviewGrade = "forgotten" | "vague" | "solid";

/** 自研 SM2：评分档位映射质量分 n（0 忘了 / 3 模糊 / 5 牢固） */
const REVIEW_GRADE_TO_N: Record<ReviewGrade, number> = { forgotten: 0, vague: 3, solid: 5 };

export function reviewNextDue(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + Math.max(1, days));
  return formatLocalDate(d);
}

export function ensureReviewTouchpointInData(data: AppData, kpId: number): void {
  const existing = data.reviewSchedules.find((s) => s.kpId === kpId);
  if (existing) {
    const today = formatLocalDate();
    // 未到期：保持原排期不动（不重置 stage、不缩短间隔）
    if (existing.dueTime > today) return;
    // 已到期：按标准 SM-2 正常推进（等同复习答「牢固」），间隔不会变短
    const next = nextSm2(existing, 5);
    existing.stage = next.stage;
    existing.intervalDays = next.intervalDays;
    existing.easeFactor = next.easeFactor;
    existing.dueTime = reviewNextDue(next.intervalDays);
    return;
  }
  data.reviewSchedules.push({
    id: nextId(data.reviewSchedules),
    kpId,
    qId: null,
    stage: 1,
    dueTime: reviewNextDue(1),
    easeFactor: 2.5,
    intervalDays: 1,
    lastReviewTime: null,
    reviewTimes: 0,
  });
}

export function ensureQuestionReviewInData(data: AppData, qId: number): void {
  const existing = data.reviewSchedules.find((s) => s.qId === qId);
  if (existing) {
    existing.dueTime = reviewNextDue(1);
    existing.stage = 1;
    existing.intervalDays = 1;
    return;
  }
  data.reviewSchedules.push({
    id: nextId(data.reviewSchedules),
    kpId: null,
    qId,
    stage: 1,
    dueTime: reviewNextDue(1),
    easeFactor: 2.5,
    intervalDays: 1,
    lastReviewTime: null,
    reviewTimes: 0,
  });
}

export interface ReviewDueItem {
  schedule: ReviewSchedule;
  /** kpId 触点时有值 */
  knowledgePoint: KnowledgePoint | null;
  /** qId 触点时有值 */
  question: Question | null;
  /** cardId 触点时有值（T3.4 闪卡） */
  flashcard: FlashCard | null;
}

export async function queryDueReviews(courseId: number): Promise<ReviewDueItem[]> {
  const data = await getData();
  const today = formatLocalDate();
  const kps = new Map(data.knowledgePoints.filter((k) => k.courseId === courseId).map((k) => [k.id, k]));
  const qs = new Map(data.questions.filter((q) => q.courseId === courseId).map((q) => [q.id, q]));
  const cards = new Map(data.flashCards.filter((c) => c.courseId === courseId).map((c) => [c.id, c]));
  return data.reviewSchedules
    .filter((s) => isReviewScheduleDue(s, today, new Set(kps.keys()), new Set(qs.keys()), new Set(cards.keys())))
    .sort((a, b) => a.dueTime.localeCompare(b.dueTime))
    .map((s) => ({
      schedule: s,
      knowledgePoint: s.kpId !== null ? kps.get(s.kpId) ?? null : null,
      question: s.qId !== null ? qs.get(s.qId) ?? null : null,
      flashcard: s.cardId != null ? cards.get(s.cardId) ?? null : null,
    }));
}

/** 对一次复习打分：自研 SM2 更新间隔与到期日；题目触点同步错题本（牢固=连对+1 / 忘了=再答错 / 模糊不动） */
export async function submitReview(schedule: ReviewSchedule, grade: ReviewGrade, durationSec = 0): Promise<ReviewSchedule> {
  const data = await getData();
  const idx = data.reviewSchedules.findIndex((s) => s.id === schedule.id);
  if (idx < 0) {
    throw new Error("复习触点不存在，可能已被清理");
  }
  const target = data.reviewSchedules[idx];
  const next = nextSm2(
    { stage: target.stage, intervalDays: target.intervalDays, easeFactor: target.easeFactor },
    REVIEW_GRADE_TO_N[grade],
  );
  // 防御：评分结果非有限值时不落库，避免 NaN 污染排期
  if (!Number.isFinite(next.stage) || !Number.isFinite(next.intervalDays) || !Number.isFinite(next.easeFactor)) {
    throw new Error("复习评分结果异常，本触点未修改");
  }
  target.stage = next.stage;
  target.intervalDays = next.intervalDays;
  target.easeFactor = next.easeFactor;
  target.dueTime = reviewNextDue(target.intervalDays);
  target.lastReviewTime = now();
  target.reviewTimes++;
  data.reviewSchedules[idx] = target;
  // 评「牢固」→ 勾掉对应知识点当天 review 任务
  if (grade === "solid") {
    let kpId: number | null = target.kpId;
    if (kpId === null && target.qId !== null) {
      const q = data.questions.find((x) => x.id === target.qId);
      if (q) kpId = parseQuestionKpIds(q)[0] ?? null;
    }
    if (kpId !== null) completeKpTasksInData(data, kpId, ["review"]);
  }
  // 时长日志：由触点反查课程（知识点触点 → kp.courseId；题目触点 → question.courseId；闪卡触点 → card.courseId）
  let reviewKpId: number | null = target.kpId;
  let reviewCourseId: number | null = null;
  if (reviewKpId !== null) {
    const rkp = data.knowledgePoints.find((k) => k.id === reviewKpId);
    reviewCourseId = rkp?.courseId ?? null;
  } else if (target.qId !== null) {
    const rq = data.questions.find((q) => q.id === target.qId);
    reviewCourseId = rq?.courseId ?? null;
    if (rq) reviewKpId = parseQuestionKpIds(rq)[0] ?? null;
  } else if (target.cardId != null) {
    const rcard = data.flashCards.find((c) => c.id === target.cardId);
    reviewCourseId = rcard?.courseId ?? null;
    if (rcard) reviewKpId = rcard.kpId;
  }
  if (reviewCourseId !== null) {
    logStudyInData(data, { courseId: reviewCourseId, kpId: reviewKpId, taskId: null, action: "review", durationSec });
  }
  // 题目触点同步错题本：牢固=连对+1、忘了=再答错（模糊不动）；已毕业条目内部忽略
  if (target.qId !== null) {
    if (grade === "solid") recordWrongResult(data.wrongQuestions, target.qId, "correct", now());
    else if (grade === "forgotten") recordWrongResult(data.wrongQuestions, target.qId, "wrong", now());
  }
  await saveData(data);
  return target;
}

/** 定向复习：直接对指定知识点评一次分（无复习触点时先建 1 阶触点再评分，评「牢固」会勾掉当天 review 任务） */
export async function submitKpReview(kpId: number, grade: ReviewGrade, durationSec = 0): Promise<ReviewSchedule> {
  const data = await getData();
  const kp = data.knowledgePoints.find((k) => k.id === kpId);
  if (!kp) {
    throw new Error("知识点不存在，可能已被删除");
  }
  const existing = data.reviewSchedules.find((s) => s.kpId === kpId && s.qId === null);
  if (existing) {
    return submitReview(existing, grade, durationSec);
  }
  const schedule: ReviewSchedule = {
    id: nextId(data.reviewSchedules),
    kpId,
    qId: null,
    stage: 1,
    dueTime: reviewNextDue(1),
    easeFactor: 2.5,
    intervalDays: 1,
    lastReviewTime: null,
    reviewTimes: 0,
  };
  data.reviewSchedules.push(schedule);
  await saveData(data);
  return submitReview(schedule, grade, durationSec);
}

