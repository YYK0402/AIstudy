// 重新导出所有数据类型
import type { AiProvider, AiModel, TaskModel, CallLog, Course, Chapter, KnowledgePoint, Material, MaterialChapter, Question, AnswerRecord, WrongQuestion, StudyPlan, StudyTask, ExplainRecord, ReviewSchedule, StudyLog, AppData, Mastery } from "../types/appData";
export type { AiProvider, AiModel, TaskModel, CallLog, Course, Chapter, KnowledgePoint, Material, MaterialChapter, Question, AnswerRecord, WrongQuestion, StudyPlan, StudyTask, ExplainRecord, ReviewSchedule, StudyLog, AppData, Mastery };

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

  const chunks = (await import("../utils/textChunker")).chunkText(material.contentText, 2000);
  const existingKps: KnowledgePoint[] = data.knowledgePoints.filter((k) => k.courseId === material.courseId);
  const existingNames = existingKps.map((k) => k.name);

  let newCount = 0;
  let updateCount = 0;
  let duplicateCount = 0;
  const errors: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
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
              `已有知识点：${existingNames.join("、") || "无"}\n\n文本片段（第${i+1}/${chunks.length}块）：\n${chunks[i]}`,
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
  return { newCount, updateCount, duplicateCount, totalChunks: chunks.length, errors };
}
