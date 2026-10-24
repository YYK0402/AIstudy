// 重新导出所有数据类型
import type { AiProvider, AiModel, TaskModel, CallLog, Course, Chapter, KnowledgePoint, Material, MaterialChapter, Question, AnswerRecord, WrongQuestion, StudyPlan, StudyTask, ExplainRecord, ReviewSchedule, FlashCard, StudyLog, AppData, AppSettings, Mastery, PromptTemplateDef } from "../types/appData";
import type { ParsedHeading } from "../utils/documentParser";
import { aggregateStudyTrend } from "../utils/studyTrend";
import { removeCsvIds } from "../utils/csvIds";
import { recordWrongResult } from "../utils/wrongStreak";
import { isReviewScheduleDue } from "../utils/reviewDue";
import { parseFlashcardsJson } from "../utils/flashcardGen";
import type { StudyTrend } from "../utils/studyTrend";
import { PROMPT_TASKS, findPromptTask, resolvePromptTemplate, renderPrompt } from "./promptTemplates";
import type { PromptVarInfo } from "./promptTemplates";
import { useNotifyStore, materialTaskId, courseTaskId } from "../stores/notify";
import { useModalStore } from "../stores/modal";
export type { AiProvider, AiModel, TaskModel, CallLog, Course, Chapter, KnowledgePoint, Material, MaterialChapter, Question, AnswerRecord, WrongQuestion, StudyPlan, StudyTask, ExplainRecord, ReviewSchedule, FlashCard, StudyLog, AppData, AppSettings, Mastery, PromptTemplateDef } from "../types/appData";
export { PROMPT_TASKS, renderPrompt } from "./promptTemplates";
export type { PromptTaskMeta, PromptVarInfo } from "./promptTemplates";
// ===== 底层数据读写（直接调用主窗口暴露的 Plugin 实例 API） =====
// 数据持久化成功后派发的全局信号，供 Topbar / Sidebar 等全局组件刷新
export const DATA_SAVED_EVENT = "siyuan-ai-study:data-saved";

export async function getData(): Promise<AppData> {
  return window.siyuanAiStudy.getData();
}

// 模块级串行队列：并发写盘按调用顺序执行，避免互相覆盖；
// 队列链吞掉失败（saveChain 永不 reject），单次失败不阻断后续保存
let saveChain: Promise<unknown> = Promise.resolve();

export function saveData(data: AppData): Promise<void> {
  const run = saveChain.then(async () => {
    const res = await window.siyuanAiStudy.saveData(data);
    if (res.code !== 0) {
      throw new Error(`数据保存失败${res.msg ? `：${res.msg}` : ""}`);
    }
  });
  saveChain = run.catch(() => undefined);
  // 失败时不派发 DATA_SAVED_EVENT（run reject 则不进 then 回调）
  return run.then(() => {
    window.dispatchEvent(new Event(DATA_SAVED_EVENT));
  });
}

// ===== 通用工具 =====
export function nextId(list: Array<{ id: number }>): number {
  return list.reduce((max, item) => Math.max(max, item.id), 0) + 1;
}

export function now(): string {
  return new Date().toISOString();
}

// ===== 课程 CRUD =====
export async function queryCourses(): Promise<Course[]> {
  const data = await getData();
  return data.courses;
}

// 思源文档 id 形如 14 位时间戳（YYYYMMDDHHMMSS）+ "-" + 7 位小写字母数字，用于识别已落库的有效文档
function isSiyuanDocId(id: string): boolean {
  return /^\d{14}-[0-9a-z]{7}$/.test(id);
}

export async function createCourse(input: {
  name: string;
  description?: string;
  target?: string;
  totalCycle?: string;
  modelId?: number | null;
}): Promise<Course> {
  const data = await getData();
  // 落库思源：开启持久化时建课程顶层文档（path 含文档名）；未开启或失败为 null（不阻塞主流程）
  const docId = await persistDocIfEnabled(`# ${input.name}`, `/${input.name}`);
  const course: Course = {
    id: nextId(data.courses),
    siyuanDocId: docId,
    name: input.name,
    description: input.description ?? "",
    target: input.target ?? "",
    totalCycle: input.totalCycle ?? "",
    status: "active",
    createTime: now(),
    modelId: input.modelId ?? null,
  };
  data.courses.push(course);
  await saveData(data);
  return course;
}

export async function updateCourse(id: number, input: {
  name: string;
  description?: string;
  target?: string;
  totalCycle?: string;
  modelId?: number | null;
}): Promise<Course> {
  const data = await getData();
  const course = data.courses.find((c) => c.id === id);
  if (!course) {
    throw new Error("课程不存在，可能已被删除");
  }
  const nameChanged = course.name !== input.name;
  course.name = input.name;
  course.description = input.description ?? "";
  course.target = input.target ?? "";
  course.totalCycle = input.totalCycle ?? "";
  course.modelId = input.modelId ?? null;
  await saveData(data);
  // 落库思源：改名时同步课程顶层文档名（失败不阻塞主流程）
  if (nameChanged && course.siyuanDocId && isSiyuanDocId(course.siyuanDocId)) {
    try {
      await window.siyuanAiStudy.renameSiyuanDoc(course.siyuanDocId, input.name);
    } catch (e) {
      console.error("同步课程名到思源失败:", e);
    }
  }
  return course;
}

/** 归档 / 取消归档课程（active ↔ archived）；归档后前端隐藏写入口，仅查看 */
export async function setCourseStatus(id: number, status: "active" | "archived"): Promise<Course> {
  const data = await getData();
  const course = data.courses.find((c) => c.id === id);
  if (!course) {
    throw new Error("课程不存在，可能已被删除");
  }
  course.status = status;
  await saveData(data);
  return course;
}

/** 删除课程：级联删除其下章节/知识点/资料/题目/计划/记录；已落库思源时整体删除课程文档（子文档随树删除） */
export async function deleteCourse(id: number): Promise<void> {
  const data = await getData();
  const course = data.courses.find((c) => c.id === id);
  if (!course) {
    throw new Error("课程不存在，可能已被删除");
  }
  const kpIds = new Set(data.knowledgePoints.filter((k) => k.courseId === id).map((k) => k.id));
  const materialIds = new Set(data.materials.filter((m) => m.courseId === id).map((m) => m.id));
  const removedMaterials = data.materials.filter((m) => m.courseId === id);
  const questionIds = new Set(data.questions.filter((q) => q.courseId === id).map((q) => q.id));
  const planIds = new Set(data.studyPlans.filter((p) => p.courseId === id).map((p) => p.id));
  const flashCardIds = new Set(data.flashCards.filter((c) => c.courseId === id).map((c) => c.id));
  const siyuanCleanupErrors: string[] = [];
  if (course.siyuanDocId && isSiyuanDocId(course.siyuanDocId)) {
    // 课程文档是顶层文档，章节/资料是其子文档，删顶层即整体删除
    try {
      await removeSiyuanDoc(course.siyuanDocId);
    } catch (e) {
      siyuanCleanupErrors.push(`课程文档「${course.name}」删除失败`);
    }
  } else {
    if (course.siyuanDocId) {
      // 历史坏数据：id 格式异常，无法按顶层文档整树删除
      siyuanCleanupErrors.push(`课程「${course.name}」的思源文档 id 格式异常，无法自动删除顶层文档`);
    }
    for (const ch of data.chapters.filter((c) => c.courseId === id)) {
      if (!ch.siyuanBlockId) continue;
      try {
        await removeSiyuanDoc(ch.siyuanBlockId);
      } catch (e) {
        siyuanCleanupErrors.push(`章节「${ch.name}」删除失败`);
      }
    }
    for (const m of data.materials.filter((x) => x.courseId === id)) {
      if (!m.siyuanDocId) continue;
      try {
        await removeSiyuanDoc(m.siyuanDocId);
      } catch (e) {
        siyuanCleanupErrors.push(`资料「${m.name}」删除失败`);
      }
    }
  }
  data.courses = data.courses.filter((c) => c.id !== id);
  data.chapters = data.chapters.filter((c) => c.courseId !== id);
  data.knowledgePoints = data.knowledgePoints.filter((k) => k.courseId !== id);
  data.flashCards = data.flashCards.filter((c) => c.courseId !== id);
  data.materials = data.materials.filter((m) => m.courseId !== id);
  data.materialChapters = data.materialChapters.filter((mc) => !materialIds.has(mc.materialId));
  data.questions = data.questions.filter((q) => q.courseId !== id);
  data.answerRecords = data.answerRecords.filter((r) => !questionIds.has(r.qId));
  data.wrongQuestions = data.wrongQuestions.filter((w) => !questionIds.has(w.qId));
  data.studyPlans = data.studyPlans.filter((p) => p.courseId !== id);
  data.studyTasks = data.studyTasks.filter((t) => !planIds.has(t.planId));
  data.explainRecords = data.explainRecords.filter((r) => r.courseId !== id);
  data.reviewSchedules = data.reviewSchedules.filter((s) => {
    if (s.kpId !== null && kpIds.has(s.kpId)) return false;
    if (s.qId !== null && questionIds.has(s.qId)) return false;
    if (s.cardId != null && flashCardIds.has(s.cardId)) return false;
    return true;
  });
  data.studyLogs = data.studyLogs.filter((l) => l.courseId !== id);
  await saveData(data);
  // 同步清理课程资料的源文件（仍被其他课程资料引用的跳过）
  for (const m of removedMaterials) {
    await removeAssetIfUnused(m.assetPath, data.materials);
  }
  if (siyuanCleanupErrors.length) {
    window.siyuanAiStudy.showMessage(
      `课程数据已删除，但思源文档清理不完整：${siyuanCleanupErrors.join("；")}`,
      6000,
      "error",
    );
  }
}

// ===== 服务商 CRUD =====
export async function queryProviders(): Promise<AiProvider[]> {
  const data = await getData();
  return data.providers;
}

export async function createProvider(input: {
  name: string;
  baseUrl: string;
  apiKey: string;
  timeout?: number;
}): Promise<AiProvider> {
  const data = await getData();
  const provider: AiProvider = {
    id: nextId(data.providers),
    name: input.name,
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    timeout: input.timeout ?? 60,
    enabled: true,
    createTime: now(),
  };
  data.providers.push(provider);
  await saveData(data);
  return provider;
}

export async function updateProvider(provider: AiProvider): Promise<void> {
  const data = await getData();
  const idx = data.providers.findIndex((p) => p.id === provider.id);
  if (idx >= 0) {
    data.providers[idx] = provider;
    await saveData(data);
  }
}

export async function deleteProvider(id: number): Promise<void> {
  const data = await getData();
  // 先收集将被删除的模型 id，同步清理指向它们的任务绑定，避免悬挂引用
  const removedModelIds = new Set(data.models.filter((m) => m.providerId === id).map((m) => m.id));
  data.providers = data.providers.filter((p) => p.id !== id);
  data.models = data.models.filter((m) => m.providerId !== id);
  for (const t of data.taskModels) {
    if (t.modelId !== null && removedModelIds.has(t.modelId)) t.modelId = null;
  }
  for (const c of data.courses) {
    if (c.modelId != null && removedModelIds.has(c.modelId)) c.modelId = null;
  }
  await saveData(data);
}

// ===== AI 调用 =====
export async function callAi(input: {
  providerId: number;
  modelId: string;
  messages: Array<{ role: string; content: string }>;
  taskKey: string;
}): Promise<{ content: string; tokenIn: number; tokenOut: number }> {
  return window.siyuanAiStudy.callAi(input);
}

export async function testProvider(providerId: number): Promise<{ ok: boolean; message: string }> {
  return window.siyuanAiStudy.testProvider(providerId);
}

export async function fetchProviderModels(providerId: number): Promise<{ ok: boolean; message: string; models: string[] }> {
  return window.siyuanAiStudy.listModels(providerId);
}

// ===== 模型管理 =====
export const PROVIDER_PRESETS = [
  { name: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  { name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1" },
  { name: "通义千问", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  { name: "智谱", baseUrl: "https://open.bigmodel.cn/api/paas/v4" },
  { name: "Ollama", baseUrl: "http://localhost:11434/v1" },
];

export async function createModel(input: {
  providerId: number;
  modelId: string;
  displayName: string;
  maxContext?: number | null;
  temperature?: number | null;
  maxTokens?: number | null;
}): Promise<AiModel> {
  const data = await getData();
  const model: AiModel = {
    id: nextId(data.models),
    providerId: input.providerId,
    modelId: input.modelId,
    displayName: input.displayName,
    maxContext: input.maxContext ?? null,
    temperature: input.temperature ?? null,
    maxTokens: input.maxTokens ?? null,
  };
  data.models.push(model);
  await saveData(data);
  return model;
}

export async function updateModel(
  id: number,
  patch: {
    modelId?: string;
    displayName?: string;
    maxContext?: number | null;
    temperature?: number | null;
    maxTokens?: number | null;
  },
): Promise<AiModel> {
  const data = await getData();
  const model = data.models.find((m) => m.id === id);
  if (!model) {
    throw new Error("模型不存在");
  }
  if (patch.modelId !== undefined) model.modelId = patch.modelId;
  if (patch.displayName !== undefined) model.displayName = patch.displayName;
  if (patch.maxContext !== undefined) model.maxContext = patch.maxContext;
  if (patch.temperature !== undefined) model.temperature = patch.temperature;
  if (patch.maxTokens !== undefined) model.maxTokens = patch.maxTokens;
  await saveData(data);
  return { ...model };
}

export async function deleteModel(id: number): Promise<void> {
  const data = await getData();
  data.models = data.models.filter((m) => m.id !== id);
  for (const t of data.taskModels) {
    if (t.modelId === id) t.modelId = null;
  }
  for (const c of data.courses) {
    if (c.modelId === id) c.modelId = null;
  }
  await saveData(data);
}

// ===== 题库 =====
export const QUESTION_TYPES = ["single", "multiple", "judge", "essay"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  single: "单选",
  multiple: "多选",
  judge: "判断",
  essay: "简答",
};

export const QUESTION_DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type QuestionDifficulty = (typeof QUESTION_DIFFICULTIES)[number];

export const QUESTION_DIFFICULTY_LABELS: Record<QuestionDifficulty, string> = {
  easy: "简单",
  medium: "中等",
  hard: "困难",
};

export const QUESTION_SOURCE_LABELS: Record<string, string> = {
  ai: "AI 生成",
  import: "导入",
};

export function questionSourceLabel(source: string): string {
  return QUESTION_SOURCE_LABELS[source] ?? source;
}

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

export function parseQuestionOptions(question: Question): string[] {
  try {
    const parsed = JSON.parse(question.options);
    if (Array.isArray(parsed)) {
      return parsed.filter((o): o is string => typeof o === "string");
    }
  } catch {
    // ignore
  }
  return [];
}

export function parseQuestionKpIds(question: Question): number[] {
  return question.kpIds
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
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

/** Fisher-Yates 洗牌（纯函数，不改动入参） */
export function shuffleList<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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

// ===== 答题与错题 =====
export interface AnswerResult {
  isCorrect: boolean;
  score: string;
  /** 简答题 AI 给出的逐条反馈，仅 essay 题非空 */
  feedback: string;
  /** 关联知识点掌握度降级说明（答错且实际变动时非空） */
  masteryNotes: string[];
  /** 答对自动勾掉的任务标题（严格打勾） */
  planNotes: string[];
}

// ===== 掌握度自动更新 =====
// 掌握度四级阶梯（低 → 高）
const MASTERY_LADDER: Mastery[] = ["unlearn", "known", "mastered", "proficient"];
const MASTERY_LABELS: Record<Mastery, string> = { unlearn: "未学习", known: "了解", mastered: "掌握", proficient: "精通" };
/** 讲解评估升级掌握度的分数门槛（高于进复习池的 EXPLAIN_PASS_SCORE） */
export const EXPLAIN_MASTER_SCORE = 80;

/** 按阶梯升降一档（钳制在两端），返回「前 → 后」说明或 null（未变动/不存在） */
function adjustMasteryInData(data: AppData, kpId: number, delta: number): string | null {
  const kp = data.knowledgePoints.find((k) => k.id === kpId);
  if (!kp) return null;
  const idx = MASTERY_LADDER.indexOf(kp.mastery);
  if (idx < 0) return null;
  const next = MASTERY_LADDER[Math.max(0, Math.min(MASTERY_LADDER.length - 1, idx + delta))];
  if (next === kp.mastery) return null;
  const from = kp.mastery;
  kp.mastery = next;
  return `${MASTERY_LABELS[from]} → ${MASTERY_LABELS[next]}`;
}

/** 知识点在当前错题本是否仍有未移出的在管错题（已毕业不计；经题目 kpIds 关联） */
function kpHasOpenWrong(data: AppData, kpId: number): boolean {
  const qMap = new Map(data.questions.map((q) => [q.id, q]));
  return data.wrongQuestions.some((w) => {
    if ((w.status ?? "active") === "graduated") return false;
    const q = qMap.get(w.qId);
    return !!q && parseQuestionKpIds(q).includes(kpId);
  });
}

function parseAiGradeResponse(content: string): { score: number; feedback: string } | null {
  const trimmed = content.trim();
  const jsonMatch =
    trimmed.match(/```(?:json)?\s*([\s\S]*?)```/) ||
    trimmed.match(/(\{[\s\S]*\})/);
  const candidate = (jsonMatch ? jsonMatch[1] : trimmed).trim();
  try {
    const parsed = JSON.parse(candidate);
    if (parsed && typeof parsed.score === "number" && Number.isFinite(parsed.score)) {
      return {
        score: Math.max(0, Math.min(100, Math.round(parsed.score))),
        feedback: typeof parsed.feedback === "string" ? parsed.feedback : "",
      };
    }
  } catch {
    // ignore
  }
  return null;
}

/** 提交一次作答。客观题本地判分，简答题调用 grade_answer AI 阅卷。fromReview=true 时答对不计入错题毕业连对（由复习评分统一计） */
export async function submitAnswer(
  question: Question,
  userAnswer: string,
  durationSec = 0,
  options?: { fromReview?: boolean },
): Promise<AnswerResult> {
  const data = await getData();
  let isCorrect: boolean;
  let score: string;
  let feedback = "";

  if (question.qType === "essay") {
    const binding = findTaskBinding(data, "grade_answer", question.courseId);
    if (!binding) {
      throw new Error(
        "未配置 AI 任务模型，请前往「模型配置 → AI 任务模型分配」设置「grade_answer」任务或「全局默认模型」",
      );
    }
    const gradeVars = {
      title: question.title,
      answer: question.answer,
      userAnswer: userAnswer || "（未作答）",
    };
    const gradeTpl = resolvePromptTemplate(data, "grade_answer");
    const res = await window.siyuanAiStudy.callAi({
      providerId: binding.providerId,
      modelId: binding.modelId,
      taskKey: "grade_answer",
      messages: [
        { role: "system", content: renderPrompt(gradeTpl.system, gradeVars) },
        { role: "user", content: renderPrompt(gradeTpl.user, gradeVars) },
      ],
    });
    const graded = parseAiGradeResponse(res.content);
    if (!graded) {
      throw new Error("AI 阅卷结果无法解析，请重试");
    }
    isCorrect = graded.score >= 60;
    score = String(graded.score);
    feedback = graded.feedback;
  } else {
    isCorrect = normalizeAnswer(userAnswer) === normalizeAnswer(question.answer);
    score = isCorrect ? "100" : "0";
  }

  const record: AnswerRecord = {
    id: nextId(data.answerRecords),
    qId: question.id,
    userAnswer,
    isCorrect,
    score,
    createTime: now(),
  };
  data.answerRecords.push(record);

  const masteryNotes: string[] = [];
  const planNotes: string[] = [];
  if (!isCorrect) {
    // 答错 → 归入错题本（已有记录含已毕业的重新激活）
    recordWrongResult(data.wrongQuestions, question.id, "wrong", now());
    // 答错 → 题目进入复习池（已有触点则重置为明日到期）
    ensureQuestionReviewInData(data, question.id);
    // 答错 → 关联知识点掌握度各降一级 + 追加薄弱练习任务
    for (const kpId of parseQuestionKpIds(question)) {
      const change = adjustMasteryInData(data, kpId, -1);
      if (change) {
        const kp = data.knowledgePoints.find((k) => k.id === kpId);
        if (kp) masteryNotes.push(`${kp.name} ${change}`);
      }
      appendWeakPointTaskInData(data, question.courseId, kpId, "practice");
    }
  } else {
    // 答对 → 勾掉关联知识点当天 practice 任务（含薄弱练习）
    for (const kpId of parseQuestionKpIds(question)) {
      planNotes.push(...completeKpTasksInData(data, kpId, ["practice"]));
    }
    // 答对 → 错题连对 +1（复习中提交不在此计，由 submitReview 按自评分统一计）
    if (!options?.fromReview) recordWrongResult(data.wrongQuestions, question.id, "correct", now());
  }

  logStudyInData(data, {
    courseId: question.courseId,
    kpId: parseQuestionKpIds(question)[0] ?? null,
    taskId: null,
    action: "answer",
    durationSec,
  });
  await saveData(data);
  return { isCorrect, score, feedback, masteryNotes, planNotes };
}

// 归一化作答：中文逗号统一为半角再按逗号拆分排序（AI 生成的多选答案可能用「，」分隔）
function normalizeAnswer(s: string): string {
  return s.trim().replace(/，/g, ",").split(/\s*,\s*/).map((p) => p.trim()).sort((a, b) => a.localeCompare(b)).join(",");
}

export async function queryWrongQuestions(
  courseId: number,
  options?: { includeGraduated?: boolean },
): Promise<Array<{ wrong: WrongQuestion; question: Question }>> {
  const data = await getData();
  const qMap = new Map(data.questions.filter((q) => q.courseId === courseId).map((q) => [q.id, q]));
  return data.wrongQuestions
    .filter((w) => qMap.has(w.qId))
    .filter((w) => options?.includeGraduated || (w.status ?? "active") === "active")
    .sort((a, b) => b.id - a.id)
    .map((w) => ({ wrong: w, question: qMap.get(w.qId)! }));
}

/** 本课程已毕业（已掌握）的错题数（题目属于该课程） */
export async function countGraduatedWrongQuestions(courseId: number): Promise<number> {
  const data = await getData();
  const qMap = new Map(data.questions.filter((q) => q.courseId === courseId).map((q) => [q.id, q]));
  return data.wrongQuestions.filter((w) => (w.status ?? "active") === "graduated" && qMap.has(w.qId)).length;
}

export async function deleteWrongQuestion(id: number): Promise<void> {
  const data = await getData();
  data.wrongQuestions = data.wrongQuestions.filter((w) => w.id !== id);
  await saveData(data);
}

/** 导出错题集 Markdown（含题干/我的答案/正确答案/解析/知识点/错误类型/答错次数） */
export async function exportWrongQuestionsMarkdown(
  items: Array<{ wrong: WrongQuestion; question: Question }>,
  knowledgePoints: KnowledgePoint[],
  courseName: string,
): Promise<string> {
  const data = await getData();
  // 每题取最近一次作答作为「我的答案」
  const lastAnswer = new Map<number, string>();
  for (const r of data.answerRecords) lastAnswer.set(r.qId, r.userAnswer);
  const kpMap = new Map(knowledgePoints.map((k) => [k.id, k.name]));
  const lines: string[] = [
    `# 错题导出 - ${courseName}`,
    `> 共 ${items.length} 题 · 导出时间 ${new Date().toLocaleString("zh-CN", { hour12: false })}`,
    "",
  ];
  items.forEach(({ wrong, question }, i) => {
    lines.push(`---`, `${i + 1}. ${question.title.replace(/\n/g, " ")}`);
    parseQuestionOptions(question).forEach((opt, j) => {
      lines.push(`${String.fromCharCode(65 + j)}. ${opt}`);
    });
    lines.push(`我的答案: ${lastAnswer.get(question.id) ?? "（无作答记录）"}`);
    lines.push(`正确答案: ${question.answer}`);
    if (question.analysis) lines.push(`解析: ${question.analysis}`);
    lines.push(`题型: ${QUESTION_TYPE_LABELS[question.qType as QuestionType]}`);
    lines.push(`难度: ${QUESTION_DIFFICULTY_LABELS[question.difficulty as QuestionDifficulty]}`);
    const kpNames = parseQuestionKpIds(question).map((id) => kpMap.get(id)).filter(Boolean);
    if (kpNames.length) lines.push(`知识点: ${kpNames.join(", ")}`);
    lines.push(`错误类型: ${WRONG_ERROR_TYPE_LABELS[wrong.errorType as WrongErrorType] ?? "未标记"}`);
    lines.push(`答错次数: ${wrong.reviewTimes}`, "");
  });
  return lines.join("\n");
}

export const WRONG_ERROR_TYPES = ["concept", "memory", "careless"] as const;
export type WrongErrorType = (typeof WRONG_ERROR_TYPES)[number];

export const WRONG_ERROR_TYPE_LABELS: Record<WrongErrorType, string> = {
  concept: "概念不清",
  memory: "记忆遗漏",
  careless: "粗心",
};

export async function markWrongErrorType(id: number, errorType: WrongErrorType | null): Promise<void> {
  const data = await getData();
  const w = data.wrongQuestions.find((x) => x.id === id);
  if (!w) throw new Error("错题不存在");
  if (errorType) w.errorType = errorType;
  else delete w.errorType;
  await saveData(data);
}

// ===== 讲解评估（冯诺依曼学习法） =====
export interface ExplainResult {
  score: number;
  feedback: string;
  /** 掌握度升级说明（分数 ≥80 且该知识点无未移出错题时非空） */
  masteryNotes: string[];
  /** 达标自动勾掉的任务标题（严格打勾） */
  planNotes: string[];
}

/** 讲解达标（≥60 分）→ 知识点进入复习池。 */
export const EXPLAIN_PASS_SCORE = 60;

function parseAiExplainResponse(content: string): { score: number; feedback: string } | null {
  const trimmed = content.trim();
  const jsonMatch =
    trimmed.match(/```(?:json)?\s*([\s\S]*?)```/) ||
    trimmed.match(/(\{[\s\S]*\})/);
  const candidate = (jsonMatch ? jsonMatch[1] : trimmed).trim();
  try {
    const parsed = JSON.parse(candidate);
    if (parsed && typeof parsed.score === "number" && Number.isFinite(parsed.score)) {
      return {
        score: Math.max(0, Math.min(100, Math.round(parsed.score))),
        feedback: typeof parsed.feedback === "string" ? parsed.feedback : "",
      };
    }
  } catch {
    // ignore
  }
  return null;
}

/** 提交一次讲解，AI 按「正确性 / 覆盖度 / 清晰度」评估并落 ExplainRecord。 */
export async function submitExplain(kp: KnowledgePoint, userContent: string, durationSec = 0): Promise<ExplainResult> {
  const data = await getData();
  const binding = findTaskBinding(data, "eval_explain", kp.courseId);
  if (!binding) {
    throw new Error(
      "未配置 AI 任务模型，请前往「模型配置 → AI 任务模型分配」设置「eval_explain」任务或「全局默认模型」",
    );
  }

  const explainVars = {
    kpName: kp.name,
    kpContent: kp.content || "（无描述，请按知识点名称判断）",
    userContent,
  };
  const explainTpl = resolvePromptTemplate(data, "eval_explain");
  const res = await window.siyuanAiStudy.callAi({
    providerId: binding.providerId,
    modelId: binding.modelId,
    taskKey: "eval_explain",
    messages: [
      { role: "system", content: renderPrompt(explainTpl.system, explainVars) },
      { role: "user", content: renderPrompt(explainTpl.user, explainVars) },
    ],
  });

  const result = parseAiExplainResponse(res.content);
  if (!result) {
    throw new Error("AI 评估结果无法解析，请重试");
  }

  const courseKp = data.knowledgePoints.find((k) => k.id === kp.id);
  if (!courseKp) {
    throw new Error("知识点不存在，可能已被删除");
  }

  const record: ExplainRecord = {
    id: nextId(data.explainRecords),
    courseId: courseKp.courseId,
    kpId: courseKp.id,
    userContent,
    aiFeedback: result.feedback,
    aiScore: String(result.score),
    createTime: now(),
    askPrompt: kp.askPrompt || "",
  };
  data.explainRecords.push(record);
  const masteryNotes: string[] = [];
  const planNotes: string[] = [];
  if (result.score >= EXPLAIN_PASS_SCORE) {
    ensureReviewTouchpointInData(data, courseKp.id);
    // 达标 → 勾掉当天 learn/review 任务
    planNotes.push(...completeKpTasksInData(data, courseKp.id, ["learn", "review"]));
  }
  // 讲解 ≥80 且该知识点无未移出当前错题本记录 → 掌握度升一级
  if (result.score >= EXPLAIN_MASTER_SCORE && !kpHasOpenWrong(data, courseKp.id)) {
    const change = adjustMasteryInData(data, courseKp.id, 1);
    if (change) masteryNotes.push(`${courseKp.name} ${change}`);
  }
  // 讲解不达标（<60）→ 追加薄弱复习任务
  if (result.score < EXPLAIN_PASS_SCORE) {
    appendWeakPointTaskInData(data, courseKp.courseId, courseKp.id, "review");
  }
  logStudyInData(data, {
    courseId: courseKp.courseId,
    kpId: courseKp.id,
    taskId: null,
    action: "explain",
    durationSec,
  });
  await saveData(data);
  return { ...result, masteryNotes, planNotes };
}

// ===== 费曼提问（AI 按知识点内容生成，带缓存） =====
/** 缓存快照：名称|内容；任一变化即视为过期 */
function askPromptSignature(kp: KnowledgePoint): string {
  return `${kp.name}|${kp.content}`;
}

/** 缓存的提问是否仍有效（未生成或快照不匹配均视为过期） */
export function isAskPromptFresh(kp: KnowledgePoint): boolean {
  return Boolean(kp.askPrompt && kp.askPromptContent === askPromptSignature(kp));
}

/** 从 AI 输出中提取一行有效提问（剥离思考块、代码围栏、引号、多余说明行） */
function extractAskPrompt(raw: string): string {
  let text = (raw || "").trim();
  if (!text) return "";
  // 思考型模型（如 MiniMax）会在正式输出前附带思考块，取最后一个结束标记之后的内容
  const thinkParts = text.split("</think>\n");
  if (thinkParts.length > 1) text = thinkParts[thinkParts.length - 1].trim();
  const fence = text.match(/```[\w-]*\s*\n?([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  text = text.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();
  const line = text.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
  return line && line.length >= 4 && line.length <= 200 ? line : "";
}

/**
 * 生成（或取缓存）知识点的费曼提问。
 * 缓存按「名称|内容」快照判过期；force=true 强制重掷。
 * 失败抛错，由调用方回退固定提问。
 */
export async function generateKpAskPrompt(kp: KnowledgePoint, force = false): Promise<string> {
  const data = await getData();
  const stored = data.knowledgePoints.find((k) => k.id === kp.id);
  if (!stored) throw new Error("知识点不存在，可能已被删除");
  if (!force && isAskPromptFresh(stored)) {
    return stored.askPrompt as string;
  }
  const binding = findTaskBinding(data, "gen_ask", stored.courseId);
  if (!binding) {
    throw new Error(
      "未配置 AI 任务模型，请前往「模型配置 → AI 任务模型分配」设置「gen_ask」任务或「全局默认模型」",
    );
  }
  const courseName = data.courses.find((c) => c.id === stored.courseId)?.name ?? "";
  const askVars = {
    courseName,
    kpName: stored.name,
    kpContent: stored.content || "（无描述，请按知识点名称判断）",
  };
  const askTpl = resolvePromptTemplate(data, "gen_ask");
  const res = await window.siyuanAiStudy.callAi({
    providerId: binding.providerId,
    modelId: binding.modelId,
    taskKey: "gen_ask",
    messages: [
      { role: "system", content: renderPrompt(askTpl.system, askVars) },
      { role: "user", content: renderPrompt(askTpl.user, askVars) },
    ],
  });
  const prompt = extractAskPrompt(res.content);
  if (!prompt) throw new Error("AI 未返回有效提问，请重试");
  stored.askPrompt = prompt;
  stored.askPromptContent = askPromptSignature(stored);
  await saveData(data);
  return prompt;
}

export async function queryExplainRecords(kpId: number): Promise<ExplainRecord[]> {
  const data = await getData();
  return data.explainRecords
    .filter((r) => r.kpId === kpId)
    .sort((a, b) => b.id - a.id);
}

export interface ExplainSummary {
  kpId: number;
  kpName: string;
  rounds: number;
  lastScore: string;
  lastTime: string;
}

/** 课程维度讲解会话汇总（按知识点分组，最近时间倒序；「过往学习会话」卡片用） */
export async function queryExplainSummaries(courseId: number): Promise<ExplainSummary[]> {
  const data = await getData();
  const nameById = new Map(data.knowledgePoints.map((k) => [k.id, k.name]));
  const byKp = new Map<number, ExplainRecord[]>();
  for (const r of data.explainRecords) {
    if (r.courseId !== courseId) continue;
    const list = byKp.get(r.kpId) ?? [];
    list.push(r);
    byKp.set(r.kpId, list);
  }
  const out: ExplainSummary[] = [];
  for (const [kpId, list] of byKp) {
    list.sort((a, b) => a.id - b.id);
    const last = list[list.length - 1];
    out.push({
      kpId,
      kpName: nameById.get(kpId) ?? `#${kpId}`,
      rounds: list.length,
      lastScore: last.aiScore,
      lastTime: last.createTime,
    });
  }
  out.sort((a, b) => b.lastTime.localeCompare(a.lastTime));
  return out;
}

// ===== AI 习题生成 =====
interface AiQuestionItem {
  qType: string;
  kpIds: number[];
  title: string;
  options: string[];
  answer: string;
  analysis: string;
  difficulty: string;
}

/** 从对象里按别名顺序取第一个非空字符串字段 */
function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim() !== "") return v;
  }
  return null;
}

/**
 * 提取文本中所有括号配平的完整 JSON 对象文本（字符串/转义感知）。
 * 外层对象若包含已提取的内层对象则丢弃外层（保留最内层题目项）。
 * 用于输出被截断时的救援：最后一个不完整的对象会被自然跳过。
 */
function extractCompleteObjects(text: string): string[] {
  const out: string[] = [];
  const startStack: number[] = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      startStack.push(i);
    } else if (ch === "}" && startStack.length > 0) {
      const start = startStack.pop() as number;
      const slice = text.slice(start, i + 1);
      if (!out.some((inner) => inner !== slice && slice.includes(inner))) {
        out.push(slice);
      }
    }
  }
  return out;
}

/** 单条题目归一化：字段别名容错 + 必填校验（title/answer），不合格返回 null */
function normalizeAiQuestionItem(raw: unknown, fallbackQType: QuestionType): AiQuestionItem | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const it = raw as Record<string, unknown>;
  const title = pickString(it, ["title", "question", "题干"]);
  const answer = pickString(it, ["answer", "正确答案", "correctAnswer"]);
  if (title == null || answer == null) return null;
  const qTypeRaw = typeof it.qType === "string" ? it.qType : typeof it.type === "string" ? it.type : "";
  const qType = QUESTION_TYPES.includes(qTypeRaw as QuestionType) ? (qTypeRaw as QuestionType) : fallbackQType;
  const kpRaw = it.kpIds ?? it.kpId;
  let kpIds: number[] = [];
  if (Array.isArray(kpRaw)) {
    kpIds = kpRaw.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0);
  } else if (kpRaw != null) {
    const n = Number(kpRaw);
    if (Number.isFinite(n) && n > 0) kpIds = [n];
  }
  const optionsRaw = it.options ?? it["选项"];
  const options = Array.isArray(optionsRaw) ? optionsRaw.filter((o): o is string => typeof o === "string") : [];
  return {
    qType,
    kpIds,
    title,
    options,
    answer,
    analysis: pickString(it, ["analysis", "解析", "explanation"]) ?? "",
    difficulty: it.difficulty === "easy" || it.difficulty === "hard" ? it.difficulty : "medium",
  };
}

/**
 * 解析 AI 出题响应：
 * 1) 整体 JSON（裸数组 / ```json 块 / {"questions": [...]} 包装）；
 * 2) 整体解析失败（如输出被截断）时救援：提取完整的对象逐条解析，部分成功也算成功。
 */
function parseAiQuestionResponse(content: string, fallbackQType: QuestionType = "single"): AiQuestionItem[] {
  const trimmed = content.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const fenceText = fenceMatch ? fenceMatch[1].trim() : null;
  const arrMatch = trimmed.match(/(\[[\s\S]*\])/);

  // 候选按可信度排序：围栏内容 > 完整原文（以 [/{ 开头）> 贪婪数组匹配
  const candidates: string[] = [];
  for (const c of [fenceText, trimmed.startsWith("[") || trimmed.startsWith("{") ? trimmed : null, arrMatch ? arrMatch[1] : null]) {
    if (c && !candidates.includes(c)) candidates.push(c);
  }

  const items: AiQuestionItem[] = [];
  const pushItem = (raw: unknown) => {
    const item = normalizeAiQuestionItem(raw, fallbackQType);
    if (item) items.push(item);
  };

  for (const candidate of candidates) {
    try {
      let parsed: unknown = JSON.parse(candidate);
      // 部分模型会用对象包装数组，如 {"questions": [...]}
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const obj = parsed as Record<string, unknown>;
        for (const key of ["questions", "items", "data", "list"]) {
          if (Array.isArray(obj[key])) {
            parsed = obj[key];
            break;
          }
        }
      }
      if (Array.isArray(parsed)) {
        for (const it of parsed) pushItem(it);
        return items;
      }
    } catch {
      // 尝试下一个候选
    }
  }

  // 截断救援：扫描完整原文（贪婪数组匹配会误切到 kpIds 等内层数组，不能用于救援）
  const rescueText = fenceText ?? trimmed;
  for (const slice of extractCompleteObjects(rescueText)) {
    try {
      pushItem(JSON.parse(slice));
    } catch {
      // 个别对象损坏则跳过
    }
  }
  return items;
}

/** 生成题目（批量）。成功落库后返回新题，任何校验/AI 失败时不动题库。 */
export async function generateQuestions(
  courseId: number,
  input: { kpIds: number[]; count: number; qType: QuestionType; difficulty: QuestionDifficulty },
): Promise<Question[]> {
  const data: AppData = await getData();
  const course = data.courses.find((c) => c.id === courseId);
  if (!course) {
    throw new Error("课程不存在");
  }
  if (input.kpIds.length === 0) {
    throw new Error("请至少选择一个知识点");
  }
  const kps = data.knowledgePoints.filter((k) => input.kpIds.includes(k.id));
  if (kps.length === 0) {
    throw new Error("所选知识点不存在，可能已被删除");
  }
  const binding = findTaskBinding(data, "gen_question", courseId);
  if (!binding) {
    throw new Error(
      "未配置 AI 任务模型，请前往「模型配置 → AI 任务模型分配」设置「gen_question」任务或「全局默认模型」",
    );
  }
  const qTypeLabel = QUESTION_TYPE_LABELS[input.qType];
  const diffLabel = QUESTION_DIFFICULTY_LABELS[input.difficulty];

  // 铃铛：出题是单次长调用，无分段进度（total=0 不显示进度条）
  const notify = useNotifyStore();
  const qTaskId = courseTaskId(courseId, "gen_question");
  notify.upsertTask({
    taskId: qTaskId,
    label: course.name,
    courseId,
    taskType: "gen_question",
    status: "running",
    done: 0,
    total: 0,
    message: `AI 出题中（${kps.length} 个知识点 → ${input.count} 题）…`,
    unread: false,
    startedAt: now(),
    finishedAt: null,
  });

  const kpLines = kps.map((k) => `- ${k.id}. ${k.name}：${truncateText(k.content, 200) || "暂无描述"}`).join("\n");

  const questionVars = {
    qType: input.qType,
    difficulty: input.difficulty,
    courseName: course.name,
    count: String(input.count),
    qTypeLabel,
    diffLabel,
    kpLines,
  };
  try {
    const questionTpl = resolvePromptTemplate(data, "gen_question");
    const baseMessages = [
      { role: "system", content: renderPrompt(questionTpl.system, questionVars) },
      { role: "user", content: renderPrompt(questionTpl.user, questionVars) },
    ];

    // 解析失败自动重试一次：把上次无法解析的原始输出交还给模型自纠正
    let items: AiQuestionItem[] = [];
    let messages = baseMessages;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const res = await window.siyuanAiStudy.callAi({
        providerId: binding.providerId,
        modelId: binding.modelId,
        taskKey: "gen_question",
        messages,
      });
      items = parseAiQuestionResponse(res.content, input.qType);
      if (items.length > 0) break;
      if (attempt === 1) {
        messages = [
          ...baseMessages,
          { role: "assistant", content: res.content },
          {
            role: "user",
            content:
              "你上次的输出无法解析为题目 JSON。请重新输出：只返回包含 " +
              input.count +
              " 道题目的 JSON 数组，每项字段为 qType、kpIds、title、options、answer、analysis、difficulty，不要输出任何其他文字。",
          },
        ];
      }
    }
    if (items.length === 0) {
      throw new Error("AI 两次输出格式异常，请重试或更换模型");
    }
    const kpIdSet = new Set(input.kpIds);

    const questions: Question[] = [];
    let nextQuestionId = nextId(data.questions);
    for (const item of items) {
      // 模型漏给 kpIds 时回退绑定全部所选知识点，避免产生无归属题
      const bound = item.kpIds.filter((n) => kpIdSet.has(n));
      questions.push({
        id: nextQuestionId++,
        courseId,
        kpIds: (bound.length > 0 ? bound : input.kpIds).join(","),
        title: item.title,
        options: JSON.stringify(item.options),
        answer: item.answer,
        analysis: item.analysis,
        qType: item.qType,
        difficulty: item.difficulty,
        source: "ai",
        createTime: now(),
      });
    }
    data.questions.push(...questions);
    await saveData(data);
    notify.patchTask(qTaskId, { status: "done", unread: true, finishedAt: now(), message: `已生成 ${questions.length} 道题` });
    return questions;
  } catch (e) {
    notify.patchTask(qTaskId, {
      status: "failed",
      unread: true,
      finishedAt: now(),
      message: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

export function truncateText(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// ===== 知识图谱（前置关系存于 KnowledgePoint.prevKpIds，逗号分隔的知识点 id） =====
export function parseKpPrevIds(kp: KnowledgePoint): number[] {
  return kp.prevKpIds
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

const GRAPH_BATCH_SIZE = 30;

/**
 * AI 推理课程内知识点的前置关系，写入 prevKpIds（按批调用，批间关系不推理）。
 * reset=true 时先清空本课程既有关系再写入。返回推理得到的关系条数。
 */
export async function inferGraphRelations(courseId: number, reset = true): Promise<number> {
  const data: AppData = await getData();
  const kps = data.knowledgePoints.filter((k) => k.courseId === courseId);
  if (kps.length === 0) {
    throw new Error("该课程暂无知识点，请先在「课程内容」抽取知识点");
  }
  const binding = findTaskBinding(data, "infer_graph", courseId);
  if (!binding) {
    throw new Error(
      "未配置 AI 任务模型，请前往「模型配置 → AI 任务模型分配」设置「infer_graph」任务或「全局默认模型」",
    );
  }
  if (reset) {
    for (const k of kps) k.prevKpIds = "";
  }
  let totalEdges = 0;
  for (let i = 0; i < kps.length; i += GRAPH_BATCH_SIZE) {
    const batch = kps.slice(i, i + GRAPH_BATCH_SIZE);
    const byId = new Map(batch.map((k) => [k.id, k]));
    const kpLines = batch.map((k) => `- ${k.id}. ${k.name}：${truncateText(k.content, 120) || "暂无描述"}`).join("\n");
    const graphVars = { kpLines };
    const graphTpl = resolvePromptTemplate(data, "infer_graph");
    const res = await window.siyuanAiStudy.callAi({
      providerId: binding.providerId,
      modelId: binding.modelId,
      taskKey: "infer_graph",
      messages: [
        { role: "system", content: renderPrompt(graphTpl.system, graphVars) },
        { role: "user", content: renderPrompt(graphTpl.user, graphVars) },
      ],
    });
    const trimmed = res.content.trim();
    const jsonMatch =
      trimmed.match(/```(?:json)?\s*([\s\S]*?)```/) || trimmed.match(/(\[[\s\S]*\])/);
    const candidate = (jsonMatch ? jsonMatch[1] : trimmed).trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      parsed = null;
    }
    const items = Array.isArray(parsed) ? parsed : [];
    for (const it of items) {
      const rec = (it ?? {}) as { kpId?: unknown; prevKpIds?: unknown };
      if (typeof rec !== "object") continue;
      const kpId = Number(rec.kpId);
      const kp = byId.get(kpId);
      if (!kp) continue;
      const prevs = Array.isArray(rec.prevKpIds)
        ? [...new Set(rec.prevKpIds.map((n) => Number(n)).filter((n) => Number.isFinite(n) && byId.has(n) && n !== kpId))]
        : [];
      kp.prevKpIds = prevs.join(",");
      totalEdges += prevs.length;
    }
    await saveData(data);
  }
  return totalEdges;
}

/** 手动添加一条前置关系（prevKpId 是 kpId 的前置）；已存在时直接返回 */
export async function addKpEdge(kpId: number, prevKpId: number): Promise<void> {
  if (kpId === prevKpId) {
    throw new Error("知识点不能是自己的前置");
  }
  const data = await getData();
  const kp = data.knowledgePoints.find((k) => k.id === kpId);
  if (!kp) {
    throw new Error("知识点不存在，可能已被删除");
  }
  const ids = kp.prevKpIds.split(",").map((s) => s.trim()).filter(Boolean);
  if (!ids.includes(String(prevKpId))) {
    kp.prevKpIds = [...ids, String(prevKpId)].join(",");
    await saveData(data);
  }
}

/** 手动移除一条前置关系 */
export async function removeKpEdge(kpId: number, prevKpId: number): Promise<void> {
  const data = await getData();
  const kp = data.knowledgePoints.find((k) => k.id === kpId);
  if (!kp) {
    throw new Error("知识点不存在，可能已被删除");
  }
  kp.prevKpIds = kp.prevKpIds
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && s !== String(prevKpId))
    .join(",");
  await saveData(data);
}

/** 将课程知识图谱写为思源文档（课程文档下的「知识图谱」子文档，已存在时带日期后缀），返回文档名 */
export async function writeGraphToSiyuan(courseId: number): Promise<string> {
  const data = await getData();
  const course = data.courses.find((c) => c.id === courseId);
  if (!course) {
    throw new Error("课程不存在");
  }
  const settings = await getSettings();
  if (!settings.persistToSiyuan) {
    throw new Error("请先在「模型配置 → 数据与存储」开启「资料持久化到思源」");
  }
  const kps = data.knowledgePoints.filter((k) => k.courseId === courseId);
  const nameById = new Map(kps.map((k) => [k.id, k.name]));
  const lines = kps.map((k) => {
    const prevs = parseKpPrevIds(k)
      .map((id) => nameById.get(id))
      .filter((n): n is string => Boolean(n));
    return `- **${k.name}**${prevs.length ? `（前置：${prevs.join("、")}）` : ""}`;
  });
  const markdown =
    `# 知识图谱\n\n课程：${course.name}\n\n## 前置关系\n\n${lines.join("\n") || "（暂无知识点）"}`;
  const notebook = await ensureNotebook(settings.notebookName);
  const baseName = "知识图谱";
  try {
    await createSiyuanDoc(markdown, `/${course.name}/${baseName}`, notebook);
    return baseName;
  } catch {
    // 同名文档已存在时回退为带日期的文档名
    const stamped = `${baseName} ${formatLocalDate()}`;
    await createSiyuanDoc(markdown, `/${course.name}/${stamped}`, notebook);
    return stamped;
  }
}

// ===== 任务模型绑定 =====
export const AI_TASKS = [
  { key: "extract_kp", name: "文档知识点抽取" },
  { key: "gen_plan", name: "AI 学习计划生成" },
  { key: "gen_question", name: "AI 习题生成" },
  { key: "eval_explain", name: "讲解内容评估" },
  { key: "grade_answer", name: "简答题 AI 阅卷" },
  { key: "gen_report", name: "学习报告生成" },
  { key: "infer_graph", name: "图谱关联关系推理" },
  { key: "recognize_toc", name: "目录识别矫正" },
  { key: "organize_doc", name: "文档结构梳理" },
  { key: "gen_flashcard", name: "AI 闪卡生成" },
  { key: "gen_ask", name: "费曼提问生成" },
] as const;

export const GLOBAL_DEFAULT_KEY = "global_default";

export async function saveTaskModel(taskKey: string, modelId: number | null): Promise<void> {
  const data = await getData();
  const idx = data.taskModels.findIndex((t) => t.taskKey === taskKey);
  if (idx >= 0) {
    data.taskModels[idx].modelId = modelId;
  } else {
    data.taskModels.push({ taskKey, modelId, isGlobalDefault: taskKey === GLOBAL_DEFAULT_KEY });
  }
  await saveData(data);
}

export async function getTaskModelMap(): Promise<Record<string, number | null>> {
  const data = await getData();
  const map: Record<string, number | null> = {};
  for (const t of data.taskModels) {
    map[t.taskKey] = t.modelId;
  }
  return map;
}

// ===== 资料管理 =====
// 删除资料的源文件（思源资源目录）：其他资料仍引用同一文件时跳过；
// 内核仅允许删除未被任何文档引用的资源，被引用（如用户手动拖入笔记）时仅记录日志不阻塞
async function removeAssetIfUnused(assetPath: string, remainingMaterials: Material[]): Promise<void> {
  if (!assetPath) return;
  if (remainingMaterials.some((m) => m.assetPath === assetPath)) return;
  try {
    await window.siyuanAiStudy.removeAsset(assetPath);
  } catch (e) {
    console.error("删除思源资源文件失败:", e);
  }
}

export const MATERIAL_SOURCE_LABELS: Record<string, string> = {
  upload: "上传",
  paste: "粘贴",
  siyuan: "思源",
};

export function materialSourceLabel(m: Material): string {
  const source = m.source ?? (m.assetPath ? "upload" : "paste");
  return MATERIAL_SOURCE_LABELS[source] ?? source;
}

export async function createMaterial(input: {
  courseId: number;
  name: string;
  fileType: string;
  contentText: string;
  assetPath?: string;
  headings?: string;
  source?: string;
  /** 绑定思源已有文档：直接记录其 docId，跳过落库（避免重复建档） */
  siyuanDocId?: string;
}): Promise<Material> {
  const data = await getData();
  const course = data.courses.find((c) => c.id === input.courseId);
  // 绑定已有文档时直接用其 docId；否则按设置决定是否落库思源（资料文档放课程文档下「资料库」目录）
  const docId =
    input.siyuanDocId ??
    (await persistDocIfEnabled(
      `# ${input.name}\n\n${input.contentText}`,
      `/${course?.name ?? "课程"}/资料库/${input.name}`,
    ));
  const material: Material = {
    id: nextId(data.materials),
    courseId: input.courseId,
    name: input.name,
    assetPath: input.assetPath ?? "",
    fileType: input.fileType,
    contentText: input.contentText,
    headings: input.headings ?? "[]",
    siyuanDocId: docId,
    status: "parsed",
    createTime: now(),
    source: input.source ?? (input.assetPath ? "upload" : "paste"),
  };
  data.materials.push(material);
  await saveData(data);
  return material;
}

// ===== 资料 AI 结构梳理（后台任务） =====
// 模块级状态不受组件卸载影响：上传后弹窗即关、切页不中断；同一资料防并发
const organizingMaterialIds = new Set<number>();
const organizeAbortFlags = new Map<number, { aborted: boolean }>();

/** 文本切段：按空行分段聚合到 ~size 字符；单段超限（OCR 长行）硬切 */
function splitTextChunks(text: string, size = 8000): string[] {
  const chunks: string[] = [];
  let current = "";
  const push = () => {
    const t = current.trim();
    if (t) chunks.push(t);
    current = "";
  };
  for (const para of text.split(/\n\s*\n/)) {
    if (para.length > size) {
      push();
      for (let i = 0; i < para.length; i += size) {
        chunks.push(para.slice(i, i + size));
      }
      continue;
    }
    if (current.length + para.length + 2 > size) push();
    current += (current ? "\n\n" : "") + para;
  }
  push();
  return chunks;
}

export interface OrganizeResult {
  content: string;
  /** AI 是否实际参与（未配置任务模型时为 false，返回原文） */
  organized: boolean;
  /** 输出异常被弃用、保留原文的段数 */
  failedChunks: number;
}

/**
 * AI 文档结构梳理：分段 → 逐段调 callAi（删页眉页脚噪声/拼断行/标注章 # 节 ##）→ 拼接。
 * 安全网：段输出长度不足输入 40% 视为异常（防 AI 概括丢内容），该段保留原文。
 */
export async function organizeDocWithAi(
  text: string,
  courseId?: number,
  onProgress?: (done: number, total: number) => void,
  isAborted?: () => boolean,
): Promise<OrganizeResult> {
  const data = await getData();
  const binding = findTaskBinding(data, "organize_doc", courseId);
  if (!binding || !text.trim()) {
    return { content: text, organized: false, failedChunks: 0 };
  }
  const tpl = resolvePromptTemplate(data, "organize_doc");
  const chunks = splitTextChunks(text);
  const out: string[] = [];
  let failedChunks = 0;
  for (let i = 0; i < chunks.length; i++) {
    if (isAborted?.()) {
      out.push(...chunks.slice(i));
      break;
    }
    onProgress?.(i, chunks.length);
    const chunk = chunks[i];
    let cleaned = chunk;
    try {
      const res = await window.siyuanAiStudy.callAi({
        providerId: binding.providerId,
        modelId: binding.modelId,
        taskKey: "organize_doc",
        messages: [
          { role: "system", content: renderPrompt(tpl.system, {}) },
          { role: "user", content: renderPrompt(tpl.user, { chunk }) },
        ],
      });
      let candidate = res.content.trim();
      const fence = candidate.match(/^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/);
      if (fence) candidate = fence[1].trim();
      // 推理模型思考泄漏：content 混入思考文本时，取思考结束标记之后的正文
      const thinkEndTag = "</" + "think>";
      const thinkStartTag = "<" + "think" + ">";
      const thinkEnd = candidate.lastIndexOf(thinkEndTag);
      if (thinkEnd >= 0) {
        candidate = candidate.slice(thinkEnd + thinkEndTag.length).trim();
      } else if (candidate.includes(thinkStartTag)) {
        // 无闭合标记：取最后一个 "Let's xxx." 过渡句之后的正文
        let cut = -1;
        const re = /\bLet's [a-zA-Z]+\.\s*/g;
        let m2;
        while ((m2 = re.exec(candidate)) !== null) cut = m2.index + m2[0].length;
        if (cut > 0) candidate = candidate.slice(cut).trim();
      }
      if (candidate && candidate.length >= chunk.length * 0.4) {
        cleaned = candidate;
      } else {
        failedChunks++;
      }
    } catch (e) {
      console.error(`AI 梳理第 ${i + 1}/${chunks.length} 段失败:`, e);
      failedChunks++;
    }
    out.push(cleaned);
  }
  onProgress?.(chunks.length, chunks.length);
  return { content: out.join("\n\n").trim(), organized: true, failedChunks };
}

/**
 * 启动资料的后台 AI 梳理任务（不阻塞调用方）。
 * text 省略时：有源文件则重读重解析，无源文件（粘贴/思源）用已存内容。
 * 同一资料已有任务在跑时忽略重复启动。
 */
export function startOrganizeTask(materialId: number, courseId: number, text?: string): void {
  if (organizingMaterialIds.has(materialId)) return;
  organizingMaterialIds.add(materialId);
  const flag = { aborted: false };
  organizeAbortFlags.set(materialId, flag);
  void runOrganizeTask(materialId, courseId, text, flag);
}

export function cancelOrganizeTask(materialId: number): void {
  const flag = organizeAbortFlags.get(materialId);
  if (flag) flag.aborted = true;
}

async function runOrganizeTask(
  materialId: number,
  courseId: number,
  text: string | undefined,
  flag: { aborted: boolean },
): Promise<void> {
  const notify = useNotifyStore();
  const orgTaskId = materialTaskId(materialId, "organize");
  try {
    const data = await getData();
    const material = data.materials.find((m) => m.id === materialId);
    if (!material) throw new Error("资料不存在或已删除");
    // 取待梳理文本：优先调用方提供的（上传即用内存文本，免二次下载）
    let source = text;
    if (!source) {
      if (material.assetPath) {
        const res = await fetch(material.assetPath);
        if (!res.ok) throw new Error("读取源文件失败，请重新上传");
        const blob = await res.blob();
        const { parseDocument } = await import("../utils/documentParser");
        const fileName = /\.(pdf|docx|pptx|txt|md|markdown)$/i.test(material.name)
          ? material.name
          : `${material.name}.${material.fileType}`;
        source = (await parseDocument(new File([blob], fileName))).contentText;
      } else {
        source = material.contentText;
      }
    }
    if (!source.trim()) throw new Error("资料没有可梳理的文本内容");
    notify.upsertTask({
      taskId: orgTaskId,
      label: material.name,
      materialId,
      courseId,
      taskType: "organize",
      status: "running",
      done: 0,
      total: 0,
      message: "准备中…",
      unread: false,
      startedAt: now(),
      finishedAt: null,
    });
    const res = await organizeDocWithAi(
      source,
      courseId,
      (done, total) => {
        if (total > 0) {
          notify.patchTask(orgTaskId, { done, total, message: `AI 梳理中：第 ${Math.min(done + 1, total)}/${total} 段…` });
        }
      },
      () => flag.aborted,
    );
    if (flag.aborted) {
      notify.patchTask(orgTaskId, { status: "canceled", unread: true, finishedAt: now(), message: "任务已取消" });
      return;
    }
    if (!res.organized) {
      notify.patchTask(orgTaskId, {
        status: "failed",
        unread: true,
        finishedAt: now(),
        message: "未配置「文档结构梳理」模型：请到「模型配置 → 任务模型」为该任务指定模型",
      });
      return;
    }
    // 回写：整理后正文 + 标题结构（从 # / ## 行提取）+ 同步思源文档
    const latest = await getData();
    const mat = latest.materials.find((m) => m.id === materialId);
    if (!mat) throw new Error("资料已在任务期间被删除");
    const { extractHeadingsFromMarkdown } = await import("../utils/documentParser");
    const headings = extractHeadingsFromMarkdown(res.content);
    mat.contentText = res.content;
    mat.headings = JSON.stringify(headings);
    await saveData(latest);
    let siyuanSyncFailed = false;
    if (mat.siyuanDocId && isSiyuanDocId(mat.siyuanDocId)) {
      try {
        await window.siyuanAiStudy.updateSiyuanDoc(mat.siyuanDocId, `# ${mat.name}\n\n${res.content}`);
      } catch (e) {
        siyuanSyncFailed = true;
        console.error("同步梳理结果到思源失败:", e);
      }
    }
    const chCount = headings.filter((h) => h.level === 1).length;
    let msg = `梳理完成：识别 ${chCount} 章 ${headings.length - chCount} 节`;
    if (res.failedChunks > 0) msg += `；${res.failedChunks} 段输出异常已保留原文`;
    if (siyuanSyncFailed) msg += "；同步思源文档失败";
    notify.patchTask(orgTaskId, { status: "done", unread: true, finishedAt: now(), message: msg });
    // 自动目录模式：梳理完成后弹目录预览（梳理后的标题比梳理前的启发式识别更干净）
    if (latest.settings.chapterMode === "auto" && headings.length > 0) {
      useModalStore().openChapterPreview(courseId, headings, materialId);
    }
  } catch (e) {
    notify.patchTask(orgTaskId, {
      status: "failed",
      unread: true,
      finishedAt: now(),
      message: e instanceof Error ? e.message : String(e),
    });
  } finally {
    organizingMaterialIds.delete(materialId);
    organizeAbortFlags.delete(materialId);
  }
}

// ===== 思源文档（同源自带通道，无需 token） =====
async function siyuanApi<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { code: number; msg?: string; data?: T };
  if (json.code !== 0) throw new Error(json.msg || "思源接口调用失败");
  return json.data as T;
}

export interface SiyuanDocEntry {
  id: string;
  path: string;
  name: string;
  subFileCount: number;
}

export async function listSiyuanNotebooks(): Promise<Array<{ id: string; name: string }>> {
  const data = await siyuanApi<{ notebooks: Array<{ id: string; name: string }> }>("notebook/lsNotebooks", {});
  return data.notebooks;
}

export async function listSiyuanDocs(notebookId: string, path: string): Promise<SiyuanDocEntry[]> {
  const data = await siyuanApi<{ files: SiyuanDocEntry[] }>("filetree/listDocsByPath", { notebook: notebookId, path });
  return data.files ?? [];
}

export async function getSiyuanDocMarkdown(docId: string): Promise<{ hPath: string; content: string }> {
  return await siyuanApi<{ hPath: string; content: string }>("export/exportMdContent", { id: docId });
}

export interface SiyuanBlockEntry {
  id: string;
  content: string;
  type: string;
  subtype: string;
}

/** 文档直属块列表（blocks 表 parent_id = docId，3.8.8 实证） */
export async function listSiyuanBlocks(docId: string): Promise<SiyuanBlockEntry[]> {
  const stmt = `SELECT id, content, type, subtype FROM blocks WHERE parent_id = "${docId}" ORDER BY sort LIMIT 200`;
  const data = await siyuanApi<SiyuanBlockEntry[]>("query/sql", { stmt });
  return data ?? [];
}

/** 文档选择结果（资料导入 / 知识点绑定共用） */
export interface SiyuanDocSelection {
  docId: string;
  docName: string;
  /** 文档 markdown（已去 front-matter）；知识点绑定场景不使用 */
  markdown?: string;
  /** null/缺省 = 文档级绑定 */
  blockId: string | null;
  /** 展示名（文档级=文档名；块级=文档名 › 块预览） */
  label: string;
}

// ===== 在主工作区打开思源文档 =====
// 3.8.8 无 HTTP 打开接口，前端也不消费 URL hash（已实证）。
// 方案：钩取宿主应用的 webpack 运行时，取内部 openFileById({app,id}) 直接调用。
// 模块 ID 89925 为 3.8.8 的 openFileById 定义模块；其他版本回退扫描模块工厂源码。

interface WebpackRequireFn {
  (id: string): unknown;
  m?: Record<string, unknown>;
}

interface OpenFileByIdParams {
  app: unknown;
  id: string;
  action?: string[];
}

function hasWebpackChunk(w: Window): boolean {
  return Array.isArray((w as unknown as Record<string, unknown>).webpackChunkSiYuan);
}

/** 插件 UI 与主窗口可能同源同窗口，也可能在 iframe 内，两种都取宿主 */
function getHostWindow(): Window | null {
  if (hasWebpackChunk(window)) return window;
  try {
    const parent = window.parent;
    if (parent && parent !== window && hasWebpackChunk(parent)) return parent;
  } catch {
    // 跨域（理论上不存在，插件与内核同源）
  }
  return null;
}

function getWebpackRequire(host: Window): WebpackRequireFn | null {
  const hostRec = host as unknown as Record<string, unknown>;
  const cached = hostRec.__aiStudySyRequire;
  if (typeof cached === "function") return cached as WebpackRequireFn;
  const chunk = hostRec.webpackChunkSiYuan;
  if (!Array.isArray(chunk)) return null;
  let req: WebpackRequireFn | null = null;
  try {
    (chunk as unknown[]).push([
      ["__ai_study_probe"],
      {},
      (r: unknown) => {
        if (typeof r === "function") req = r as WebpackRequireFn;
      },
    ]);
  } catch {
    return null;
  }
  if (req) hostRec.__aiStudySyRequire = req;
  return req;
}

interface SiyuanGlobalState {
  siyuan?: { ws?: { app?: unknown } };
}

const OPEN_FILE_EXPORT_RE = /openFileById\s*:\s*(\(\)\s*=>|function)/;

function findOpenFileById(req: WebpackRequireFn): ((p: OpenFileByIdParams) => Promise<unknown>) | null {
  const tryId = (id: string): ((p: OpenFileByIdParams) => Promise<unknown>) | null => {
    try {
      const exp = req(id) as Record<string, unknown> | null;
      if (exp && typeof exp.openFileById === "function") {
        return exp.openFileById as (p: OpenFileByIdParams) => Promise<unknown>;
      }
    } catch {
      // 模块不存在或依赖缺失，继续
    }
    return null;
  };
  const known = tryId("89925");
  if (known) return known;
  const m = req.m;
  if (m) {
    for (const id of Object.keys(m)) {
      let src = "";
      try {
        src = String(m[id]);
      } catch {
        continue;
      }
      if (src.length > 300000 || !OPEN_FILE_EXPORT_RE.test(src)) continue;
      const found = tryId(id);
      if (found) return found;
    }
  }
  return null;
}

/** 在思源主工作区打开指定文档（当前标签页激活） */
export async function openSiyuanDoc(docId: string): Promise<void> {
  const host = getHostWindow();
  if (!host) throw new Error("无法访问思源主窗口");
  const req = getWebpackRequire(host);
  if (!req) throw new Error("无法访问思源内部模块（版本不支持）");
  const openFileById = findOpenFileById(req);
  if (!openFileById) throw new Error("未找到思源打开文档函数（版本不支持）");
  const app = (host as unknown as SiyuanGlobalState).siyuan?.ws?.app;
  if (!app) throw new Error("无法获取思源工作空间对象");
  await openFileById({ app, id: docId, action: ["cb-get-focus", "cb-get-scroll"] });
}

// 上传文件到思源资源目录，返回 asset 路径（用于重新解析）
export async function uploadAsset(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file[]", file);
  const res = await fetch("/api/asset/upload", { method: "POST", body: formData });
  const json = (await res.json()) as { code: number; data?: { succMap?: Record<string, string> | null } };
  const path = Object.values(json?.data?.succMap ?? {})[0] ?? "";
  if (!path) throw new Error("上传资源文件失败");
  return path;
}



export async function deleteMaterial(id: number): Promise<void> {
  const data = await getData();
  const material = data.materials.find((m) => m.id === id);
  data.materials = data.materials.filter((m) => m.id !== id);
  // 级联清理资料-章节关联与知识点的来源资料引用，避免悬挂引用
  data.materialChapters = data.materialChapters.filter((mc) => mc.materialId !== id);
  const removedMaterialIds = new Set([id]);
  for (const k of data.knowledgePoints) {
    k.sourceAssetIds = removeCsvIds(k.sourceAssetIds, removedMaterialIds);
  }
  await saveData(data);
  if (material?.siyuanDocId) {
    removeSiyuanDoc(material.siyuanDocId).catch((e) => console.error("删除思源文档失败:", e));
  }
  if (material?.assetPath) {
    await removeAssetIfUnused(material.assetPath, data.materials);
  }
}

export async function queryMaterials(courseId: number): Promise<Material[]> {
  const data = await getData();
  // 按名称自然排序（数字感知），保证资料顺序稳定、目录识别按资料顺序
  return data.materials
    .filter((m) => m.courseId === courseId)
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true }));
}

// ===== AI 知识点抽取 =====
export interface ExtractKpResult {
  newCount: number;
  updateCount: number;
  duplicateCount: number;
  totalChunks: number;
  errors: string[];
}

interface AiKpItem {
  name: string;
  description: string;
  /** 该知识点所属小节标题（模型按原文照抄），用于挂到具体节 */
  section: string;
}

function parseAiKpResponse(content: string): AiKpItem[] {
  // 尝试从 LLM 返回中提取 JSON 数组（可能包裹在代码块或含前后文字）
  const trimmed = content.trim();
  const jsonMatch =
    trimmed.match(/```(?:json)?\s*([\s\S]*?)```/) ||
    trimmed.match(/(\[[\s\S]*\])/);
  const candidate = (jsonMatch ? jsonMatch[1] : trimmed).trim();
  try {
    const parsed = JSON.parse(candidate);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((it): it is { name: string; description: string; section?: string } =>
          it && typeof it.name === "string" && typeof it.description === "string")
        .map((it) => ({ name: it.name, description: it.description, section: it.section ?? "" }));
    }
  } catch {
    // ignore
  }
  return [];
}

// 归一化知识点名：小写、去掉空白与标点，用于本地去重
function normalizeKpName(s: string): string {
  return s.toLowerCase().replace(/[\s、，。；：（）()【】\[\]'"“”‘’·\-—/\\,.]/g, "");
}

// 归一化章节引用：在去空白标点的基础上，再剥掉开头的编号前缀（如「第一章」「1.2」「第3节」）
function normalizeChapterRef(s: string): string {
  const n = normalizeKpName(s);
  return n.replace(/^(第[0-9一二三四五六七八九十百零两]+[章节部分讲单元]|[0-9]+(\.[0-9]+)*[、.]?)+/, "");
}

/** 按标题找章节：归一化后精确匹配优先；否则双向包含（短侧 ≥2 字）且取章节名最长者，避免「函数的导数」误挂到「函数」 */
function findChapterByTitle(chapters: Chapter[], title: string): Chapter | undefined {
  const t = normalizeChapterRef(title);
  if (!t) return undefined;
  const exact = chapters.find((c) => normalizeChapterRef(c.name) === t);
  if (exact) return exact;
  let best: Chapter | undefined;
  for (const c of chapters) {
    const cn = normalizeChapterRef(c.name);
    if (!cn || cn.length < 2) continue;
    const hit = cn.includes(t) || t.includes(cn);
    if (hit && (!best || cn.length > normalizeChapterRef(best.name).length)) best = c;
  }
  return best;
}

// 本地判断两个知识点名是否重复（精确/归一化后相同，或相互包含）
function isDuplicateKpName(a: string, b: string): boolean {
  const na = normalizeKpName(a);
  const nb = normalizeKpName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 2 && nb.length >= 2 && (na.includes(nb) || nb.includes(na))) return true;
  return false;
}

/** 模型选择三级回退：课程指定（courseId 给定且已设置）→ 任务级绑定 → 全局默认 */
export function findTaskBinding(
  data: AppData,
  taskKey: string,
  courseId?: number,
): { providerId: number; modelId: string } | null {
  let modelId: number | null = null;
  if (courseId != null) {
    modelId = data.courses.find((c) => c.id === courseId)?.modelId ?? null;
  }
  if (!modelId) {
    modelId = data.taskModels.find((t) => t.taskKey === taskKey)?.modelId ?? null;
  }
  if (!modelId) {
    modelId = data.taskModels.find((t) => t.taskKey === GLOBAL_DEFAULT_KEY)?.modelId ?? null;
  }
  if (!modelId) {
    return null;
  }
  const model = data.models.find((m) => m.id === modelId);
  if (!model) {
    return null;
  }
  const provider = data.providers.find((p) => p.id === model.providerId);
  if (!provider || !provider.enabled) {
    return null;
  }
  return { providerId: provider.id, modelId: model.modelId };
}

// 并发锁：模块级状态不受组件卸载/重挂载影响，防止同一资料被两个抽取循环并发处理
const extractingMaterialIds = new Set<number>();
let fullExtractInProgress = false;

export function isExtractingMaterial(materialId: number): boolean {
  return extractingMaterialIds.has(materialId);
}

export function isFullExtracting(): boolean {
  return fullExtractInProgress;
}

/** 尝试进入全量重抽；任一抽取进行中则拒绝（返回 false） */
export function beginFullExtract(): boolean {
  if (fullExtractInProgress || extractingMaterialIds.size > 0) return false;
  fullExtractInProgress = true;
  return true;
}

export function endFullExtract(): void {
  fullExtractInProgress = false;
}

export async function extractKnowledgePoints(
  materialId: number,
  options?: {
    taskKey?: string;
    /** 取消信号：返回 true 时停止后续块（已完成块的结果保留） */
    isAborted?: () => boolean;
    onProgress?: (current: number, total: number, blockTitle: string) => void;
  },
): Promise<ExtractKpResult> {
  if (extractingMaterialIds.has(materialId)) {
    throw new Error("该资料正在抽取中，请等待本次抽取完成");
  }
  const data: AppData = await getData();
  const material = data.materials.find((m) => m.id === materialId);
  if (!material) {
    throw new Error("资料不存在");
  }
  const taskKey = options?.taskKey ?? "extract_kp";
  const binding = findTaskBinding(data, taskKey, material.courseId);
  if (!binding) {
    throw new Error(
      "未配置 AI 任务模型，请前往「模型配置 → AI 任务模型分配」设置「" + taskKey + "」任务或「全局默认模型」",
    );
  }
  extractingMaterialIds.add(materialId);
  try {
    return await extractKnowledgePointsInner(material, taskKey, binding, options);
  } finally {
    extractingMaterialIds.delete(materialId);
  }
}

async function extractKnowledgePointsInner(
  material: Material,
  taskKey: string,
  binding: { providerId: number; modelId: string },
  options?: {
    taskKey?: string;
    isAborted?: () => boolean;
    onProgress?: (current: number, total: number, blockTitle: string) => void;
  },
): Promise<ExtractKpResult> {
  const data: AppData = await getData();

  const { chunkText, chunkByMarkdownHeadings, chunkByChapters } = await import("../utils/textChunker");
  // 优先按章切块（模型一次看到完整一章含节结构）；无章级标题时回退按节切分，再回退固定字符分块
  const chapterChunks = chunkByChapters(material.contentText);
  const headingChunks = chapterChunks.length >= 2 ? chapterChunks : chunkByMarkdownHeadings(material.contentText);
  const rawBlocks: Array<{ title: string; text: string }> =
    headingChunks.length >= 2
      ? headingChunks.map((c) => ({ title: c.title, text: c.content }))
      : chunkText(material.contentText, 2000).map((t) => ({ title: "", text: t }));
  // 单章超长（>30K 字）时再切分，避免超出模型有效上下文
  const MAX_BLOCK_CHARS = 30000;
  const blocks: Array<{ title: string; text: string }> = [];
  for (const b of rawBlocks) {
    if (b.text.length <= MAX_BLOCK_CHARS) {
      blocks.push(b);
      continue;
    }
    const parts = chunkText(b.text, MAX_BLOCK_CHARS);
    parts.forEach((p, i) => blocks.push({ title: b.title ? `${b.title}（${i + 1}/${parts.length}）` : "", text: p }));
  }
  const existingKps: KnowledgePoint[] = data.knowledgePoints.filter((k) => k.courseId === material.courseId);
  // 课程上下文：目录 + 已有知识点名（供提示词对齐术语、去重）
  const course = data.courses.find((c) => c.id === material.courseId);
  const courseChapters = data.chapters
    .filter((c) => c.courseId === material.courseId)
    .sort((a, b) => a.sort - b.sort);
  const tocLines = courseChapters
    .filter((ch) => ch.level === "chapter" || ch.parentId === null)
    .map((ch) => {
      const units = courseChapters
        .filter((c) => c.level === "unit" && c.parentId === ch.id)
        .map((u) => `  ${u.name}`)
        .join("\n");
      return ch.name + (units ? "\n" + units : "");
    })
    .join("\n");
  // 每块调用前刷新：同批先抽的块产出的 KP 也要进入后续块的上下文
  const buildKpNames = () => {
    const names = existingKps.map((k) => k.name);
    return names.length ? names.join("、") : "（暂无）";
  };

  let newCount = 0;
  let duplicateCount = 0;
  const errors: string[] = [];

  for (let i = 0; i < blocks.length; i++) {
    if (options?.isAborted?.()) break;
    const block = blocks[i];
    // 每块 AI 调用前回调进度（供 UI 实时显示第 X/N 块）
    options?.onProgress?.(i + 1, blocks.length, block.title);
    // 根据块的章节标题查找已建立的章节（去编号 + 归一化 + 包含匹配），用于绑定知识点归属
    const blockChapter = block.title
      ? findChapterByTitle(
          data.chapters.filter((c) => c.courseId === material.courseId),
          block.title,
        )
      : undefined;
    // 该章下的小节列表：模型返回的 section 标题匹配到具体节后，知识点挂到节而非章
    const blockUnits = blockChapter
      ? data.chapters.filter((c) => c.level === "unit" && c.parentId === blockChapter.id)
      : [];
    const locator = block.title ? `章节：${block.title}` : `文本片段（第${i + 1}/${blocks.length}块）`;
    try {
      const extractVars = {
        locator,
        blockText: block.text,
        courseName: course?.name ?? "",
        tocLines: tocLines || "（暂无目录）",
        existingKpNames: buildKpNames(),
      };
      const extractTpl = resolvePromptTemplate(data, taskKey);
      const res = await window.siyuanAiStudy.callAi({
        providerId: binding.providerId,
        modelId: binding.modelId,
        taskKey,
        messages: [
          { role: "system", content: renderPrompt(extractTpl.system, extractVars) },
          { role: "user", content: renderPrompt(extractTpl.user, extractVars) },
        ],
      });
      const items = parseAiKpResponse(res.content);
      for (const item of items) {
        const trimmedName = item.name.trim();
        if (!trimmedName) continue;
        const existing: KnowledgePoint | undefined = existingKps.find(
          (k) => isDuplicateKpName(k.name, trimmedName),
        );
        if (existing) {
          duplicateCount++;
          // 合并来源资料，让知识点反映覆盖它的全部资料
          const srcIds = existing.sourceAssetIds.split(",").map((s) => s.trim()).filter(Boolean);
            if (!srcIds.includes(String(material.id))) {
              existing.sourceAssetIds = [...srcIds, String(material.id)].join(",");
            }
        } else {
          // section 标题匹配到具体小节则挂到节，否则回退挂章
          const matchedUnit =
            item.section && blockUnits.length > 0
              ? findChapterByTitle(blockUnits, item.section)
              : undefined;
          const kpNode = matchedUnit ?? blockChapter;
          const newKp: KnowledgePoint = {
            id: data.knowledgePoints.reduce((m, k) => Math.max(m, k.id), 0) + 1,
            courseId: material.courseId,
            chapterId: kpNode?.id ?? null,
            blockId: null,
            name: trimmedName,
            content: item.description,
            mastery: "unlearn",
            sourceAssetIds: String(material.id),
            prevKpIds: "",
            chapterName: matchedUnit ? matchedUnit.name : block.title,
            sort: 0,
            createTime: new Date().toISOString(),
          };
          data.knowledgePoints.push(newKp);
          // 加入快照，确保同批后续同名知识点去重
          existingKps.push(newKp);
          newCount++;
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`第 ${i + 1} 块失败：${msg}`);
    }
  }

  await saveData(data);
  return { newCount, updateCount: 0, duplicateCount, totalChunks: blocks.length, errors };
}

// ===== 知识点抽取后台任务（与 AI 梳理同机制：铃铛通知 + 可取消 + 不受组件卸载影响） =====
const extractAbortFlags = new Map<number, { aborted: boolean }>();

export function startExtractTask(materialId: number, courseId: number): void {
  if (extractingMaterialIds.has(materialId)) return;
  const flag = { aborted: false };
  extractAbortFlags.set(materialId, flag);
  void runExtractTask(materialId, courseId, flag);
}

export function cancelExtractTask(materialId: number): void {
  const flag = extractAbortFlags.get(materialId);
  if (flag) flag.aborted = true;
}

async function runExtractTask(
  materialId: number,
  courseId: number,
  flag: { aborted: boolean },
): Promise<void> {
  const notify = useNotifyStore();
  const extractTaskId = materialTaskId(materialId, "extract");
  try {
    const data = await getData();
    const material = data.materials.find((m) => m.id === materialId);
    if (!material) throw new Error("资料不存在或已删除");
    notify.upsertTask({
      taskId: extractTaskId,
      label: material.name,
      materialId,
      courseId,
      taskType: "extract",
      status: "running",
      done: 0,
      total: 0,
      message: "准备中…",
      unread: false,
      startedAt: now(),
      finishedAt: null,
    });
    const result = await extractKnowledgePoints(materialId, {
      isAborted: () => flag.aborted,
      onProgress: (current, total, blockTitle) => {
        if (total > 0) {
          notify.patchTask(extractTaskId, {
            done: current,
            total,
            message: `知识点抽取：第 ${current}/${total} 块${blockTitle ? " · " + blockTitle : ""}`,
          });
        }
      },
    });
    if (flag.aborted) {
      notify.patchTask(extractTaskId, { status: "canceled", unread: true, finishedAt: now(), message: "任务已取消" });
      return;
    }
    let msg = `抽取完成：新增 ${result.newCount} 个知识点，合并重复 ${result.duplicateCount} 个`;
    if (result.errors.length > 0) msg += `；${result.errors.length} 块失败（${result.errors[0]}）`;
    notify.patchTask(extractTaskId, { status: "done", unread: true, finishedAt: now(), message: msg });
  } catch (e) {
    notify.patchTask(extractTaskId, {
      status: "failed",
      unread: true,
      finishedAt: now(),
      message: e instanceof Error ? e.message : String(e),
    });
  } finally {
    extractAbortFlags.delete(materialId);
  }
}

/** 标签输入解析：中英文逗号/分号分隔，去空白去重 */
export function parseTagsInput(input: string): string[] {
  return [...new Set(input.split(/[,，;；]/).map((t) => t.trim()).filter(Boolean))];
}

// ===== 知识点 CRUD =====
export async function queryKnowledgePoints(courseId: number): Promise<KnowledgePoint[]> {
  const data = await getData();
  return data.knowledgePoints.filter((k) => k.courseId === courseId);
}

export async function updateKnowledgePoint(kp: KnowledgePoint): Promise<void> {
  const data = await getData();
  const idx = data.knowledgePoints.findIndex((k) => k.id === kp.id);
  if (idx >= 0) {
    data.knowledgePoints[idx] = kp;
    await saveData(data);
  }
}

export async function deleteKnowledgePoint(id: number): Promise<void> {
  await deleteKnowledgePoints([id]);
}

/** 批量删除知识点（级联清理复习触点、讲解记录与前置引用） */
export async function deleteKnowledgePoints(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const data = await getData();
  const removed = new Set(ids);
  data.knowledgePoints = data.knowledgePoints.filter((k) => !removed.has(k.id));
  // 级联清理复习触点与讲解记录，避免悬挂引用
  data.reviewSchedules = data.reviewSchedules.filter((s) => s.kpId === null || !removed.has(s.kpId));
  data.explainRecords = data.explainRecords.filter((r) => r.kpId === null || !removed.has(r.kpId));
  // 级联删除闪卡（绑定被删知识点）及其复习触点
  const removedCardIds = new Set(data.flashCards.filter((c) => removed.has(c.kpId)).map((c) => c.id));
  data.flashCards = data.flashCards.filter((c) => !removed.has(c.kpId));
  data.reviewSchedules = data.reviewSchedules.filter((s) => s.cardId == null || !removedCardIds.has(s.cardId));
  // 题目保留，仅从 kpIds 中移除被删知识点
  for (const q of data.questions) {
    q.kpIds = removeCsvIds(q.kpIds, removed);
  }
  // 计划任务命中被删知识点直接删除；studyLogs 保留历史不清理
  data.studyTasks = data.studyTasks.filter((t) => t.kpId === null || !removed.has(t.kpId));
  // 从其他知识点的前置列表中移除被删知识点
  for (const k of data.knowledgePoints) {
    const parts = k.prevKpIds.split(",").map((s) => s.trim()).filter(Boolean);
    const kept = parts.filter((s) => !removed.has(Number(s)));
    if (kept.length !== parts.length) {
      k.prevKpIds = kept.join(",");
    }
  }
  await saveData(data);
}

export async function queryChapters(courseId: number): Promise<Chapter[]> {
  const data = await getData();
  return data.chapters.filter((c) => c.courseId === courseId);
}

export async function createChapter(input: {
  courseId: number;
  name: string;
  parentId: number | null;
  level: Chapter["level"];
}): Promise<Chapter> {
  const data = await getData();
  const course = data.courses.find((c) => c.id === input.courseId);
  const name = input.name.trim();
  const dup = data.chapters.find((c) => c.courseId === input.courseId && c.name === name);
  if (dup) {
    throw new Error(`已存在同名章节「${name}」，请换一个名称（知识点按章节名匹配，重名会导致归属混乱）`);
  }
  const parentChapter = input.parentId ? data.chapters.find((c) => c.id === input.parentId) : null;
  // 落库思源：章作为课程文档的子文档，节作为章文档的子文档（path 含文档名）
  const path = parentChapter
    ? `/${course?.name ?? "课程"}/${parentChapter.name}/${name}`
    : `/${course?.name ?? "课程"}/${name}`;
  const docId = await persistDocIfEnabled(`# ${name}`, path);
  const sort =
    data.chapters.filter((c) => c.courseId === input.courseId && c.parentId === input.parentId).reduce((m, c) => Math.max(m, c.sort), 0) + 1;
  const chapter: Chapter = {
    id: nextId(data.chapters),
    courseId: input.courseId,
    parentId: input.parentId,
    siyuanBlockId: docId,
    name,
    level: input.level,
    sort,
  };
  data.chapters.push(chapter);
  await saveData(data);
  return chapter;
}

export interface ChapterTreeNode {
  name: string;
  level: Chapter["level"];
  /** 父章名称（unit 指向 chapter） */
  parentName: string | null;
}

/** 从标题结构批量导入章节树（幂等：同名章节不重复创建）。nodes 需保证父章在子节之前。 */
export async function importChapterTree(
  courseId: number,
  nodes: ChapterTreeNode[],
): Promise<{ created: number; linked: number; stuck: number }> {
  const data = await getData();
  const course = data.courses.find((c) => c.id === courseId);
  const coursePath = `/${course?.name ?? "课程"}`;
  const existing = data.chapters.filter((c) => c.courseId === courseId);
  // 去空白归一化比较：AI 目录矫正可能只改空格/标点（如「第一章X」→「第一章 X」），避免误判为新章节重复建章
  const norm = (s: string) => s.replace(/\s+/g, "");
  let created = 0;
  for (const node of nodes) {
    const name = node.name.trim();
    if (!name) continue;
    const dup = existing.find((c) => norm(c.name) === norm(name));
    if (dup) continue;
    const parent = node.parentName
      ? existing.find((c) => c.level === "chapter" && norm(c.name) === norm(node.parentName!))
      : null;
    const sort =
      data.chapters
        .filter((c) => c.courseId === courseId && c.parentId === (parent?.id ?? null))
        .reduce((m, c) => Math.max(m, c.sort), 0) + 1;
    // 落库思源：章作为课程子文档，节作为父章子文档（path 含文档名）
    const path = parent ? `${coursePath}/${parent.name}/${name}` : `${coursePath}/${name}`;
    const docId = await persistDocIfEnabled(`# ${name}`, path);
    const chapter: Chapter = {
      id: nextId(data.chapters),
      courseId,
      parentId: parent?.id ?? null,
      siyuanBlockId: docId,
      name,
      level: node.level,
      sort,
    };
    data.chapters.push(chapter);
    existing.push(chapter);
    created++;
  }
  // 按 nodes 文档顺序重编号 sort：重复导入时新建行要落回文档序位置，不能全部追加到末尾
  const renumber = (rows: Chapter[], orderedIds: number[]) => {
    const unique = orderedIds.filter((id, i) => orderedIds.indexOf(id) === i);
    const rest = rows
      .filter((c) => !unique.includes(c.id))
      .sort((a, b) => a.sort - b.sort || a.id - b.id)
      .map((c) => c.id);
    unique.concat(rest).forEach((id, i) => {
      const c = data.chapters.find((x) => x.id === id);
      if (c) c.sort = i + 1;
    });
  };
  const chapterRows = existing.filter((c) => c.level === "chapter");
  const topIds = nodes
    .filter((n) => !n.parentName)
    .map((n) => chapterRows.find((c) => norm(c.name) === norm(n.name.trim()))?.id)
    .filter((id): id is number => id != null);
  renumber(existing.filter((c) => c.parentId === null), topIds);
  for (const ch of chapterRows) {
    const unitIds = nodes
      .filter((n) => n.parentName && norm(n.parentName) === norm(ch.name))
      .map((n) => existing.find((c) => c.parentId === ch.id && norm(c.name) === norm(n.name.trim()))?.id)
      .filter((id): id is number => id != null);
    renumber(existing.filter((c) => c.parentId === ch.id), unitIds);
  }
  // 章节后建时，把未绑定的知识点按块标题 / 知识点名重新绑定到章节
  const relink = relinkCourseKps(data, courseId);
  await saveData(data);
  return { created, ...relink };
}

export interface RelinkResult {
  linked: number;
  /** 标题与名称都匹配不上、无法自动挂钩的数量（含无标题信息的知识点） */
  stuck: number;
}

/** 为单个未分配知识点找章节：先按块标题宽松匹配，再按知识点名归一化精确匹配（精确匹配防误挂） */
function matchChapterForKp(kp: KnowledgePoint, chapters: Chapter[]): Chapter | undefined {
  if (kp.chapterName) {
    const byTitle = findChapterByTitle(chapters, kp.chapterName);
    if (byTitle) return byTitle;
  }
  const name = normalizeChapterRef(kp.name);
  if (name.length >= 2) {
    const byName = chapters.find((c) => normalizeChapterRef(c.name) === name);
    if (byName) return byName;
  }
  return undefined;
}

function relinkCourseKps(data: AppData, courseId: number): RelinkResult {
  const courseChapters = data.chapters.filter((c) => c.courseId === courseId);
  let linked = 0;
  let stuck = 0;
  for (const kp of data.knowledgePoints) {
    if (kp.courseId !== courseId || kp.chapterId !== null) continue;
    const ch = matchChapterForKp(kp, courseChapters);
    if (ch) {
      kp.chapterId = ch.id;
      linked++;
    } else {
      stuck++;
    }
  }
  return { linked, stuck };
}

/** 将课程内未分配章节的知识点重新匹配绑定（章节后建/改名后使用），返回绑定数与无法自动挂钩数 */
export async function relinkUnassignedKps(courseId: number): Promise<RelinkResult> {
  const data = await getData();
  const result = relinkCourseKps(data, courseId);
  if (result.linked > 0) {
    await saveData(data);
  }
  return result;
}

/**
 * AI 矫正自动识别的标题列表（去噪 / 合并重复 / 修正层级），在目录预览前可选调用。
 * 未配置「recognize_toc」任务模型时原样返回；调用或解析失败时回退原列表（failed=true 供 UI 提示）。
 */
export async function correctTocWithAi(
  headings: ParsedHeading[],
  courseId?: number,
): Promise<{ headings: ParsedHeading[]; corrected: boolean; failed: boolean }> {
  if (headings.length === 0) return { headings, corrected: false, failed: false };
  const data = await getData();
  const binding = findTaskBinding(data, "recognize_toc", courseId);
  if (!binding) return { headings, corrected: false, failed: false };
  try {
    const lines = headings.map((h, i) => `${i + 1}. [L${h.level}] ${h.text}`).join("\n");
    const tocVars = { lines };
    const tocTpl = resolvePromptTemplate(data, "recognize_toc");
    const res = await window.siyuanAiStudy.callAi({
      providerId: binding.providerId,
      modelId: binding.modelId,
      taskKey: "recognize_toc",
      messages: [
        { role: "system", content: renderPrompt(tocTpl.system, tocVars) },
        { role: "user", content: renderPrompt(tocTpl.user, tocVars) },
      ],
    });
    const trimmed = res.content.trim();
    const jsonMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/) || trimmed.match(/(\[[\s\S]*\])/);
    const candidate = (jsonMatch ? jsonMatch[1] : trimmed).trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      return { headings, corrected: false, failed: true };
    }
    if (!Array.isArray(parsed)) return { headings, corrected: false, failed: true };
    const corrected: ParsedHeading[] = [];
    for (const it of parsed) {
      const rec = (it ?? {}) as { text?: unknown; level?: unknown };
      const text = typeof rec.text === "string" ? rec.text.trim() : "";
      const level = Number(rec.level);
      if (!text || text.length > 60 || (level !== 1 && level !== 2)) continue;
      corrected.push({ level, text });
    }
    return corrected.length > 0 ? { headings: corrected, corrected: true, failed: false } : { headings, corrected: false, failed: true };
  } catch (e) {
    console.error("AI 目录矫正失败:", e);
    return { headings, corrected: false, failed: true };
  }
}

export async function updateChapter(chapter: Chapter): Promise<void> {
  const data = await getData();
  const idx = data.chapters.findIndex((c) => c.id === chapter.id);
  if (idx >= 0) {
    const old = data.chapters[idx];
    data.chapters[idx] = chapter;
    await saveData(data);
    // 落库思源：改名时同步章节文档名（失败不阻塞主流程）
    if (chapter.name !== old.name && old.siyuanBlockId && isSiyuanDocId(old.siyuanBlockId)) {
      try {
        await window.siyuanAiStudy.renameSiyuanDoc(old.siyuanBlockId, chapter.name);
      } catch (e) {
        console.error("同步章节名到思源失败:", e);
      }
    }
  }
}

/** 批量应用章节 sort/parentId 变更（拖拽排序），单次保存 */
export async function applyChapterMoves(moves: Array<{ id: number; parentId: number | null; sort: number }>): Promise<void> {
  const data = await getData();
  for (const mv of moves) {
    const idx = data.chapters.findIndex((c) => c.id === mv.id);
    if (idx >= 0) {
      data.chapters[idx] = { ...data.chapters[idx], parentId: mv.parentId, sort: mv.sort };
    }
  }
  await saveData(data);
}

/** 批量应用知识点 sort（拖拽换序），单次保存 */
export async function applyKnowledgePointSort(items: Array<{ id: number; sort: number }>): Promise<void> {
  const data = await getData();
  const map = new Map(items.map((it) => [it.id, it.sort]));
  for (const kp of data.knowledgePoints) {
    const s = map.get(kp.id);
    if (s !== undefined) {
      kp.sort = s;
    }
  }
  await saveData(data);
}

export async function deleteChapter(id: number): Promise<void> {
  await deleteChapters([id]);
}

/** 批量删除章节（级联删除子孙章节与思源文档，知识点归属刷新为未分配） */
export async function deleteChapters(ids: number[]): Promise<void> {
  const data = await getData();
  // 收集自身及所有子孙章节 id
  const removed = new Set<number>(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of data.chapters) {
      if (c.parentId !== null && removed.has(c.parentId) && !removed.has(c.id)) {
        removed.add(c.id);
        grew = true;
      }
    }
  }
  // 级联删除思源文档
  for (const c of data.chapters) {
    if (removed.has(c.id) && c.siyuanBlockId) {
      removeSiyuanDoc(c.siyuanBlockId).catch((e) => console.error("删除思源章节文档失败:", e));
    }
  }
  data.chapters = data.chapters.filter((c) => !removed.has(c.id));
  // 章末测评（test）任务命中被删章节直接删除：chapterId 置 null 会被当成结业模考入口
  data.studyTasks = data.studyTasks.filter(
    (t) => !(t.taskType === "test" && t.chapterId !== null && removed.has(t.chapterId)),
  );
  // 其他类型任务命中被删章节：章节引用置 null，任务保留
  for (const t of data.studyTasks) {
    if (t.chapterId !== null && removed.has(t.chapterId)) t.chapterId = null;
  }
  // 清理资料-章节关联
  data.materialChapters = data.materialChapters.filter((mc) => !removed.has(mc.chapterId));
  // 引用被删章节的知识点归属刷新为未分配
  for (const kp of data.knowledgePoints) {
    if (kp.chapterId !== null && removed.has(kp.chapterId)) {
      kp.chapterId = null;
    }
  }
  await saveData(data);
}

// ===== SM2 间隔复习 =====
export type ReviewGrade = "forgotten" | "vague" | "solid";

/** 自研 SM2：评分档位映射质量分 n（0 忘了 / 3 模糊 / 5 牢固） */
const REVIEW_GRADE_TO_N: Record<ReviewGrade, number> = { forgotten: 0, vague: 3, solid: 5 };

/** 按本地时区格式化为 YYYY-MM-DD，避免 toISOString 的 UTC 偏移导致跨时区错一天 */
export function formatLocalDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function reviewNextDue(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + Math.max(1, days));
  return formatLocalDate(d);
}

function ensureReviewTouchpointInData(data: AppData, kpId: number): void {
  const existing = data.reviewSchedules.find((s) => s.kpId === kpId);
  if (existing) {
    if (existing.dueTime < reviewNextDue(0)) return; // 未到期触点保持既有节奏
    existing.dueTime = reviewNextDue(1);
    existing.stage = 1;
    existing.intervalDays = 1;
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

function ensureQuestionReviewInData(data: AppData, qId: number): void {
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
  const n = REVIEW_GRADE_TO_N[grade];

  if (n === 0) {
    target.stage = 1;
    target.intervalDays = 1;
    target.easeFactor = Math.max(1.3, target.easeFactor - 0.2);
  } else {
    target.easeFactor = Math.min(
      2.8,
      Math.max(1.3, target.easeFactor + (0.1 - (5 - n) * (0.08 + (5 - n) * 0.02))),
    );
    target.intervalDays = target.stage === 1 ? 1 : Math.round(target.intervalDays * target.easeFactor);
    target.stage = Math.min(8, target.stage + 1);
  }
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

// ===== 闪卡（T3.4）：双面卡 + 复用 SM2 调度 =====
export async function queryFlashCards(courseId: number): Promise<FlashCard[]> {
  const data = await getData();
  return data.flashCards.filter((c) => c.courseId === courseId);
}

/** 当前课程今日到期的闪卡触点数（侧栏角标用） */
export async function queryDueFlashcardCount(courseId: number): Promise<number> {
  const data = await getData();
  const today = formatLocalDate();
  const cardIds = new Set(data.flashCards.filter((c) => c.courseId === courseId).map((c) => c.id));
  if (cardIds.size === 0) return 0;
  return data.reviewSchedules.filter((s) => isReviewScheduleDue(s, today, new Set(), new Set(), cardIds)).length;
}

/** 闪卡触点：首建/重置排明天；已到期触点保持既有节奏 */
function ensureCardReviewInData(data: AppData, cardId: number): void {
  const existing = data.reviewSchedules.find((s) => s.cardId !== undefined && s.cardId === cardId);
  if (existing) {
    if (existing.dueTime < reviewNextDue(0)) return;
    existing.dueTime = reviewNextDue(1);
    existing.stage = 1;
    existing.intervalDays = 1;
    return;
  }
  data.reviewSchedules.push({
    id: nextId(data.reviewSchedules),
    kpId: null,
    qId: null,
    cardId,
    stage: 1,
    dueTime: reviewNextDue(1),
    easeFactor: 2.5,
    intervalDays: 1,
    lastReviewTime: null,
    reviewTimes: 0,
  });
}

export async function createFlashCard(input: {
  courseId: number;
  kpId: number;
  front: string;
  back: string;
}): Promise<FlashCard> {
  const data = await getData();
  const kp = data.knowledgePoints.find((k) => k.id === input.kpId && k.courseId === input.courseId);
  if (!kp) throw new Error("知识点不存在或不属于本课程");
  const front = input.front.trim();
  const back = input.back.trim();
  if (!front) throw new Error("卡片正面（问题）不能为空");
  if (!back) throw new Error("卡片背面（答案要点）不能为空");
  const card: FlashCard = {
    id: nextId(data.flashCards),
    courseId: input.courseId,
    kpId: input.kpId,
    front,
    back,
    source: "manual",
    createTime: now(),
  };
  data.flashCards.push(card);
  ensureCardReviewInData(data, card.id);
  await saveData(data);
  return card;
}

export async function updateFlashCard(
  id: number,
  input: { kpId?: number; front?: string; back?: string },
): Promise<FlashCard> {
  const data = await getData();
  const card = data.flashCards.find((c) => c.id === id);
  if (!card) throw new Error("闪卡不存在，可能已被删除");
  if (input.kpId !== undefined && input.kpId !== card.kpId) {
    const kp = data.knowledgePoints.find((k) => k.id === input.kpId && k.courseId === card.courseId);
    if (!kp) throw new Error("知识点不存在或不属于本课程");
    card.kpId = input.kpId;
  }
  if (input.front !== undefined) {
    const front = input.front.trim();
    if (!front) throw new Error("卡片正面（问题）不能为空");
    card.front = front;
  }
  if (input.back !== undefined) {
    const back = input.back.trim();
    if (!back) throw new Error("卡片背面（答案要点）不能为空");
    card.back = back;
  }
  card.updateTime = now();
  await saveData(data);
  return card;
}

/** 批量删除闪卡（级联清理其复习触点） */
export async function deleteFlashCards(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const data = await getData();
  const removed = new Set(ids);
  const before = data.flashCards.length;
  data.flashCards = data.flashCards.filter((c) => !removed.has(c.id));
  data.reviewSchedules = data.reviewSchedules.filter((s) => s.cardId == null || !removed.has(s.cardId));
  await saveData(data);
  return before - data.flashCards.length;
}

export interface GenerateFlashcardsResult {
  created: number;
  updated: number;
  /** 已有卡片且未勾选覆盖 */
  skipped: number;
  /** AI 输出中因字段问题被剔除的条目 */
  parseSkipped: number;
  errors: string[];
}

const FLASHCARD_GEN_BATCH = 10;

/**
 * AI 批量生成闪卡：选中知识点每批 10 个调 gen_flashcard 任务，解析结果落库；
 * 解析失败自动重试一次（把原始输出交还模型自纠正，与 gen_question 一致）。
 */
export async function generateFlashcards(
  courseId: number,
  kpIds: number[],
  options: { overwrite?: boolean; onProgress?: (done: number, total: number) => void } = {},
): Promise<GenerateFlashcardsResult> {
  const data = await getData();
  const course = data.courses.find((c) => c.id === courseId);
  if (!course) throw new Error("课程不存在");
  if (kpIds.length === 0) throw new Error("请至少选择一个知识点");
  const binding = findTaskBinding(data, "gen_flashcard", courseId);
  if (!binding) {
    throw new Error(
      "未配置 AI 任务模型，请前往「模型配置 → AI 任务模型分配」设置「gen_flashcard」任务或「全局默认模型」",
    );
  }
  const kps = kpIds
    .map((id) => data.knowledgePoints.find((k) => k.id === id && k.courseId === courseId))
    .filter((k): k is KnowledgePoint => !!k);
  if (kps.length === 0) throw new Error("所选知识点不存在，可能已被删除");
  // 铃铛：分批生成，进度按知识点数
  const notify = useNotifyStore();
  const fcTaskId = courseTaskId(courseId, "gen_flashcard");
  const fcTotal = kps.length;
  notify.upsertTask({
    taskId: fcTaskId,
    label: course.name,
    courseId,
    taskType: "gen_flashcard",
    status: "running",
    done: 0,
    total: fcTotal,
    message: "AI 闪卡生成中…",
    unread: false,
    startedAt: now(),
    finishedAt: null,
  });
  const tpl = resolvePromptTemplate(data, "gen_flashcard");
  const result: GenerateFlashcardsResult = { created: 0, updated: 0, skipped: 0, parseSkipped: 0, errors: [] };
  try {
    const total = kps.length;
    for (let i = 0; i < kps.length; i += FLASHCARD_GEN_BATCH) {
      const batch = kps.slice(i, i + FLASHCARD_GEN_BATCH);
      const kpLines = batch.map((k, idx) => `${idx}. ${k.name}：${truncateText(k.content, 300) || "（暂无描述）"}`).join("\n");
      const baseMessages = [
        { role: "system", content: renderPrompt(tpl.system, { courseName: course.name, kpLines }) },
        { role: "user", content: renderPrompt(tpl.user, { courseName: course.name, kpLines }) },
      ];
      let parsed = parseFlashcardsJson(
        (await window.siyuanAiStudy.callAi({
          providerId: binding.providerId,
          modelId: binding.modelId,
          taskKey: "gen_flashcard",
          messages: baseMessages,
        })).content,
        batch.length,
      );
      if (parsed.items.length === 0) {
        // 重试一次：追加自纠正指令再调一次
        const retryRaw = (await window.siyuanAiStudy.callAi({
          providerId: binding.providerId,
          modelId: binding.modelId,
          taskKey: "gen_flashcard",
          messages: [
            ...baseMessages,
            {
              role: "user",
              content:
                "你上次的输出无法解析为闪卡 JSON。请重新输出：只返回包含 " +
                batch.length +
                " 个元素的 JSON 数组，每项字段为 index（0 起整数，与输入知识点顺序对应）、front（问题）、back（答案要点），不要输出任何其他文字。",
            },
          ],
        })).content;
        const retry = parseFlashcardsJson(retryRaw, batch.length);
        if (retry.items.length > 0 || retry.errors.length === 0) parsed = retry;
      }
      for (const e of parsed.errors) result.errors.push(e);
      result.parseSkipped += parsed.skipped;
      const latest = await getData();
      for (const item of parsed.items) {
        const kp = batch[item.index];
        const prev = latest.flashCards.find((c) => c.courseId === courseId && c.kpId === kp.id);
        if (prev && !options.overwrite) {
          result.skipped++;
          continue;
        }
        if (prev) {
          prev.front = item.front;
          prev.back = item.back;
          prev.source = "ai";
          prev.updateTime = now();
          result.updated++;
        } else {
          const card: FlashCard = {
            id: nextId(latest.flashCards),
            courseId,
            kpId: kp.id,
            front: item.front,
            back: item.back,
            source: "ai",
            createTime: now(),
          };
          latest.flashCards.push(card);
          ensureCardReviewInData(latest, card.id);
          result.created++;
        }
      }
      await saveData(latest);
      const done = Math.min(total, i + FLASHCARD_GEN_BATCH);
      options.onProgress?.(done, total);
      notify.patchTask(fcTaskId, { done, message: `AI 闪卡生成：第 ${done}/${total} 个知识点…` });
    }
    let msg = `生成完成：新增 ${result.created} 张`;
    if (result.updated > 0) msg += `、覆盖 ${result.updated} 张`;
    if (result.skipped > 0) msg += `、跳过已有 ${result.skipped} 张`;
    if (result.parseSkipped > 0) msg += `；${result.parseSkipped} 个知识点输出异常未生成`;
    notify.patchTask(fcTaskId, { status: "done", unread: true, finishedAt: now(), message: msg });
    return result;
  } catch (e) {
    notify.patchTask(fcTaskId, {
      status: "failed",
      unread: true,
      finishedAt: now(),
      message: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

// ===== AI 学习计划生成 =====
// learn 骨架由系统确定性生成（100% 挂 kpId），AI 只负责穿插 review/practice 补充任务
interface AiPlanExtraItem {
  date: string;
  taskType: "review" | "practice";
  kpId: number;
  title: string;
}

interface StudyPlanWithTasks {
  plan: StudyPlan;
  tasks: StudyTask[];
}

function parseAiPlanExtraResponse(content: string): AiPlanExtraItem[] {
  const trimmed = content.trim();
  const jsonMatch =
    trimmed.match(/```(?:json)?\s*([\s\S]*?)```/) ||
    trimmed.match(/(\[[\s\S]*\])/);
  const candidate = (jsonMatch ? jsonMatch[1] : trimmed).trim();
  try {
    const parsed = JSON.parse(candidate);
    if (!Array.isArray(parsed)) return [];
    const valid: AiPlanExtraItem[] = [];
    for (const it of parsed) {
      if (!it || typeof it.date !== "string") continue;
      // 日期必须是合法的 YYYY-MM-DD，否则分组与过期判断会错乱
      if (!/^\d{4}-\d{2}-\d{2}$/.test(it.date) || Number.isNaN(new Date(it.date).getTime())) continue;
      const taskType = it.taskType;
      if (taskType !== "review" && taskType !== "practice") continue;
      const kpId = Number(it.kpId);
      valid.push({
        date: it.date,
        taskType,
        kpId: Number.isFinite(kpId) && kpId > 0 ? kpId : 0,
        title: typeof it.title === "string" ? it.title.trim() : "",
      });
    }
    return valid;
  } catch {
    return [];
  }
}

export async function queryStudyPlans(courseId: number): Promise<StudyPlan[]> {
  const data = await getData();
  return data.studyPlans
    .filter((p) => p.courseId === courseId)
    .sort((a, b) => b.id - a.id);
}

export async function queryStudyTasks(planId: number): Promise<StudyTask[]> {
  const data = await getData();
  return data.studyTasks
    .filter((t) => t.planId === planId)
    .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate) || a.sort - b.sort);
}

export async function updateStudyTask(task: StudyTask): Promise<void> {
  const data = await getData();
  const idx = data.studyTasks.findIndex((t) => t.id === task.id);
  if (idx >= 0) {
    const prev = data.studyTasks[idx];
    data.studyTasks[idx] = task;
    // 手动打卡（todo → done）：记一条 0 秒日志，让打卡动作进入时长趋势
    if (prev.status === "todo" && task.status === "done") {
      const plan = data.studyPlans.find((p) => p.id === task.planId);
      if (plan) {
        logStudyInData(data, { courseId: plan.courseId, kpId: task.kpId, taskId: task.id, action: "task_done", durationSec: 0 });
      }
    }
    await saveData(data);
  }
}

export async function deleteStudyPlan(planId: number): Promise<void> {
  const data = await getData();
  data.studyPlans = data.studyPlans.filter((p) => p.id !== planId);
  data.studyTasks = data.studyTasks.filter((t) => t.planId !== planId);
  await saveData(data);
}

/** 当前课程今天排期的计划任务（含已完成），按 sort 排序；供「开始学习」页今日计划卡；暂停计划不计入 */
export async function queryTodayPlanTasks(courseId: number): Promise<StudyTask[]> {
  const data = await getData();
  const today = formatLocalDate();
  const planIds = new Set(
    data.studyPlans.filter((p) => p.courseId === courseId && p.status !== "paused").map((p) => p.id),
  );
  return data.studyTasks
    .filter((t) => planIds.has(t.planId) && t.scheduledDate === today)
    .sort((a, b) => a.sort - b.sort);
}

// ===== 计划管理（T1.6）=====

/** 日期 + N 天（YYYY-MM-DD） */
function addDaysToDate(date: string, n: number): string {
  const d = new Date(date + "T00:00:00");
  d.setDate(d.getDate() + n);
  return formatLocalDate(d);
}

/** 重排计划内各天的 sort（同日按 id 稳定排序），保证展示顺序不乱 */
function resyncTaskSort(data: AppData, planId: number): void {
  const byDate = new Map<string, StudyTask[]>();
  for (const t of data.studyTasks) {
    if (t.planId !== planId) continue;
    const list = byDate.get(t.scheduledDate) ?? [];
    list.push(t);
    byDate.set(t.scheduledDate, list);
  }
  for (const list of byDate.values()) {
    list.sort((a, b) => a.id - b.id);
    list.forEach((t, i) => (t.sort = i + 1));
  }
}

export async function setPlanStatus(planId: number, status: "active" | "paused"): Promise<StudyPlan> {
  const data = await getData();
  const plan = data.studyPlans.find((p) => p.id === planId);
  if (!plan) throw new Error("计划不存在");
  plan.status = status;
  await saveData(data);
  return { ...plan };
}

/** 延期 N 天：未完成任务 + 起止/目标日期整体 +N 天，已完成任务不动 */
export async function shiftPlan(planId: number, days: number): Promise<{ moved: number }> {
  if (!Number.isInteger(days) || days <= 0) throw new Error("请输入正整数天数");
  const data = await getData();
  const plan = data.studyPlans.find((p) => p.id === planId);
  if (!plan) throw new Error("计划不存在");
  let moved = 0;
  for (const t of data.studyTasks) {
    if (t.planId === planId && t.status === "todo") {
      t.scheduledDate = addDaysToDate(t.scheduledDate, days);
      moved++;
    }
  }
  plan.targetDate = addDaysToDate(plan.targetDate, days);
  if (plan.startDate) plan.startDate = addDaysToDate(plan.startDate, days);
  await saveData(data);
  return { moved };
}

/** 延长 N 天：目标日期 +N，剩余未完成 learn 任务在剩余天数（max(今天,开始日)→新目标日）重铺均分 */
export async function extendPlan(planId: number, days: number): Promise<{ redistributed: number }> {
  if (!Number.isInteger(days) || days <= 0) throw new Error("请输入正整数天数");
  const data = await getData();
  const plan = data.studyPlans.find((p) => p.id === planId);
  if (!plan) throw new Error("计划不存在");
  plan.targetDate = addDaysToDate(plan.targetDate, days);
  const today = formatLocalDate();
  const startRef = plan.startDate && plan.startDate > today ? plan.startDate : today;
  const remainDays = Math.max(1, Math.round((new Date(plan.targetDate).getTime() - new Date(startRef).getTime()) / (24 * 60 * 60 * 1000)) + 1);
  const remaining = data.studyTasks
    .filter((t) => t.planId === planId && t.taskType === "learn" && t.status === "todo")
    .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate) || a.id - b.id);
  if (remaining.length) {
    const perDay = Math.ceil(remaining.length / remainDays);
    for (let i = 0; i < remaining.length; i++) {
      remaining[i].scheduledDate = addDaysToDate(startRef, Math.floor(i / perDay));
    }
  }
  resyncTaskSort(data, planId);
  await saveData(data);
  return { redistributed: remaining.length };
}

/** 顺延过期任务：日期 < 今天且未完成的任务 → 今天；传 taskId 只顺延该条，否则顺延计划内全部过期任务 */
export async function postponeOverdueTasks(planId: number, taskId?: number): Promise<{ moved: number }> {
  const data = await getData();
  const plan = data.studyPlans.find((p) => p.id === planId);
  if (!plan) throw new Error("计划不存在");
  const today = formatLocalDate();
  let moved = 0;
  for (const t of data.studyTasks) {
    if (t.planId !== planId || t.status !== "todo") continue;
    if (t.scheduledDate >= today) continue;
    if (taskId != null && t.id !== taskId) continue;
    t.scheduledDate = today;
    moved++;
  }
  if (moved === 0) throw new Error("没有可顺延的过期任务");
  resyncTaskSort(data, planId);
  await saveData(data);
  return { moved };
}

/** 同步新知识点：计划未覆盖的课程 KP 各加一条 learn 任务，从今天起每天 1 条排到目标日（超出堆末日）；现有任务不动 */
export async function syncPlanKps(planId: number): Promise<{ added: number }> {
  const data = await getData();
  const plan = data.studyPlans.find((p) => p.id === planId);
  if (!plan) throw new Error("计划不存在");
  const covered = new Set(
    data.studyTasks.filter((t) => t.planId === planId && t.taskType === "learn" && t.kpId != null).map((t) => t.kpId),
  );
  const newKps = data.knowledgePoints
    .filter((k) => k.courseId === plan.courseId && !covered.has(k.id))
    .sort((a, b) => (a.chapterId ?? -1) - (b.chapterId ?? -1) || a.sort - b.sort || a.id - b.id);
  if (!newKps.length) return { added: 0 };
  const today = formatLocalDate();
  const startRef = today <= plan.targetDate ? today : plan.targetDate;
  const dayCount = Math.max(1, Math.round((new Date(plan.targetDate).getTime() - new Date(startRef).getTime()) / (24 * 60 * 60 * 1000)) + 1);
  for (let i = 0; i < newKps.length; i++) {
    const kp = newKps[i];
    const date = addDaysToDate(startRef, Math.min(i, dayCount - 1));
    const sort = data.studyTasks.filter((t) => t.planId === planId && t.scheduledDate === date).length + 1;
    data.studyTasks.push({
      id: nextId(data.studyTasks),
      planId,
      chapterId: kp.chapterId,
      kpId: kp.id,
      taskType: "learn",
      title: `学习：${kp.name}`,
      scheduledDate: date,
      status: "todo",
      sort,
    });
  }
  await saveData(data);
  return { added: newKps.length };
}

/**
 * 薄弱知识点 → 在课程最新计划中追加一条 practice/review 任务（排到今天）。
 * 防任务爆炸：同一计划内同知识点同类型 7 天内已追加过则跳过（与完成状态无关）。
 * 课程尚无计划时静默跳过。
 */
function appendWeakPointTaskInData(data: AppData, courseId: number, kpId: number, taskType: "practice" | "review"): void {
  const plan = data.studyPlans.filter((p) => p.courseId === courseId).sort((a, b) => b.id - a.id)[0];
  if (!plan) return;
  const kp = data.knowledgePoints.find((k) => k.id === kpId);
  if (!kp) return;
  const today = formatLocalDate();
  const weekAgoDate = new Date();
  weekAgoDate.setDate(weekAgoDate.getDate() - 6);
  const weekAgo = formatLocalDate(weekAgoDate);
  const exists = data.studyTasks.some(
    (t) => t.planId === plan.id && (t.kpId ?? null) === kpId && t.taskType === taskType && t.scheduledDate >= weekAgo,
  );
  if (exists) return;
  const dayCount = data.studyTasks.filter((t) => t.planId === plan.id && t.scheduledDate === today).length;
  data.studyTasks.push({
    id: nextId(data.studyTasks),
    planId: plan.id,
    chapterId: kp.chapterId,
    kpId,
    taskType,
    title: `${taskType === "practice" ? "薄弱练习" : "薄弱复习"}：${kp.name}`,
    scheduledDate: today,
    status: "todo",
    sort: dayCount + 1,
  });
}

/**
 * 严格打勾：勾选该知识点「今天排期 + 未完成 + 类型匹配」的计划任务，返回勾掉的任务标题。
 * 达标动作（讲解≥60/答对/复习牢固）在对应写入点调用；手动勾选保留兜底。
 */
/** 写入学习时长日志（duration 单位秒；手动打卡等无计时动作传 0，只计动作） */
function logStudyInData(
  data: AppData,
  entry: { courseId: number; kpId: number | null; taskId: number | null; action: string; durationSec: number },
): void {
  data.studyLogs.push({
    id: nextId(data.studyLogs),
    courseId: entry.courseId,
    kpId: entry.kpId,
    taskId: entry.taskId,
    action: entry.action,
    duration: Math.max(0, Math.round(entry.durationSec)),
    createTime: now(),
  });
}

function completeKpTasksInData(data: AppData, kpId: number, types: string[]): string[] {
  const today = formatLocalDate();
  const doneTitles: string[] = [];
  for (const t of data.studyTasks) {
    if ((t.kpId ?? null) === kpId && t.scheduledDate === today && t.status === "todo" && types.includes(t.taskType)) {
      t.status = "done";
      doneTitles.push(t.title);
    }
  }
  return doneTitles;
}

/** 测评来源：章节组卷（?set=<章节id>）→ 章末测评任务；结业模考（?exam=1）→ 结业模考任务 */
export type TestTaskContext =
  | { kind: "chapter-test"; chapterId: number }
  | { kind: "exam" };

/**
 * 测评完成勾选：章节组卷/结业模考全部答完后，勾掉该课程未暂停计划中
 * 「今天排期 + 未完成 + test」的任务。chapter-test 匹配 chapterId === context.chapterId
 * 的章末测评任务；exam 匹配 chapterId === null 的结业模考任务。
 * 无命中返回空数组且不写盘，不会误勾其他任务。
 */
export async function completeTestTasks(
  courseId: number,
  context: TestTaskContext,
): Promise<string[]> {
  const data = await getData();
  const today = formatLocalDate();
  const planIds = new Set(
    data.studyPlans.filter((p) => p.courseId === courseId && p.status !== "paused").map((p) => p.id),
  );
  const doneTitles: string[] = [];
  for (const t of data.studyTasks) {
    if (!planIds.has(t.planId)) continue;
    if (t.scheduledDate !== today || t.status !== "todo" || t.taskType !== "test") continue;
    const matched = context.kind === "chapter-test" ? t.chapterId === context.chapterId : t.chapterId === null;
    if (!matched) continue;
    t.status = "done";
    doneTitles.push(t.title);
  }
  if (doneTitles.length > 0) {
    await saveData(data);
  }
  return doneTitles;
}

export async function generateStudyPlan(
  courseId: number,
  input: { startDate: string; targetDate: string; dailyHour: string },
): Promise<StudyPlanWithTasks> {
  const data: AppData = await getData();
  const course = data.courses.find((c) => c.id === courseId);
  if (!course) {
    throw new Error("课程不存在");
  }
  // 与知识点抽取互斥：抽取进行中知识点集不稳定，生成计划会引用到错乱数据
  if (fullExtractInProgress || extractingMaterialIds.size > 0) {
    throw new Error("知识点抽取进行中，暂不能生成学习计划，请等抽取完成后重试");
  }
  // 章节序知识点（无章节的排前）
  const kps = data.knowledgePoints
    .filter((k) => k.courseId === courseId)
    .sort((a, b) => (a.chapterId ?? -1) - (b.chapterId ?? -1) || a.sort - b.sort || a.id - b.id);
  if (kps.length === 0) {
    throw new Error("该课程尚无知识点，请先在「课程内容」页上传资料并抽取知识点");
  }
  // 无 AI 绑定时降级为纯骨架（仍可生成可用计划）
  const binding = findTaskBinding(data, "gen_plan", courseId);

  const today = formatLocalDate(new Date());
  if (input.targetDate < input.startDate) {
    throw new Error("目标日期不能早于开始日期");
  }
  // 天数含开始日与目标日两端
  const days = Math.max(1, Math.round((new Date(input.targetDate).getTime() - new Date(input.startDate).getTime()) / (24 * 60 * 60 * 1000)) + 1);
  const kpsPerDay = Math.ceil(kps.length / days);
  const dayKps: { date: string; kps: KnowledgePoint[] }[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(input.startDate + "T00:00:00");
    d.setDate(d.getDate() + i);
    dayKps.push({ date: formatLocalDate(d), kps: kps.slice(i * kpsPerDay, (i + 1) * kpsPerDay) });
  }

  // AI 只穿插 review/practice 补充任务（非法条目丢弃，不阻断骨架）
  let aiContent = "";
  const extraItems: AiPlanExtraItem[] = [];
  if (binding) {
    const skeletonLines = dayKps
      .map(({ date, kps: dk }) => `${date}：${dk.map((k) => `${k.id}. ${k.name}`).join("、") || "（无）"}`)
      .join("\n");
    const planVars = {
      courseName: course.name,
      today,
      targetDate: input.targetDate,
      days: String(days),
      dailyHour: String(input.dailyHour),
      skeletonLines,
    };
    const planTpl = resolvePromptTemplate(data, "gen_plan");
    const res = await window.siyuanAiStudy.callAi({
      providerId: binding.providerId,
      modelId: binding.modelId,
      taskKey: "gen_plan",
      messages: [
        { role: "system", content: renderPrompt(planTpl.system, planVars) },
        { role: "user", content: renderPrompt(planTpl.user, planVars) },
      ],
    });
    aiContent = res.content;
    const validDates = new Set(dayKps.map((d) => d.date));
    const validKpIds = new Set(kps.map((k) => k.id));
    for (const item of parseAiPlanExtraResponse(res.content)) {
      if (!validDates.has(item.date)) continue;
      if (item.kpId !== 0 && !validKpIds.has(item.kpId)) continue;
      extraItems.push(item);
    }
  }

  // 覆盖式：清除本课程旧计划及其任务
  const oldPlanIds = new Set(data.studyPlans.filter((p) => p.courseId === courseId).map((p) => p.id));
  data.studyPlans = data.studyPlans.filter((p) => !oldPlanIds.has(p.id));
  data.studyTasks = data.studyTasks.filter((t) => !oldPlanIds.has(t.planId));

  const plan: StudyPlan = {
    id: nextId(data.studyPlans),
    courseId,
    planContent:
      aiContent ||
      `确定性骨架：${kps.length} 个知识点均分 ${days} 天（每天 ${kpsPerDay} 个 learn 任务）+ 章末测评与结业模考${binding ? "" : "；未配置 gen_plan 模型，无 AI 补充任务"}`,
    status: "active",
    startDate: input.startDate,
    targetDate: input.targetDate,
    dailyHour: input.dailyHour,
    createTime: now(),
  };
  data.studyPlans.push(plan);

  const dateCounts: Record<string, number> = {};
  const bumpSort = (date: string): number => {
    const n = (dateCounts[date] ?? 0) + 1;
    dateCounts[date] = n;
    return n;
  };
  // 骨架：每知识点一条 learn 任务（100% 覆盖、100% 挂 kpId）
  for (const { date, kps: dk } of dayKps) {
    for (const kp of dk) {
      data.studyTasks.push({
        id: nextId(data.studyTasks),
        planId: plan.id,
        chapterId: kp.chapterId,
        kpId: kp.id,
        taskType: "learn",
        title: `学习：${kp.name}`,
        scheduledDate: date,
        status: "todo",
        sort: bumpSort(date),
      });
    }
  }
  // 章末测评 + 结业模考：系统确定性排期（章末=该章最后一个学习日；无模型配置也能出、位置精确）
  const courseChapters = data.chapters.filter((c) => c.courseId === courseId);
  const chapterById = new Map(courseChapters.map((c) => [c.id, c]));
  const chapterLastDay = new Map<number, string>();
  for (const { date, kps: dk } of dayKps) {
    for (const kp of dk) {
      if (kp.chapterId == null) continue;
      const node = chapterById.get(kp.chapterId);
      const chId = node?.level === "unit" && node.parentId != null ? node.parentId : kp.chapterId;
      chapterLastDay.set(chId, date);
    }
  }
  for (const ch of courseChapters.filter((c) => c.level === "chapter").sort((a, b) => a.sort - b.sort)) {
    const lastDate = chapterLastDay.get(ch.id);
    if (!lastDate) continue;
    data.studyTasks.push({
      id: nextId(data.studyTasks),
      planId: plan.id,
      chapterId: ch.id,
      kpId: null,
      taskType: "test",
      title: `测评：${ch.name} 章节测评`,
      scheduledDate: lastDate,
      status: "todo",
      sort: bumpSort(lastDate),
    });
  }
  data.studyTasks.push({
    id: nextId(data.studyTasks),
    planId: plan.id,
    chapterId: null,
    kpId: null,
    taskType: "test",
    title: "结业模考",
    scheduledDate: input.targetDate,
    status: "todo",
    sort: bumpSort(input.targetDate),
  });
  // AI 穿插的 review/practice
  for (const item of extraItems) {
    const kp = item.kpId ? kps.find((k) => k.id === item.kpId) : undefined;
    data.studyTasks.push({
      id: nextId(data.studyTasks),
      planId: plan.id,
      chapterId: kp?.chapterId ?? null,
      kpId: item.kpId || null,
      taskType: item.taskType,
      title: item.title || `${item.taskType === "review" ? "复习" : "练习"}${kp ? `：${kp.name}` : ""}`,
      scheduledDate: item.date,
      status: "todo",
      sort: bumpSort(item.date),
    });
  }

  await saveData(data);
  return { plan, tasks: await queryStudyTasks(plan.id) };
}

// ===== 学习报告 =====
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

// ===== 应用设置 =====
export async function getSettings(): Promise<AppSettings> {
  const data = await getData();
  return {
    chapterMode: data.settings?.chapterMode ?? "manual",
    persistToSiyuan: data.settings?.persistToSiyuan ?? false,
    notebookName: data.settings?.notebookName ?? "AI 研习",
    aiRetryCount: data.settings?.aiRetryCount ?? 0,
    aiRateLimitPerMin: data.settings?.aiRateLimitPerMin ?? 0,
  };
}

export async function updateSettings(input: Partial<AppSettings>): Promise<void> {
  const data = await getData();
  if (!data.settings) {
    data.settings = { chapterMode: "manual", persistToSiyuan: false, notebookName: "AI 研习" };
  }
  Object.assign(data.settings, input);
  await saveData(data);
}

// ===== 思源落库 =====
export async function ensureNotebook(name: string): Promise<string> {
  return window.siyuanAiStudy.ensureNotebook(name);
}

export async function createSiyuanDoc(markdown: string, path: string, notebook: string): Promise<{ id: string }> {
  return window.siyuanAiStudy.createSiyuanDoc(markdown, path, notebook);
}

export async function removeSiyuanDoc(id: string): Promise<void> {
  await window.siyuanAiStudy.removeSiyuanDoc(id);
}

// ===== 学习对话落库（每章/节一个文档，锚点区幂等重建，保留锚点外用户内容） =====
const CONV_BEGIN = "<!-- ai-study:conversations:begin -->";
const CONV_END = "<!-- ai-study:conversations:end -->";

/** 按 KP 挂载节点定位对话文档：章 → /课程/章/学习对话；节 → /课程/章/节/学习对话；未挂载 → 课程级兜底 */
function convDocTarget(
  course: Course,
  chapters: Chapter[],
  kp: KnowledgePoint,
): { path: string; key: string; label: string } {
  const base = `/${course.name}`;
  const fallback = { path: `${base}/学习对话`, key: `course-${course.id}`, label: course.name };
  if (kp.chapterId == null) return fallback;
  const node = chapters.find((c) => c.id === kp.chapterId);
  if (!node) return fallback;
  if (node.level === "chapter" || node.parentId == null) {
    return { path: `${base}/${node.name}/学习对话`, key: String(node.id), label: node.name };
  }
  const parent = chapters.find((c) => c.id === node.parentId);
  if (!parent) {
    return { path: `${base}/${node.name}/学习对话`, key: String(node.id), label: node.name };
  }
  return {
    path: `${base}/${parent.name}/${node.name}/学习对话`,
    key: String(node.id),
    label: `${parent.name} · ${node.name}`,
  };
}

/** 构建对话文档 markdown（只含本节点下有记录的 KP，sort 序；轮次时间升序） */
function buildConvMarkdown(label: string, kps: KnowledgePoint[], records: ExplainRecord[]): string {
  const byKp = new Map<number, ExplainRecord[]>();
  for (const r of records) {
    const list = byKp.get(r.kpId) ?? [];
    list.push(r);
    byKp.set(r.kpId, list);
  }
  const sections: string[] = [];
  for (const kp of [...kps].sort((a, b) => a.sort - b.sort)) {
    const list = byKp.get(kp.id);
    if (!list || list.length === 0) continue;
    list.sort((a, b) => a.createTime.localeCompare(b.createTime) || a.id - b.id);
    const rounds = list.map((r, i) => {
      const time = new Date(r.createTime).toLocaleString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      return [
        `### 第 ${i + 1} 轮 · ${time} · ${r.aiScore} 分`,
        `**AI 提问**：${r.askPrompt || "（历史轮次未记录提问）"}`,
        `**我的讲解**：${r.userContent}`,
        `**AI 评估**：${r.aiFeedback || "（无点评）"}`,
      ].join("\n\n");
    });
    sections.push(`## ${kp.name}\n\n${rounds.join("\n\n")}`);
  }
  return (
    `# 学习对话\n\n> 本文档由「AI 研习」插件自动维护（${label}）。锚点外内容不会被插件修改。\n\n` +
    `${CONV_BEGIN}\n\n${sections.join("\n\n") || "（暂无学习对话）"}\n\n${CONV_END}\n`
  );
}

/** 把新锚点区合并进旧文档：两锚点齐全 → 只替换中间；缺锚点 → 重建并保留旧文（去标题）到锚点后 */
function mergeConvMarkdown(oldMd: string, newMd: string): string {
  const beginIdx = oldMd.indexOf(CONV_BEGIN);
  const endIdx = oldMd.indexOf(CONV_END);
  if (beginIdx >= 0 && endIdx > beginIdx) {
    const newBegin = newMd.indexOf(CONV_BEGIN);
    const newEnd = newMd.indexOf(CONV_END);
    const header = newMd.slice(0, newBegin);
    const managed = newMd.slice(newBegin, newEnd + CONV_END.length);
    const tail = oldMd.slice(endIdx + CONV_END.length).trim();
    return header + managed + (tail ? `\n\n${tail}\n` : "\n");
  }
  const oldBody = oldMd.replace(/^\s*#\s+[^\n]*\n/, "").trim();
  return newMd + (oldBody ? `\n\n${oldBody}\n` : "");
}

/**
 * 同步 KP 所属章/节节点的讲解对话到思源（幂等：整段重建锚点区）。
 * fire-and-forget 语义：不阻塞主流程，失败仅提示。
 */
export async function syncExplainConversations(courseId: number, kpId: number): Promise<void> {
  const data = await getData();
  const settings = await getSettings();
  if (!settings.persistToSiyuan) return;
  const course = data.courses.find((c) => c.id === courseId);
  const kp = data.knowledgePoints.find((k) => k.id === kpId);
  if (!course || !kp) return;
  const target = convDocTarget(course, data.chapters, kp);

  const nodeKps = data.knowledgePoints.filter(
    (k) => k.courseId === courseId && convDocTarget(course, data.chapters, k).key === target.key,
  );
  const nodeKpIds = new Set(nodeKps.map((k) => k.id));
  const records = data.explainRecords.filter((r) => nodeKpIds.has(r.kpId));
  const newMd = buildConvMarkdown(target.label, nodeKps, records);

  try {
    if (!data.conversationsDocs) data.conversationsDocs = {};
    const entry = data.conversationsDocs[target.key];
    if (entry?.docId) {
      const current =
        (await window.siyuanAiStudy.getSiyuanDocMarkdown(entry.docId)) ?? entry.lastMarkdown ?? null;
      if (!current) {
        window.siyuanAiStudy.showMessage("学习对话文档读取失败，本次跳过同步", 4000, "error");
        return;
      }
      const merged = mergeConvMarkdown(current, newMd);
      await window.siyuanAiStudy.updateSiyuanDoc(entry.docId, merged);
      data.conversationsDocs[target.key] = { docId: entry.docId, lastMarkdown: merged };
    } else {
      const notebook = await ensureNotebook(settings.notebookName);
      const { id } = await window.siyuanAiStudy.createSiyuanDoc(newMd, target.path, notebook);
      data.conversationsDocs[target.key] = { docId: id, lastMarkdown: newMd };
    }
    await saveData(data);
  } catch (e) {
    console.error("学习对话落库失败:", e);
    window.siyuanAiStudy.showMessage(e instanceof Error ? e.message : "学习对话落库失败", 4000, "error");
  }
}

/** 开启持久化时落库思源，返回文档 id；未开启或失败时返回 null（不阻塞主流程） */
async function persistDocIfEnabled(markdown: string, path: string): Promise<string | null> {
  const settings = await getSettings();
  if (!settings.persistToSiyuan) return null;
  try {
    const notebook = await ensureNotebook(settings.notebookName);
    const { id } = await createSiyuanDoc(markdown, path, notebook);
    return id;
  } catch (e) {
    console.error("落库思源失败:", e);
    return null;
  }
}

// ===== 提示词模板管理 =====
export interface PromptTemplateView {
  key: string;
  name: string;
  desc: string;
  vars: PromptVarInfo[];
  /** 当前生效模板（自定义 ?? 默认） */
  current: PromptTemplateDef;
  /** 内置默认模板（供「恢复默认」对照） */
  def: PromptTemplateDef;
  isCustom: boolean;
}

/** 设置页读取全部任务的模板状态 */
export async function getPromptTemplateViews(): Promise<PromptTemplateView[]> {
  const data = await getData();
  return PROMPT_TASKS.map((meta) => {
    const custom = data.promptTemplates?.[meta.key];
    const isCustom =
      !!custom && typeof custom.system === "string" && typeof custom.user === "string";
    return {
      key: meta.key,
      name: meta.name,
      desc: meta.desc,
      vars: meta.vars,
      current: isCustom ? { system: custom!.system, user: custom!.user } : { ...meta.defaultTemplate },
      def: { ...meta.defaultTemplate },
      isCustom,
    };
  });
}

/** 保存某任务的自定义模板（与默认完全一致时等价于恢复默认） */
export async function savePromptTemplate(taskKey: string, tpl: PromptTemplateDef): Promise<void> {
  const meta = findPromptTask(taskKey);
  if (!meta) throw new Error(`未知提示词任务：${taskKey}`);
  const data = await getData();
  if (!data.promptTemplates) data.promptTemplates = {};
  if (tpl.system === meta.defaultTemplate.system && tpl.user === meta.defaultTemplate.user) {
    delete data.promptTemplates[taskKey];
  } else {
    data.promptTemplates[taskKey] = { system: tpl.system, user: tpl.user };
  }
  await saveData(data);
}

/** 恢复某任务为内置默认模板 */
export async function resetPromptTemplate(taskKey: string): Promise<void> {
  const data = await getData();
  if (data.promptTemplates && taskKey in data.promptTemplates) {
    delete data.promptTemplates[taskKey];
    await saveData(data);
  }
}
