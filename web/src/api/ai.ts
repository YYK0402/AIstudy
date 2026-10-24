import type { AppData } from "../types/appData";
import { GLOBAL_DEFAULT_KEY } from "./constants";

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
