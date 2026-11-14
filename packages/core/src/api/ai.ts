import type { AppData } from "../types/appData";
import { GLOBAL_DEFAULT_KEY } from "./constants";
import { getBridge } from "@/bridge";

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

/** think 标签（字面量拼接，避免源码出现原始标签串） */
const THINK_OPEN_TAG = "<" + "think>";
const THINK_CLOSE_TAG = "</" + "think>";

/** 剥离模型内联输出的 think 思考块（部分模型把思考文本混在 content 里直出）；正文只取思考块之外的部分 */
export function stripThinking(text: string): string {
  if (!text) return "";
  let out = text.replace(new RegExp(THINK_OPEN_TAG + "[\\s\\S]*?" + THINK_CLOSE_TAG, "gi"), "");
  // 未闭合的 think 开标签（思考中响应即结束）：其后视为思考内容，一并丢弃
  const openIdx = out.toLowerCase().lastIndexOf(THINK_OPEN_TAG);
  if (openIdx !== -1) out = out.slice(0, openIdx);
  return out.trim();
}

export async function callAi(input: CallAiInput): Promise<{ content: string; tokenIn: number; tokenOut: number }> {
  let res: { content: string; tokenIn: number; tokenOut: number };
  try {
    res = await getBridge().callAi(input);
  } catch (e) {
    if (e instanceof Error && e.message === CANCELED_MSG) throw new AiCanceledError();
    throw e;
  }
  return { ...res, content: stripThinking(res.content) };
}

export function cancelAiCall(taskKey: string, scope?: string): void {
  getBridge().cancelAiCall(taskKey, scope);
}

/** 限流（429）/服务端错误（5xx）/超时可退避重试；422 内容敏感过滤等不可重试 */
export function isRetryableError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /429|rate.?limit|HTTP 5\d\d|超时|timeout/i.test(msg);
}

const DEFAULT_RETRY_DELAYS = [10000, 30000, 60000];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 可中断 sleep：每 500ms 检查一次 isAborted（取消时不空等满整个退避时长，由调用方循环顶检查上抛） */
async function sleepInterruptible(ms: number, isAborted?: () => boolean): Promise<void> {
  if (!isAborted) {
    await sleep(ms);
    return;
  }
  const SLICE = 500;
  let waited = 0;
  while (waited < ms) {
    if (isAborted()) return;
    await sleep(Math.min(SLICE, ms - waited));
    waited += SLICE;
  }
}

/** 可退避重试的 AI 调用：按 delays 退避（测试可传短延时）；取消与不可重试错误立即抛出。
 *  第二参：delays 数组 或 isAborted（每轮调用前与退避期间检查，取消时立即抛 AiCanceledError，不空等满退避） */
export async function callAiWithRetry(
  input: CallAiInput,
  delaysOrIsAborted: number[] | (() => boolean) = DEFAULT_RETRY_DELAYS,
  isAborted?: () => boolean,
): Promise<Awaited<ReturnType<typeof callAi>>> {
  const delays = Array.isArray(delaysOrIsAborted) ? delaysOrIsAborted : DEFAULT_RETRY_DELAYS;
  const abort = Array.isArray(delaysOrIsAborted) ? isAborted : delaysOrIsAborted;
  for (let attempt = 0; ; attempt++) {
    if (abort?.()) throw new AiCanceledError();
    try {
      return await callAi(input);
    } catch (e) {
      if (e instanceof AiCanceledError) throw e;
      if (attempt >= delays.length || !isRetryableError(e)) throw e;
      await sleepInterruptible(delays[attempt], abort);
    }
  }
}
