import type { Course, Mastery } from "../types/appData";
import type { StudyTrend } from "../utils/studyTrend";
import { aggregateStudyTrend } from "../utils/studyTrend";
import { getData } from "./storage";
import { findTaskBinding } from "./ai";
import { resolvePromptTemplate, renderPrompt } from "./promptTemplates";

export interface CourseStats {
  kp: {
    total: number;
    distribution: Record<Mastery, number>;
  };
  quiz: {
    total: number;
    correct: number;
    accuracy: string;
    essayAvgScore: string;
    wrongCount: number;
  };
  explain: {
    total: number;
    avgScore: string;
  };
  review: {
    touchpoints: number;
    totalReviews: number;
  };
  plan: {
    done: number;
    total: number;
  };
  /** 学习时长（StudyLog 聚合）：总秒数 + 近 30 天每日趋势 */
  study: StudyTrend;
  /** 最近一次学习时间（StudyLog 最新 createTime）；无记录为 "" */
  lastStudyTime: string;
}

function parseScoreText(score: string): number | null {
  const n = Number(score);
  return Number.isFinite(n) ? n : null;
}

export async function queryCourseStats(courseId: number): Promise<CourseStats> {
  const data = await getData();
  const kps = data.knowledgePoints.filter((k) => k.courseId === courseId);
  const questions = data.questions.filter((q) => q.courseId === courseId);
  const qIdSet = new Set(questions.map((q) => q.id));
  const records = data.answerRecords.filter((r) => qIdSet.has(r.qId));
  const planIds = new Set(data.studyPlans.filter((p) => p.courseId === courseId).map((p) => p.id));
  const tasks = data.studyTasks.filter((t) => planIds.has(t.planId));
  const explainRecords = data.explainRecords.filter((r) => r.courseId === courseId);
  const reviews = data.reviewSchedules.filter((s) => {
    if (s.kpId !== null) return kps.some((k) => k.id === s.kpId);
    if (s.qId !== null) return qIdSet.has(s.qId);
    return false;
  });

  const distribution: Record<Mastery, number> = { unlearn: 0, known: 0, mastered: 0, proficient: 0 };
  for (const k of kps) distribution[k.mastery]++;

  const correct = records.filter((r) => r.isCorrect).length;
  // 简答均分只统计简答题（客观题 score 恒为 "100"/"0"，不能混入）
  const qTypeById = new Map(questions.map((q) => [q.id, q.qType]));
  const essayScores = records
    .filter((r) => qTypeById.get(r.qId) === "essay")
    .map((r) => parseScoreText(r.score))
    .filter((n): n is number => n !== null);
  const explainScores = explainRecords.map((r) => parseScoreText(r.aiScore)).filter((n): n is number => n !== null);

  const avg = (arr: number[]): string =>
    arr.length ? String(Math.round(arr.reduce((s, n) => s + n, 0) / arr.length)) : "";

  const courseLogs = data.studyLogs.filter((l) => l.courseId === courseId);
  const lastStudyTime = courseLogs.length
    ? courseLogs.reduce((max, l) => (l.createTime > max ? l.createTime : max), courseLogs[0].createTime)
    : "";

  return {
    study: aggregateStudyTrend(courseLogs),
    kp: { total: kps.length, distribution },
    quiz: {
      total: records.length,
      correct,
      accuracy: records.length ? Math.round((correct / records.length) * 100) + "%" : "",
      essayAvgScore: avg(essayScores),
      wrongCount: data.wrongQuestions.filter((w) => qIdSet.has(w.qId) && (w.status ?? "active") !== "graduated").length,
    },
    explain: { total: explainRecords.length, avgScore: avg(explainScores) },
    review: { touchpoints: reviews.length, totalReviews: reviews.reduce((s, r) => s + r.reviewTimes, 0) },
    plan: { done: tasks.filter((t) => t.status === "done").length, total: tasks.length },
    lastStudyTime,
  };
}

/** 生成 AI 综合学习报告（Markdown 文本，不落库）。 */
export async function generateCourseReport(course: Course, stats: CourseStats): Promise<string> {
  const data = await getData();
  const binding = findTaskBinding(data, "gen_report", course.id);
  if (!binding) {
    throw new Error(
      "未配置 AI 任务模型，请前往「模型配置 → AI 任务模型分配」设置「gen_report」任务或「全局默认模型」",
    );
  }

  const reportVars = {
    courseName: course.name,
    target: course.target || "（未设定）",
    statsJson: JSON.stringify(stats, null, 2),
    kpLines:
      data.knowledgePoints
        .filter((k) => k.courseId === course.id)
        .map((k) => `- ${k.name}[${k.mastery}]`)
        .join("\n") || "（无）",
  };
  const reportTpl = resolvePromptTemplate(data, "gen_report");
  const res = await window.siyuanAiStudy.callAi({
    providerId: binding.providerId,
    modelId: binding.modelId,
    taskKey: "gen_report",
    messages: [
      { role: "system", content: renderPrompt(reportTpl.system, reportVars) },
      { role: "user", content: renderPrompt(reportTpl.user, reportVars) },
    ],
  });

  let text = (res.content || "").trim();
  // 思考型模型（如 MiniMax）会在正文前附带思考块，取最后一个结束标记之后的内容
  const thinkParts = text.split("</think>\n");
  if (thinkParts.length > 1) text = thinkParts[thinkParts.length - 1].trim();
  if (!text) {
    throw new Error("AI 返回的报告内容为空，请重试");
  }
  return text;
}

