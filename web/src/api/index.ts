// 重新导出所有数据类型
import type { AiProvider, AiModel, TaskModel, CallLog, Course, Chapter, KnowledgePoint, Material, MaterialChapter, Question, AnswerRecord, WrongQuestion, StudyPlan, StudyTask, ExplainRecord, ReviewSchedule, StudyLog, AppData, AppSettings, Mastery } from "../types/appData";
export type { AiProvider, AiModel, TaskModel, CallLog, Course, Chapter, KnowledgePoint, Material, MaterialChapter, Question, AnswerRecord, WrongQuestion, StudyPlan, StudyTask, ExplainRecord, ReviewSchedule, StudyLog, AppData, AppSettings, Mastery };
// ===== 底层数据读写（直接调用主窗口暴露的 Plugin 实例 API） =====
export async function getData(): Promise<AppData> {
  return window.siyuanAiStudy.getData();
}

export async function saveData(data: AppData): Promise<void> {
  await window.siyuanAiStudy.saveData(data);
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

export async function createCourse(input: {
  name: string;
  description?: string;
  target?: string;
  totalCycle?: string;
}): Promise<Course> {
  const data = await getData();
  // 落库思源：开启持久化时建课程顶层文档，否则占位 UUID
  const docId = await persistDocIfEnabled(`# ${input.name}`, `/${input.name}`);
  const course: Course = {
    id: nextId(data.courses),
    siyuanDocId: docId ?? crypto.randomUUID(),
    name: input.name,
    description: input.description ?? "",
    target: input.target ?? "",
    totalCycle: input.totalCycle ?? "",
    status: "active",
    createTime: now(),
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
}): Promise<Course> {
  const data = await getData();
  const course = data.courses.find((c) => c.id === id);
  if (!course) {
    throw new Error("课程不存在，可能已被删除");
  }
  course.name = input.name;
  course.description = input.description ?? "";
  course.target = input.target ?? "";
  course.totalCycle = input.totalCycle ?? "";
  await saveData(data);
  return course;
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
  data.providers = data.providers.filter((p) => p.id !== id);
  data.models = data.models.filter((m) => m.providerId !== id);
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
];

export async function createModel(input: {
  providerId: number;
  modelId: string;
  displayName: string;
  maxContext?: number | null;
}): Promise<AiModel> {
  const data = await getData();
  const model: AiModel = {
    id: nextId(data.models),
    providerId: input.providerId,
    modelId: input.modelId,
    displayName: input.displayName,
    maxContext: input.maxContext ?? null,
  };
  data.models.push(model);
  await saveData(data);
  return model;
}

export async function deleteModel(id: number): Promise<void> {
  const data = await getData();
  data.models = data.models.filter((m) => m.id !== id);
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

// ===== 答题与错题 =====
export interface AnswerResult {
  isCorrect: boolean;
  score: string;
  /** 简答题 AI 给出的逐条反馈，仅 essay 题非空 */
  feedback: string;
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

/** 提交一次作答。客观题本地判分，简答题调用 grade_answer AI 阅卷。 */
export async function submitAnswer(question: Question, userAnswer: string): Promise<AnswerResult> {
  const data = await getData();
  let isCorrect: boolean;
  let score: string;
  let feedback = "";

  if (question.qType === "essay") {
    const binding = findTaskBinding(data, "grade_answer");
    if (!binding) {
      throw new Error(
        "未配置 AI 任务模型，请前往「模型配置 → AI 任务模型分配」设置「grade_answer」任务或「全局默认模型」",
      );
    }
    const res = await window.siyuanAiStudy.callAi({
      providerId: binding.providerId,
      modelId: binding.modelId,
      taskKey: "grade_answer",
      messages: [
        {
          role: "system",
          content:
            "你是简答题阅卷老师。根据参考答案对学生作答判分：抓住要点即可，不逐字抠，表述不同但要点达意同样给分。" +
            "输出 JSON 对象：{\"score\": 0-100 的整数, \"feedback\": \"简要点评（答对了哪些、遗漏了什么，一两句话）\"}。只返回 JSON。" ,
        },
        {
          role: "user",
          content: `题目：${question.title}\n\n参考答案：${question.answer}\n\n学生作答：${userAnswer || "（未作答）"}`,
        },
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

  if (!isCorrect) {
    const wrong = data.wrongQuestions.find((w) => w.qId === question.id);
    if (wrong) {
      wrong.reviewTimes++;
    } else {
      data.wrongQuestions.push({
        id: nextId(data.wrongQuestions),
        recordId: record.id,
        qId: question.id,
        reviewTimes: 1,
        createTime: now(),
      });
    }
    // 答错 → 题目进入复习池（已有触点则重置为明日到期）
    ensureQuestionReviewInData(data, question.id);
  }

  await saveData(data);
  return { isCorrect, score, feedback };
}

function normalizeAnswer(s: string): string {
  return s.trim().split(/\s*,\s*/).map((p) => p.trim()).sort((a, b) => a.localeCompare(b)).join(",");
}

export async function queryWrongQuestions(courseId: number): Promise<Array<{ wrong: WrongQuestion; question: Question }>> {
  const data = await getData();
  const qMap = new Map(data.questions.filter((q) => q.courseId === courseId).map((q) => [q.id, q]));
  return data.wrongQuestions
    .filter((w) => qMap.has(w.qId))
    .sort((a, b) => b.id - a.id)
    .map((w) => ({ wrong: w, question: qMap.get(w.qId)! }));
}

export async function deleteWrongQuestion(id: number): Promise<void> {
  const data = await getData();
  data.wrongQuestions = data.wrongQuestions.filter((w) => w.id !== id);
  await saveData(data);
}

// ===== 讲解评估（冯诺依曼学习法） =====
export interface ExplainResult {
  score: number;
  feedback: string;
}

/** 讲解达标（≥60 分）→ 知识点进入复习池。 */
export const EXPLAIN_PASS_SCORE = 60;

function parseAiExplainResponse(content: string): ExplainResult | null {
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
export async function submitExplain(kp: KnowledgePoint, userContent: string): Promise<ExplainResult> {
  const data = await getData();
  const binding = findTaskBinding(data, "eval_explain");
  if (!binding) {
    throw new Error(
      "未配置 AI 任务模型，请前往「模型配置 → AI 任务模型分配」设置「eval_explain」任务或「全局默认模型」",
    );
  }

  const res = await window.siyuanAiStudy.callAi({
    providerId: binding.providerId,
    modelId: binding.modelId,
    taskKey: "eval_explain",
    messages: [
      {
        role: "system",
        content:
          "你是教学评估专家。学生学习了某知识点后用自己的话向你讲解（冯诺依曼学习法），你评估讲解质量。" +
          "从三方面打分并综合为 0-100 整数：正确性（有无事实/逻辑错误，错一处大幅扣分）、覆盖度（相对要点基准遗漏多少）、清晰度（表达是否通顺有条理）。" +
          "输出 JSON 对象：{\"score\": 0-100, \"feedback\": \"中文点评，两三句：先说讲对了哪些，再指出理解偏差或遗漏，最后给一条补强建议\"}。只返回 JSON。",
      },
      {
        role: "user",
        content: `知识点：${kp.name}\n要点基准（描述）：${kp.content || "（无描述，请按知识点名称判断）"}\n\n学生讲解：\n${userContent}`,
      },
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
  };
  data.explainRecords.push(record);
  if (result.score >= EXPLAIN_PASS_SCORE) {
    ensureReviewTouchpointInData(data, courseKp.id);
  }
  await saveData(data);
  return result;
}

export async function queryExplainRecords(kpId: number): Promise<ExplainRecord[]> {
  const data = await getData();
  return data.explainRecords
    .filter((r) => r.kpId === kpId)
    .sort((a, b) => b.id - a.id);
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

function parseAiQuestionResponse(content: string): AiQuestionItem[] {
  const trimmed = content.trim();
  const jsonMatch =
    trimmed.match(/```(?:json)?\s*([\s\S]*?)```/) ||
    trimmed.match(/(\[[\s\S]*\])/);
  const candidate = (jsonMatch ? jsonMatch[1] : trimmed).trim();
  try {
    const parsed = JSON.parse(candidate);
    if (!Array.isArray(parsed)) return [];
    const valid: AiQuestionItem[] = [];
    for (const it of parsed) {
      if (!it || typeof it.title !== "string" || typeof it.answer !== "string") continue;
      const qType = QUESTION_TYPES.includes(it.qType)
        ? (it.qType as QuestionType)
        : "single";
      valid.push({
        qType,
        kpIds: Array.isArray(it.kpIds)
          ? it.kpIds.filter((n: unknown) => Number.isFinite(n))
          : [],
        title: it.title,
        options: Array.isArray(it.options)
          ? it.options.filter((o: unknown) => typeof o === "string")
          : [],
        answer: it.answer,
        analysis: typeof it.analysis === "string" ? it.analysis : "",
        difficulty: it.difficulty === "easy" || it.difficulty === "hard" ? it.difficulty : "medium",
      });
    }
    return valid;
  } catch {
    return [];
  }
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
  const binding = findTaskBinding(data, "gen_question");
  if (!binding) {
    throw new Error(
      "未配置 AI 任务模型，请前往「模型配置 → AI 任务模型分配」设置「gen_question」任务或「全局默认模型」",
    );
  }
  const qTypeLabel = QUESTION_TYPE_LABELS[input.qType];
  const diffLabel = QUESTION_DIFFICULTY_LABELS[input.difficulty];

  const kpLines = kps.map((k) => `- ${k.id}. ${k.name}：${truncateText(k.content, 200) || "暂无描述"}`).join("\n");

  const res = await window.siyuanAiStudy.callAi({
    providerId: binding.providerId,
    modelId: binding.modelId,
    taskKey: "gen_question",
    messages: [
      {
        role: "system",
        content:
          "你是习题命题助手。根据给定知识点及描述出题。输出 JSON 数组，每项含：" +
          "qType（'" + input.qType + "'）、kpIds（关联知识点 id 数组）、title（题干）、options（选项文本数组）、answer（正确答案）、analysis（解析）、difficulty（'" + input.difficulty + "'）。" +
          "各题型要求——" +
          "single：options 恰好 4 项，answer 为正确选项文本；" +
          "multiple：options 恰好 4-5 项，answer 为多个正确选项文本以逗号分隔；" +
          "judge：options 固定为 [\"正确\",\"错误\"]，answer 为「正确」或「错误」；" +
          "essay：options 为空数组 []，answer 为参考答案要点。" +
          "只返回 JSON 数组，不要任何其他文字。",
      },
      {
        role: "user",
        content:
          `课程：${course.name}\n共出 ${input.count} 道 ${qTypeLabel} 题，难度${diffLabel}。\n仅围绕以下知识点命题，如知识点数量多于题数可跨题分布：\n\n${kpLines}`,
      },
    ],
  });

  const items = parseAiQuestionResponse(res.content);
  if (items.length === 0) {
    throw new Error("AI 返回的题目格式无法解析，请重试");
  }
  const kpIdSet = new Set(input.kpIds);

  const questions: Question[] = [];
  let nextQuestionId = nextId(data.questions);
  for (const item of items) {
    questions.push({
      id: nextQuestionId++,
      courseId,
      kpIds: item.kpIds.filter((n) => kpIdSet.has(n)).join(","),
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
  return questions;
}

function truncateText(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
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
export async function createMaterial(input: {
  courseId: number;
  name: string;
  fileType: string;
  contentText: string;
  assetPath?: string;
  headings?: string;
}): Promise<Material> {
  const data = await getData();
  const course = data.courses.find((c) => c.id === input.courseId);
  // 落库思源：资料文档放在课程文档下的「资料库」目录
  const docId = await persistDocIfEnabled(
    `# ${input.name}\n\n${input.contentText}`,
    `/${course?.name ?? "课程"}/资料库`,
  );
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
  };
  data.materials.push(material);
  await saveData(data);
  return material;
}

export async function deleteMaterial(id: number): Promise<void> {
  const data = await getData();
  const material = data.materials.find((m) => m.id === id);
  data.materials = data.materials.filter((m) => m.id !== id);
  await saveData(data);
  if (material?.siyuanDocId) {
    removeSiyuanDoc(material.siyuanDocId).catch((e) => console.error("删除思源文档失败:", e));
  }
}

export async function queryMaterials(courseId: number): Promise<Material[]> {
  const data = await getData();
  return data.materials.filter((m) => m.courseId === courseId);
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
  status: "new" | "update" | "duplicate";
  duplicateOf?: string;
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
      return parsed.filter(
        (it): it is AiKpItem =>
          it && typeof it.name === "string" && typeof it.description === "string",
      );
    }
  } catch {
    // ignore
  }
  return [];
}

function findTaskBinding(
  data: AppData,
  taskKey: string,
): { providerId: number; modelId: string } | null {
  const taskBinding = data.taskModels.find((t) => t.taskKey === taskKey);
  let modelId = taskBinding?.modelId ?? null;
  if (!modelId) {
    const def = data.taskModels.find((t) => t.taskKey === GLOBAL_DEFAULT_KEY);
    modelId = def?.modelId ?? null;
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

export async function extractKnowledgePoints(
  materialId: number,
  options?: { taskKey?: string },
): Promise<ExtractKpResult> {
  const data: AppData = await getData();
  const material = data.materials.find((m) => m.id === materialId);
  if (!material) {
    throw new Error("资料不存在");
  }
  const taskKey = options?.taskKey ?? "extract_kp";
  const binding = findTaskBinding(data, taskKey);
  if (!binding) {
    throw new Error(
      "未配置 AI 任务模型，请前往「模型配置 → AI 任务模型分配」设置「" + taskKey + "」任务或「全局默认模型」",
    );
  }

  const { chunkText, chunkByMarkdownHeadings } = await import("../utils/textChunker");
  const headingChunks = chunkByMarkdownHeadings(material.contentText);
  // 有 ≥2 个标题片段时按标题切分（语义完整、块数少、省 token），否则回退固定字符分块
  const useHeadings = headingChunks.length >= 2;
  const blocks: Array<{ title: string; text: string }> = useHeadings
    ? headingChunks.map((c) => ({ title: c.title, text: c.content }))
    : chunkText(material.contentText, 2000).map((t) => ({ title: "", text: t }));
  const existingKps: KnowledgePoint[] = data.knowledgePoints.filter((k) => k.courseId === material.courseId);
  const existingNames = existingKps.map((k) => k.name);

  let newCount = 0;
  let updateCount = 0;
  let duplicateCount = 0;
  const errors: string[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const locator = block.title ? `章节：${block.title}` : `文本片段（第${i + 1}/${blocks.length}块）`;
    try {
      const res = await window.siyuanAiStudy.callAi({
        providerId: binding.providerId,
        modelId: binding.modelId,
        taskKey,
        messages: [
          {
            role: "system",
            content:
              "你是知识抽取助手。从给定文本中提取关键知识点（概念/定义/原理/公式/考点）。输出 JSON 数组，每项含 name、description、status 三个字段。status 取值：'new' 全新、'update' 对已有知识点的补充、'duplicate' 与已有知识点重复。如标 duplicate 则填 duplicateOf 为已有知识点名称。只返回 JSON，不要任何其他文字。",
          },
          {
            role: "user",
            content:
              `已有知识点：${existingNames.join("、") || "无"}\n\n${locator}：\n${block.text}`,
          },
        ],
      });
      const items = parseAiKpResponse(res.content);
      for (const item of items) {
        const trimmedName = item.name.trim();
        if (!trimmedName) continue;
        const existing: KnowledgePoint | undefined = existingKps.find(
          (k) => k.name.trim().toLowerCase() === trimmedName.toLowerCase(),
        );
        if (item.status === "duplicate" || existing) {
          duplicateCount++;
        } else if (item.status === "update" && existing) {
          (existing as KnowledgePoint).content = (existing as KnowledgePoint).content
            ? (existing as KnowledgePoint).content + "\n" + item.description
            : item.description;
          updateCount++;
        } else {
          data.knowledgePoints.push({
            id: data.knowledgePoints.reduce((m, k) => Math.max(m, k.id), 0) + 1,
            courseId: material.courseId,
            chapterId: null,
            blockId: null,
            name: trimmedName,
            content: item.description,
            mastery: "unlearn",
            sourceAssetIds: String(materialId),
            prevKpIds: "",
            sort: 0,
            createTime: new Date().toISOString(),
          });
          existingNames.push(trimmedName);
          newCount++;
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`第 ${i + 1} 块失败：${msg}`);
    }
  }

  await saveData(data);
  return { newCount, updateCount, duplicateCount, totalChunks: blocks.length, errors };
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
  const data = await getData();
  data.knowledgePoints = data.knowledgePoints.filter((k) => k.id !== id);
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
  const parentChapter = input.parentId ? data.chapters.find((c) => c.id === input.parentId) : null;
  // 落库思源：章作为课程文档的子文档，节作为章文档的子文档
  const path = parentChapter
    ? `/${course?.name ?? "课程"}/${parentChapter.name}`
    : `/${course?.name ?? "课程"}`;
  const docId = await persistDocIfEnabled(`# ${input.name}`, path);
  const sort =
    data.chapters.filter((c) => c.courseId === input.courseId && c.parentId === input.parentId).reduce((m, c) => Math.max(m, c.sort), 0) + 1;
  const chapter: Chapter = {
    id: nextId(data.chapters),
    courseId: input.courseId,
    parentId: input.parentId,
    siyuanBlockId: docId,
    name: input.name,
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
): Promise<{ created: number }> {
  const data = await getData();
  const course = data.courses.find((c) => c.id === courseId);
  const coursePath = `/${course?.name ?? "课程"}`;
  const existing = data.chapters.filter((c) => c.courseId === courseId);
  let created = 0;
  for (const node of nodes) {
    const name = node.name.trim();
    if (!name) continue;
    const dup = existing.find((c) => c.name === name);
    if (dup) continue;
    const parent = node.parentName
      ? existing.find((c) => c.level === "chapter" && c.name === node.parentName)
      : null;
    const sort =
      data.chapters
        .filter((c) => c.courseId === courseId && c.parentId === (parent?.id ?? null))
        .reduce((m, c) => Math.max(m, c.sort), 0) + 1;
    // 落库思源：章作为课程子文档，节作为父章子文档
    const path = parent ? `${coursePath}/${parent.name}` : coursePath;
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
  await saveData(data);
  return { created };
}

export async function updateChapter(chapter: Chapter): Promise<void> {
  const data = await getData();
  const idx = data.chapters.findIndex((c) => c.id === chapter.id);
  if (idx >= 0) {
    data.chapters[idx] = chapter;
    await saveData(data);
  }
}

export async function deleteChapter(id: number): Promise<void> {
  const data = await getData();
  // 收集自身及所有子孙章节 id
  const removed = new Set<number>([id]);
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
function formatLocalDate(d: Date): string {
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
}

export async function queryDueReviews(courseId: number): Promise<ReviewDueItem[]> {
  const data = await getData();
  const today = reviewNextDue(0);
  const kps = new Map(data.knowledgePoints.filter((k) => k.courseId === courseId).map((k) => [k.id, k]));
  const qs = new Map(data.questions.filter((q) => q.courseId === courseId).map((q) => [q.id, q]));
  return data.reviewSchedules
    .filter((s) => {
      if (s.dueTime > today) return false;
      if (s.kpId !== null) return kps.has(s.kpId);
      if (s.qId !== null) return qs.has(s.qId);
      return false;
    })
    .sort((a, b) => a.dueTime.localeCompare(b.dueTime))
    .map((s) => ({
      schedule: s,
      knowledgePoint: s.kpId !== null ? kps.get(s.kpId) ?? null : null,
      question: s.qId !== null ? qs.get(s.qId) ?? null : null,
    }));
}

/** 对一次复习打分：自研 SM2 更新间隔与到期日。 */
export async function submitReview(schedule: ReviewSchedule, grade: ReviewGrade): Promise<ReviewSchedule> {
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
  await saveData(data);
  return target;
}

// ===== AI 学习计划生成 =====
export interface PlanTaskItem {
  date: string;
  taskType: "learn" | "review" | "practice";
  chapterId: number | null;
  title: string;
}

interface StudyPlanWithTasks {
  plan: StudyPlan;
  tasks: StudyTask[];
}

function parseAiPlanResponse(content: string): PlanTaskItem[] {
  const trimmed = content.trim();
  const jsonMatch =
    trimmed.match(/```(?:json)?\s*([\s\S]*?)```/) ||
    trimmed.match(/(\[[\s\S]*\])/);
  const candidate = (jsonMatch ? jsonMatch[1] : trimmed).trim();
  try {
    const parsed = JSON.parse(candidate);
    if (!Array.isArray(parsed)) return [];
    const valid: PlanTaskItem[] = [];
    for (const it of parsed) {
      if (!it || typeof it.date !== "string" || typeof it.title !== "string") continue;
      const taskType = it.taskType;
      const chapterId = Number(it.chapterId);
      valid.push({
        date: it.date,
        taskType: taskType === "review" || taskType === "practice" ? taskType : "learn",
        chapterId: Number.isFinite(chapterId) && chapterId > 0 ? chapterId : null,
        title: it.title,
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
    data.studyTasks[idx] = task;
    await saveData(data);
  }
}

export async function deleteStudyPlan(planId: number): Promise<void> {
  const data = await getData();
  data.studyPlans = data.studyPlans.filter((p) => p.id !== planId);
  data.studyTasks = data.studyTasks.filter((t) => t.planId !== planId);
  await saveData(data);
}

export async function generateStudyPlan(
  courseId: number,
  input: { targetDate: string; dailyHour: string },
): Promise<StudyPlanWithTasks> {
  const data: AppData = await getData();
  const course = data.courses.find((c) => c.id === courseId);
  if (!course) {
    throw new Error("课程不存在");
  }
  const chapters = data.chapters.filter((c) => c.courseId === courseId).sort((a, b) => a.sort - b.sort);
  if (chapters.length === 0) {
    throw new Error("该课程尚无章节，请先在「课程内容」页搭建章节目录");
  }
  const binding = findTaskBinding(data, "gen_plan");
  if (!binding) {
    throw new Error("未配置 AI 任务模型，请前往「模型配置 → AI 任务模型分配」设置「gen_plan」任务或「全局默认模型」");
  }

  const today = formatLocalDate(new Date());
  const chapterLines = chapters
    .map((ch) => {
      const kps = data.knowledgePoints
        .filter((k) => k.chapterId === ch.id)
        .map((k) => k.name)
        .join("、");
      const prefix = ch.level === "unit" ? "  - " : "- ";
      return `${prefix}${ch.name}${ch.level === "unit" ? "（小节）" : "（章）"}${kps ? `：知识点 ${kps}` : "：暂无知识点"}`;
    })
    .join("\n");

  const days = Math.max(1, Math.ceil(
    (new Date(input.targetDate).getTime() - new Date(today).getTime()) / (24 * 60 * 60 * 1000),
  ));

  const res = await window.siyuanAiStudy.callAi({
    providerId: binding.providerId,
    modelId: binding.modelId,
    taskKey: "gen_plan",
    messages: [
      {
        role: "system",
        content:
          "你是学习计划规划师。根据用户提供的课程章节、知识点、目标日期和每日学习时长，生成从今天到目标日期的分阶段学习计划。" +
          "输出 JSON 数组，每项含 date（YYYY-MM-DD）、taskType（'learn' 学习新内容 / 'review' 复习 / 'practice' 练习）、chapterId（关联的章节 id，整数；无明确关联填 0）、title（任务标题，简洁具体，含该日学习的章节或知识点）。" +
          "要求：先 learn 后 practice+review；后期安排整体复习与练习；任务数量与每日时长匹配，每天至少 1 条。" +
          "只返回 JSON 数组，不要任何其他文字。",
      },
      {
        role: "user",
        content:
          `课程：${course.name}\n目标日期：${input.targetDate}（共 ${days} 天）\n每日学习时长：${input.dailyHour} 小时\n今天是：${today}\n\n章节与知识点（id. 名称）：\n${chapterLines}`,
      },
    ],
  });

  const items = parseAiPlanResponse(res.content);
  if (items.length === 0) {
    throw new Error("AI 返回的计划格式无法解析，请重试");
  }
  const validChapterIds = new Set(chapters.map((c) => c.id));

  // 覆盖式：清除本课程旧计划及其任务
  const oldPlanIds = new Set(data.studyPlans.filter((p) => p.courseId === courseId).map((p) => p.id));
  data.studyPlans = data.studyPlans.filter((p) => !oldPlanIds.has(p.id));
  data.studyTasks = data.studyTasks.filter((t) => !oldPlanIds.has(t.planId));

  const plan: StudyPlan = {
    id: nextId(data.studyPlans),
    courseId,
    planContent: res.content,
    targetDate: input.targetDate,
    dailyHour: input.dailyHour,
    createTime: now(),
  };
  data.studyPlans.push(plan);

  const dateCounts: Record<string, number> = {};
  for (const item of items) {
    const sort = (dateCounts[item.date] ?? 0) + 1;
    dateCounts[item.date] = sort;
    data.studyTasks.push({
      id: nextId(data.studyTasks),
      planId: plan.id,
      chapterId: item.chapterId !== null && validChapterIds.has(item.chapterId) ? item.chapterId : null,
      taskType: item.taskType,
      title: item.title,
      scheduledDate: item.date,
      status: "todo",
      sort,
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
  const essayScores = records.filter((r) => r.score !== "").map((r) => parseScoreText(r.score)).filter((n): n is number => n !== null);
  const explainScores = explainRecords.map((r) => parseScoreText(r.aiScore)).filter((n): n is number => n !== null);

  const avg = (arr: number[]): string =>
    arr.length ? String(Math.round(arr.reduce((s, n) => s + n, 0) / arr.length)) : "";

  return {
    kp: { total: kps.length, distribution },
    quiz: {
      total: records.length,
      correct,
      accuracy: records.length ? Math.round((correct / records.length) * 100) + "%" : "",
      essayAvgScore: avg(essayScores),
      wrongCount: data.wrongQuestions.filter((w) => qIdSet.has(w.qId)).length,
    },
    explain: { total: explainRecords.length, avgScore: avg(explainScores) },
    review: { touchpoints: reviews.length, totalReviews: reviews.reduce((s, r) => s + r.reviewTimes, 0) },
    plan: { done: tasks.filter((t) => t.status === "done").length, total: tasks.length },
  };
}

/** 生成 AI 综合学习报告（Markdown 文本，不落库）。 */
export async function generateCourseReport(course: Course, stats: CourseStats): Promise<string> {
  const data = await getData();
  const binding = findTaskBinding(data, "gen_report");
  if (!binding) {
    throw new Error(
      "未配置 AI 任务模型，请前往「模型配置 → AI 任务模型分配」设置「gen_report」任务或「全局默认模型」",
    );
  }

  const res = await window.siyuanAiStudy.callAi({
    providerId: binding.providerId,
    modelId: binding.modelId,
    taskKey: "gen_report",
    messages: [
      {
        role: "system",
        content:
          "你是学习顾问。根据用户的学习统计数据写一份学习报告（Markdown 格式），包含四个二级标题：## 学习行为总结、## 薄弱环节分析、## 下阶段建议、## 鼓励。\n" +
          "点评要有依据（引用具体数字）；薄弱环节结合掌握度分布、答题正确率、未掌握知识点指出；建议要具体可执行（时间段/时长/复习策略）。中文，500 字以内。只返回 Markdown 正文。",
      },
      {
        role: "user",
        content:
          `课程：${course.name}\n目标：${course.target || "（未设定）"}\n\n统计数据（JSON）：\n${JSON.stringify(stats, null, 2)}\n\n课程知识点：\n${data.knowledgePoints.filter((k) => k.courseId === course.id).map((k) => `- ${k.name}[${k.mastery}]`).join("\n") || "（无）"}`,
      },
    ],
  });

  const text = res.content.trim();
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
