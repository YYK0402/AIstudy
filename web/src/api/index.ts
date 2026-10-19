// ===== 数据模型（与主窗口 src/data.ts 保持一致） =====
export interface AiProvider {
  id: number;
  name: string;
  baseUrl: string;
  apiKey: string;
  timeout: number;
  enabled: boolean;
  createTime: string;
}

export interface AiModel {
  id: number;
  providerId: number;
  modelId: string;
  displayName: string;
  maxContext: number | null;
}

export interface TaskModel {
  taskKey: string;
  modelId: number | null;
  isGlobalDefault: boolean;
}

export interface CallLog {
  id: number;
  taskKey: string;
  providerName: string;
  modelName: string;
  tokenIn: number;
  tokenOut: number;
  status: string;
  errorMsg: string;
  createTime: string;
}

export interface Course {
  id: number;
  siyuanDocId: string;
  name: string;
  description: string;
  target: string;
  totalCycle: string;
  status: string;
  createTime: string;
}

export interface Chapter {
  id: number;
  courseId: number;
  parentId: number | null;
  siyuanBlockId: string | null;
  name: string;
  level: "chapter" | "unit";
  sort: number;
}

export type Mastery = "unlearn" | "known" | "mastered" | "proficient";

export interface KnowledgePoint {
  id: number;
  courseId: number;
  chapterId: number | null;
  blockId: string | null;
  name: string;
  content: string;
  mastery: Mastery;
  sourceAssetIds: string;
  prevKpIds: string;
  sort: number;
  createTime: string;
}

export interface Material {
  id: number;
  courseId: number;
  name: string;
  assetPath: string;
  fileType: string;
  contentText: string;
  status: string;
  createTime: string;
}

export interface MaterialChapter {
  id: number;
  materialId: number;
  chapterId: number;
}

export interface Question {
  id: number;
  courseId: number;
  kpIds: string;
  title: string;
  options: string;
  answer: string;
  analysis: string;
  qType: string;
  difficulty: string;
  source: string;
  createTime: string;
}

export interface AnswerRecord {
  id: number;
  qId: number;
  userAnswer: string;
  isCorrect: boolean;
  score: string;
  createTime: string;
}

export interface WrongQuestion {
  id: number;
  recordId: number | null;
  qId: number;
  reviewTimes: number;
  createTime: string;
}

export interface StudyPlan {
  id: number;
  courseId: number;
  planContent: string;
  targetDate: string;
  dailyHour: string;
  createTime: string;
}

export interface StudyTask {
  id: number;
  planId: number;
  chapterId: number | null;
  taskType: string;
  title: string;
  scheduledDate: string;
  status: string;
  sort: number;
}

export interface ExplainRecord {
  id: number;
  courseId: number;
  kpId: number;
  userContent: string;
  aiFeedback: string;
  aiScore: string;
  createTime: string;
}

export interface ReviewSchedule {
  id: number;
  kpId: number | null;
  qId: number | null;
  stage: number;
  dueTime: string;
  easeFactor: number;
  intervalDays: number;
  lastReviewTime: string | null;
  reviewTimes: number;
}

export interface StudyLog {
  id: number;
  courseId: number;
  kpId: number | null;
  taskId: number | null;
  action: string;
  duration: number;
  createTime: string;
}

export interface AppData {
  providers: AiProvider[];
  models: AiModel[];
  taskModels: TaskModel[];
  logs: CallLog[];
  courses: Course[];
  chapters: Chapter[];
  knowledgePoints: KnowledgePoint[];
  materials: Material[];
  materialChapters: MaterialChapter[];
  questions: Question[];
  answerRecords: AnswerRecord[];
  wrongQuestions: WrongQuestion[];
  studyPlans: StudyPlan[];
  studyTasks: StudyTask[];
  explainRecords: ExplainRecord[];
  reviewSchedules: ReviewSchedule[];
  studyLogs: StudyLog[];
}

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
  const course: Course = {
    id: nextId(data.courses),
    siyuanDocId: crypto.randomUUID(),
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
}): Promise<Material> {
  const data = await getData();
  const material: Material = {
    id: nextId(data.materials),
    courseId: input.courseId,
    name: input.name,
    assetPath: input.assetPath ?? "",
    fileType: input.fileType,
    contentText: input.contentText,
    status: "parsed",
    createTime: now(),
  };
  data.materials.push(material);
  await saveData(data);
  return material;
}

export async function deleteMaterial(id: number): Promise<void> {
  const data = await getData();
  data.materials = data.materials.filter((m) => m.id !== id);
  await saveData(data);
}

export async function queryMaterials(courseId: number): Promise<Material[]> {
  const data = await getData();
  return data.materials.filter((m) => m.courseId === courseId);
}
