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

// AI 调用统一封装：取消错误归一化 + 取消命令
// 插件侧 forwardProxy 无网络层 abort：cancelAiCall 标记后，在途调用返回时丢弃响应并抛取消错误（已消耗 token 无法退回）

export interface CallAiInput {
  providerId: number;
  modelId: string;
  messages: { role: string; content: string }[];
  taskKey: string;
  /** 取消作用域（如 course-1 / material-2）：与 taskKey 组成在途表键 */
  scope?: string;
}

/** AI 调用被取消（插件在途表标记）：上层按「用户取消」处理，不计为失败 */
export class AiCanceledError extends Error {
  constructor() {
    super("AI 调用已取消");
    this.name = "AiCanceledError";
  }
}

const CANCELED_MSG = "AI 调用已取消";

export async function callAi(input: CallAiInput): Promise<{ content: string; tokenIn: number; tokenOut: number }> {
  try {
    return await window.siyuanAiStudy.callAi(input);
  } catch (e) {
    if (e instanceof Error && e.message === CANCELED_MSG) throw new AiCanceledError();
    throw e;
  }
}

export function cancelAiCall(taskKey: string, scope?: string): void {
  window.siyuanAiStudy.cancelAiCall(taskKey, scope);
}
