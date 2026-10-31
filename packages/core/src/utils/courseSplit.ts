// 全局 AppData ↔ （全局配置 + 每课程独立文件）的拆分/合并纯函数。
// 存储布局：
//   data        全局：providers/models/taskModels/logs/courses/settings/promptTemplates/cryptoKeyMaterial
//               + 无法归属任何课程的孤儿实体（保留不丢）
//   course-<id> 单课程：内容实体 + 学习过程实体 + conversationsDocs
import type { AppData, CourseData } from "../types/appData";
import { createEmptyCourseData, createEmptyData } from "../types/appData";

export function courseStorageName(courseId: number): string {
  return `course-${courseId}`;
}

/** 实体键中「带 courseId 直接归属」的集合 */
const DIRECT_KEYS = [
  "chapters",
  "knowledgePoints",
  "materials",
  "questions",
  "examPapers",
  "studyPlans",
  "explainRecords",
  "flashCards",
  "studyLogs",
  "studyLogMonthly",
  "answerStatsMonthly",
] as const;
type DirectKey = (typeof DIRECT_KEYS)[number];

export interface SplitResult {
  /** 全局部分（孤儿实体保留在对应键下，前端按课程查询不会取到） */
  global: AppData;
  /** courseId → 课程数据（courses 列表中的每个课程都有条目，无实体的课程为空结构） */
  courses: Map<number, CourseData>;
}

/** 把完整 AppData 拆成全局部分 + 每课程部分。
 *  归属规则：
 *  - 带 courseId 的实体直接归属；
 *  - answerRecords/wrongQuestions 经 qId、studyTasks 经 planId、
 *    reviewSchedules 经 kpId→qId→cardId、materialChapters 经 materialId 间接归属；
 *  - conversationsDocs 的 key 为 `course-<id>` 或章/节节点 id（经 chapters 查归属）；
 *  - 归属不到现存课程的实体进 global（孤儿，保留不丢）。
 */
export function splitAppData(data: AppData): SplitResult {
  const courseIds = new Set(data.courses.map((c) => c.id));
  const qCourse = new Map(data.questions.map((q) => [q.id, q.courseId]));
  const planCourse = new Map(data.studyPlans.map((p) => [p.id, p.courseId]));
  const matCourse = new Map(data.materials.map((m) => [m.id, m.courseId]));
  const kpCourse = new Map(data.knowledgePoints.map((k) => [k.id, k.courseId]));
  const cardCourse = new Map(data.flashCards.map((c) => [c.id, c.courseId]));
  const chCourse = new Map(data.chapters.map((c) => [c.id, c.courseId]));

  const global = createEmptyData();
  global.providers = data.providers;
  global.models = data.models;
  global.taskModels = data.taskModels;
  global.logs = data.logs;
  global.courses = data.courses;
  global.settings = data.settings;
  global.promptTemplates = data.promptTemplates;
  global.cryptoKeyMaterial = data.cryptoKeyMaterial;

  const courses = new Map<number, CourseData>();
  const courseOf = (courseId: number): CourseData | null => {
    if (!courseIds.has(courseId)) return null;
    let cd = courses.get(courseId);
    if (!cd) {
      cd = createEmptyCourseData();
      courses.set(courseId, cd);
    }
    return cd;
  };

  // 直接归属实体
  for (const key of DIRECT_KEYS) {
    for (const item of data[key] as Array<{ courseId: number }>) {
      const cd = courseOf(item.courseId);
      if (cd) {
        (cd[key] as unknown[]).push(item);
      } else {
        (global[key] as unknown[]).push(item);
      }
    }
  }

  // 间接归属实体
  for (const r of data.answerRecords) {
    const c = qCourse.get(r.qId);
    const cd = c == null ? null : courseOf(c);
    if (cd) cd.answerRecords.push(r);
    else global.answerRecords.push(r);
  }
  for (const w of data.wrongQuestions) {
    const c = qCourse.get(w.qId);
    const cd = c == null ? null : courseOf(c);
    if (cd) cd.wrongQuestions.push(w);
    else global.wrongQuestions.push(w);
  }
  for (const t of data.studyTasks) {
    const c = planCourse.get(t.planId);
    const cd = c == null ? null : courseOf(c);
    if (cd) cd.studyTasks.push(t);
    else global.studyTasks.push(t);
  }
  for (const s of data.reviewSchedules) {
    const c =
      (s.kpId != null ? kpCourse.get(s.kpId) : undefined) ??
      (s.qId != null ? qCourse.get(s.qId) : undefined) ??
      (s.cardId != null ? cardCourse.get(s.cardId) : undefined);
    const cd = c == null ? null : courseOf(c);
    if (cd) cd.reviewSchedules.push(s);
    else global.reviewSchedules.push(s);
  }
  for (const mc of data.materialChapters) {
    const c = matCourse.get(mc.materialId);
    const cd = c == null ? null : courseOf(c);
    if (cd) cd.materialChapters.push(mc);
    else global.materialChapters.push(mc);
  }

  // conversationsDocs：`course-<id>` 直接归属；章/节 id 经 chapters 查归属
  const orphanDocs: Record<string, { docId: string; lastMarkdown?: string }> = {};
  for (const [key, val] of Object.entries(data.conversationsDocs ?? {})) {
    let c: number | undefined;
    if (key.startsWith("course-")) c = Number(key.slice("course-".length));
    else c = chCourse.get(Number(key));
    const cd = c == null ? null : courseOf(c);
    if (cd) {
      if (!cd.conversationsDocs) cd.conversationsDocs = {};
      cd.conversationsDocs[key] = val;
    } else {
      orphanDocs[key] = val;
    }
  }
  if (Object.keys(orphanDocs).length > 0) global.conversationsDocs = orphanDocs;

  // 保证 courses 列表中每个课程都有条目（无实体 = 空结构），
  // 使「每个课程都有独立文件」成为不变量
  for (const c of data.courses) courseOf(c.id);

  return { global, courses };
}

/** 把全局部分 + 各课程部分合并回完整 AppData（内存视图） */
export function mergeAppData(global: AppData, courses: Map<number, CourseData>): AppData {
  const data: AppData = {
    ...global,
    chapters: [...global.chapters],
    knowledgePoints: [...global.knowledgePoints],
    materials: [...global.materials],
    materialChapters: [...global.materialChapters],
    questions: [...global.questions],
    examPapers: [...global.examPapers],
    answerRecords: [...global.answerRecords],
    wrongQuestions: [...global.wrongQuestions],
    studyPlans: [...global.studyPlans],
    studyTasks: [...global.studyTasks],
    explainRecords: [...global.explainRecords],
    reviewSchedules: [...global.reviewSchedules],
    flashCards: [...global.flashCards],
    studyLogs: [...global.studyLogs],
    studyLogMonthly: [...global.studyLogMonthly],
    answerStatsMonthly: [...global.answerStatsMonthly],
  };
  for (const cd of courses.values()) {
    data.chapters.push(...cd.chapters);
    data.knowledgePoints.push(...cd.knowledgePoints);
    data.materials.push(...cd.materials);
    data.materialChapters.push(...cd.materialChapters);
    data.questions.push(...cd.questions);
    data.examPapers.push(...cd.examPapers);
    data.answerRecords.push(...cd.answerRecords);
    data.wrongQuestions.push(...cd.wrongQuestions);
    data.studyPlans.push(...cd.studyPlans);
    data.studyTasks.push(...cd.studyTasks);
    data.explainRecords.push(...cd.explainRecords);
    data.reviewSchedules.push(...cd.reviewSchedules);
    data.flashCards.push(...cd.flashCards);
    data.studyLogs.push(...cd.studyLogs);
    data.studyLogMonthly.push(...cd.studyLogMonthly);
    data.answerStatsMonthly.push(...cd.answerStatsMonthly);
    if (cd.conversationsDocs && Object.keys(cd.conversationsDocs).length > 0) {
      data.conversationsDocs = { ...(data.conversationsDocs ?? {}), ...cd.conversationsDocs };
    }
  }
  return data;
}

/** 是否旧布局（全局文件里仍有可归属到课程的实体）——用于一次性迁移判断 */
export function hasCourseEntities(data: AppData): boolean {
  const { courses } = splitAppData(data);
  return [...courses.values()].some((cd) =>
    [
      cd.chapters,
      cd.knowledgePoints,
      cd.materials,
      cd.materialChapters,
      cd.questions,
      cd.examPapers,
      cd.answerRecords,
      cd.wrongQuestions,
      cd.studyPlans,
      cd.studyTasks,
      cd.explainRecords,
      cd.reviewSchedules,
      cd.flashCards,
      cd.studyLogs,
      cd.studyLogMonthly,
      cd.answerStatsMonthly,
    ].some((arr) => arr.length > 0),
  );
}

/** 把磁盘读出的课程文件补齐为完整 CourseData（缺字段/非数组补空） */
export function normalizeCourseData(raw: unknown): CourseData {
  const out = createEmptyCourseData();
  if (!raw || typeof raw !== "object") return out;
  const p = raw as Partial<CourseData>;
  const arr = <T,>(src: T[] | undefined): T[] | undefined => (Array.isArray(src) ? src : undefined);
  if (arr(p.chapters)) out.chapters = p.chapters!;
  if (arr(p.knowledgePoints)) out.knowledgePoints = p.knowledgePoints!;
  if (arr(p.materials)) out.materials = p.materials!;
  if (arr(p.materialChapters)) out.materialChapters = p.materialChapters!;
  if (arr(p.questions)) out.questions = p.questions!;
  if (arr(p.examPapers)) out.examPapers = p.examPapers!;
  if (arr(p.answerRecords)) out.answerRecords = p.answerRecords!;
  if (arr(p.wrongQuestions)) out.wrongQuestions = p.wrongQuestions!;
  if (arr(p.studyPlans)) out.studyPlans = p.studyPlans!;
  if (arr(p.studyTasks)) out.studyTasks = p.studyTasks!;
  if (arr(p.explainRecords)) out.explainRecords = p.explainRecords!;
  if (arr(p.reviewSchedules)) out.reviewSchedules = p.reviewSchedules!;
  if (arr(p.flashCards)) out.flashCards = p.flashCards!;
  if (arr(p.studyLogs)) out.studyLogs = p.studyLogs!;
  if (arr(p.studyLogMonthly)) out.studyLogMonthly = p.studyLogMonthly!;
  if (arr(p.answerStatsMonthly)) out.answerStatsMonthly = p.answerStatsMonthly!;
  if (p.conversationsDocs && typeof p.conversationsDocs === "object") {
    out.conversationsDocs = p.conversationsDocs;
  }
  return out;
}
