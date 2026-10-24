import type { KnowledgePoint, Question } from "../types/appData";
import { getData, saveData } from "./storage";
import { nextId, now, parseQuestionKpIds, parseQuestionOptions, shuffleList } from "./format";
import { QUESTION_DIFFICULTY_LABELS, QUESTION_SOURCE_LABELS, QUESTION_TYPE_LABELS, questionSourceLabel } from "./constants";
import type { QuestionDifficulty, QuestionType } from "./constants";

/** 按题库导入约定格式导出（可再导入），含知识点/难度/来源元信息 */
export function exportQuestionsMarkdown(
  questions: Question[],
  knowledgePoints: KnowledgePoint[],
  courseName: string,
): string {
  const kpMap = new Map(knowledgePoints.map((k) => [k.id, k.name]));
  const lines: string[] = [
    `# 题库导出 - ${courseName}`,
    `> 共 ${questions.length} 题 · 导出时间 ${new Date().toLocaleString("zh-CN", { hour12: false })}`,
    "",
  ];
  questions.forEach((q, i) => {
    lines.push(`---`, `${i + 1}. ${q.title.replace(/\n/g, " ")}`);
    parseQuestionOptions(q).forEach((opt, j) => {
      lines.push(`${String.fromCharCode(65 + j)}. ${opt}`);
    });
    lines.push(`答案: ${q.answer}`);
    if (q.analysis) lines.push(`解析: ${q.analysis}`);
    lines.push(`题型: ${QUESTION_TYPE_LABELS[q.qType as QuestionType]}`);
    lines.push(`难度: ${QUESTION_DIFFICULTY_LABELS[q.difficulty as QuestionDifficulty]}`);
    const kpNames = parseQuestionKpIds(q).map((id) => kpMap.get(id)).filter(Boolean);
    if (kpNames.length) lines.push(`知识点: ${kpNames.join(", ")}`);
    lines.push(`来源: ${questionSourceLabel(q.source)}`, "");
  });
  return lines.join("\n");
}

export async function queryQuestions(courseId: number): Promise<Question[]> {
  const data = await getData();
  return data.questions
    .filter((q) => q.courseId === courseId)
    .sort((a, b) => b.id - a.id);
}

export async function deleteQuestion(id: number): Promise<void> {
  const data = await getData();
  data.questions = data.questions.filter((q) => q.id !== id);
  // 同步清理答题记录与错题，避免悬挂引用
  data.answerRecords = data.answerRecords.filter((r) => r.qId !== id);
  data.wrongQuestions = data.wrongQuestions.filter((w) => w.qId !== id);
  data.reviewSchedules = data.reviewSchedules.filter((s) => s.qId !== id);
  await saveData(data);
}

export async function updateQuestion(
  id: number,
  patch: {
    title: string;
    options: string[];
    answer: string;
    analysis: string;
    qType: QuestionType;
    difficulty: QuestionDifficulty;
    kpIds: number[];
  },
): Promise<Question> {
  const data = await getData();
  const q = data.questions.find((x) => x.id === id);
  if (!q) {
    throw new Error("题目不存在，可能已被删除");
  }
  q.title = patch.title;
  q.options = JSON.stringify(patch.options);
  q.answer = patch.answer;
  q.analysis = patch.analysis;
  q.qType = patch.qType;
  q.difficulty = patch.difficulty;
  q.kpIds = patch.kpIds.join(",");
  await saveData(data);
  return q;
}

export async function deleteQuestions(ids: number[]): Promise<number> {
  const data = await getData();
  const idSet = new Set(ids);
  const before = data.questions.length;
  data.questions = data.questions.filter((q) => !idSet.has(q.id));
  const removed = before - data.questions.length;
  // 同步清理答题记录/错题/复习排期，避免悬挂引用
  data.answerRecords = data.answerRecords.filter((r) => !idSet.has(r.qId));
  data.wrongQuestions = data.wrongQuestions.filter((w) => !idSet.has(w.qId));
  data.reviewSchedules = data.reviewSchedules.filter((s) => s.qId !== null && !idSet.has(s.qId));
  await saveData(data);
  return removed;
}

export interface QuizFilter {
  /** 空数组 = 不限题型 */
  qTypes: QuestionType[];
  /** 空数组 = 不限难度 */
  difficulties: QuestionDifficulty[];
  /** 空数组 = 不限知识点（整课程）；题目命中任一即入选 */
  kpIds: number[];
  count: number;
  random: boolean;
}

/** 按筛选条件组卷：题型/难度/知识点过滤 → 洗牌或保序 → 截取 count 题 */
export function buildQuizList(questions: Question[], filter: QuizFilter): Question[] {
  const qTypeSet = new Set(filter.qTypes);
  const diffSet = new Set(filter.difficulties);
  const kpSet = new Set(filter.kpIds);
  let pool = questions.filter((q) => {
    if (qTypeSet.size > 0 && !qTypeSet.has(q.qType as QuestionType)) return false;
    if (diffSet.size > 0 && !diffSet.has(q.difficulty as QuestionDifficulty)) return false;
    if (kpSet.size > 0 && !parseQuestionKpIds(q).some((id) => kpSet.has(id))) return false;
    return true;
  });
  if (filter.random) {
    pool = shuffleList(pool);
  }
  const n = Math.min(Math.max(1, filter.count), pool.length);
  return pool.slice(0, n);
}

export async function importQuestions(
  courseId: number,
  drafts: Array<{
    title: string;
    options: string[];
    answer: string;
    analysis: string;
    qType: QuestionType;
    difficulty: QuestionDifficulty;
    kpIds: number[];
  }>,
): Promise<Question[]> {
  const data = await getData();
  if (!data.courses.some((c) => c.id === courseId)) {
    throw new Error("课程不存在");
  }
  let nid = nextId(data.questions);
  const created: Question[] = drafts.map((d) => ({
    id: nid++,
    courseId,
    kpIds: d.kpIds.join(","),
    title: d.title,
    options: JSON.stringify(d.options),
    answer: d.answer,
    analysis: d.analysis,
    qType: d.qType,
    difficulty: d.difficulty,
    source: "import",
    createTime: now(),
  }));
  data.questions.push(...created);
  await saveData(data);
  return created;
}

export async function batchBindQuestionKps(
  ids: number[],
  kpIds: number[],
  mode: "add" | "replace",
): Promise<number> {
  const data = await getData();
  const idSet = new Set(ids);
  let count = 0;
  for (const q of data.questions) {
    if (!idSet.has(q.id)) continue;
    if (mode === "replace") {
      q.kpIds = kpIds.join(",");
    } else {
      const cur = new Set(parseQuestionKpIds(q));
      for (const k of kpIds) cur.add(k);
      q.kpIds = [...cur].join(",");
    }
    count++;
  }
  await saveData(data);
  return count;
}

