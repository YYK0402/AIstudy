import type { AiModel, AiProvider } from "../types/appData";
import { getData, saveData } from "./storage";
import { nextId, now } from "./format";

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

