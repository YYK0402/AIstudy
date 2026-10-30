// 内置示例课：一键添加（开箱即用）。
// 复用课程包重映射（remapCoursePackage + applyImportToData）落盘内容，
// 再复用 generateStudyPlan 生成现成学习计划（无 gen_plan 绑定时走确定性骨架，无需 key）。
import type { AppData } from "../types/appData";
import { SAMPLE_COURSE } from "../constants/sampleCourse";
import { applyImportToData, remapCoursePackage } from "./coursePackage";
import { generateStudyPlan } from "./plan";
import { getData, saveData } from "./storage";
import { formatLocalDate, now } from "./format";

export interface SampleCourseResult {
  courseId: number;
  courseName: string;
  counts: { chapters: number; kps: number; questions: number; cards: number };
}

/** 数据中是否已存在示例课（isSample 标记） */
export function hasSampleCourse(data: AppData): boolean {
  return data.courses.some((c) => c.isSample === true);
}

/** 统计某课程的示例课相关实体数量 */
function sampleCounts(data: AppData, courseId: number): SampleCourseResult["counts"] {
  return {
    chapters: data.chapters.filter((c) => c.courseId === courseId).length,
    kps: data.knowledgePoints.filter((k) => k.courseId === courseId).length,
    questions: data.questions.filter((q) => q.courseId === courseId).length,
    cards: data.flashCards.filter((c) => c.courseId === courseId).length,
  };
}

/**
 * 添加内置示例课（幂等）。
 * 已存在示例课时直接返回现有课程，不重复添加。
 * 计划日期相对「添加当天」生成（今天 → 今天+14）。
 */
export async function createSampleCourse(): Promise<SampleCourseResult> {
  const existing = await getData();
  const sample = existing.courses.find((c) => c.isSample === true);
  if (sample) {
    return { courseId: sample.id, courseName: sample.name, counts: sampleCounts(existing, sample.id) };
  }

  const remapped = remapCoursePackage(SAMPLE_COURSE, existing);
  // 标记示例课 + 统一创建时间为添加时刻（卡片「创建于」显示准确）
  const stamp = now();
  remapped.course.isSample = true;
  remapped.course.createTime = stamp;
  for (const k of remapped.knowledgePoints) k.createTime = stamp;
  for (const q of remapped.questions) q.createTime = stamp;
  for (const p of remapped.examPapers) p.createTime = stamp;
  for (const c of remapped.flashCards) c.createTime = stamp;

  await saveData(applyImportToData(existing, remapped));

  // 现成学习计划：今天开始、14 天后结束；无 gen_plan 绑定时自动降级为确定性骨架
  const today = new Date();
  const target = new Date(today);
  target.setDate(target.getDate() + 14);
  await generateStudyPlan(remapped.courseId, {
    startDate: formatLocalDate(today),
    targetDate: formatLocalDate(target),
    dailyHour: "1",
  });

  return {
    courseId: remapped.courseId,
    courseName: remapped.course.name,
    counts: {
      chapters: remapped.chapters.length,
      kps: remapped.knowledgePoints.length,
      questions: remapped.questions.length,
      cards: remapped.flashCards.length,
    },
  };
}
