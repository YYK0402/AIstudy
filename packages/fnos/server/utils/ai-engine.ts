// AI 调用引擎（服务端）：与思源适配器同一套重试/限流/日志逻辑，差异仅在传输层（Node fetch 直连）
import { buildChatPayload, nextRateSlotWaitMs } from "../../../core/src/aiPayload";
import { runWithRetry } from "../../../core/src/aiRetry";
import { decryptApiKey } from "../../../core/src/crypto";
import type { AppData, CallLog } from "../../../core/src/types/appData";
import type { CallAiMessage, CallAiResult, ListModelsResult, TestProviderResult } from "../../../core/src/bridge/types";
import { loadUserData, saveUserData } from "./user-data";

export interface AiCallInput {
  providerId: number;
  modelId: string;
  messages: CallAiMessage[];
  taskKey: string;
  scope?: string;
}

interface InflightEntry {
  canceled: boolean;
  controller: AbortController;
}

// 在途调用登记表：cancelAiCall 标记 canceled 并 abort 网络请求
const inflight = new Map<string, InflightEntry>();
// 每用户滑动窗口速率限制（次/分钟，读自用户数据 settings.aiRateLimitPerMin）
const rateWindows = new Map<string, number[]>();

function key(uid: string, taskKey: string, scope?: string): string {
  return `${uid}:${taskKey}:${scope ?? "-"}`;
}

export function cancelAiCall(uid: string, taskKey: string, scope?: string): void {
  const entry = inflight.get(key(uid, taskKey, scope));
  if (entry) {
    entry.canceled = true;
    entry.controller.abort();
  }
}

function appendLog(
  data: AppData,
  taskKey: string,
  providerName: string,
  modelName: string,
  tokenIn: number,
  tokenOut: number,
  status: string,
  errorMsg: string,
): void {
  const log: CallLog = {
    id: data.logs.reduce((max, l) => Math.max(max, l.id), 0) + 1,
    taskKey,
    providerName,
    modelName,
    tokenIn,
    tokenOut,
    status,
    errorMsg,
    createTime: new Date().toISOString(),
  };
  data.logs.push(log);
  // 日志保留最近 500 条，避免数据文件无限增长
  if (data.logs.length > 500) {
    data.logs.splice(0, data.logs.length - 500);
  }
}

function toFriendlyAiError(error: unknown, provider: { name: string; timeout: number }): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/aborted|TimeoutError|超时/i.test(message)) {
    return new Error(
      `AI 请求超时（超过「${provider.name}」服务商超时设置 ${provider.timeout} 秒）。` +
        "生成学习计划等任务输出较长、推理模型思考耗时，建议到「模型配置 → 编辑服务商」把超时调大后重试",
    );
  }
  return error instanceof Error ? error : new Error(message);
}

/** 单次 AI 调用（不含重试），失败抛原始错误 */
async function attemptCallAi(
  data: AppData,
  provider: { id: number; baseUrl: string; apiKey: string; timeout: number },
  input: AiCallInput,
  controller: AbortController,
): Promise<CallAiResult> {
  const url = provider.baseUrl.replace(/\/$/, "") + "/chat/completions";
  const modelRow = data.models.find((m) => m.providerId === provider.id && m.modelId === input.modelId);
  const payload = buildChatPayload(input.modelId, input.messages, modelRow);
  const apiKey = await decryptApiKey(data, provider.apiKey);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (e) {
    const detail = e instanceof Error && "cause" in e && e.cause instanceof Error ? e.cause.message : "";
    throw new Error(`LLM 请求失败: ${e instanceof Error ? e.message : String(e)} ${detail}`.trim());
  }
  if (!res.ok) {
    // 错误体可能很大（HTML 错误页），截断避免撑爆日志/提示
    const body = (await res.text()).slice(0, 500);
    throw new Error(`LLM 请求失败: HTTP ${res.status} ${body}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const content = json.choices?.[0]?.message?.content ?? "";
  return {
    content,
    tokenIn: json.usage?.prompt_tokens ?? 0,
    tokenOut: json.usage?.completion_tokens ?? 0,
  };
}

/** 按 aiRateLimitPerMin 排队等待发送槽位（服务端进程内，每用户独立窗口） */
async function acquireRateSlot(uid: string, limitPerMin: number): Promise<void> {
  while (true) {
    const now = Date.now();
    const window = (rateWindows.get(uid) ?? []).filter((t) => now - t < 60_000);
    const waitMs = nextRateSlotWaitMs(window, limitPerMin, now);
    if (waitMs <= 0) {
      window.push(now);
      rateWindows.set(uid, window);
      return;
    }
    await new Promise((r) => setTimeout(r, Math.min(waitMs, 500)));
  }
}

export async function callAi(uid: string, input: AiCallInput): Promise<CallAiResult> {
  const data = loadUserData(uid);
  const provider = data.providers.find((p) => p.id === input.providerId);
  if (!provider) {
    throw new Error("服务商不存在");
  }
  const limitPerMin = Math.max(0, Math.trunc(data.settings?.aiRateLimitPerMin ?? 0));
  await acquireRateSlot(uid, limitPerMin);
  const retryCount = Math.min(2, Math.max(0, Math.trunc(data.settings?.aiRetryCount ?? 0)));
  const maxAttempts = 1 + retryCount;
  const k = key(uid, input.taskKey, input.scope);
  const entry: InflightEntry = { canceled: false, controller: new AbortController() };
  inflight.set(k, entry);
  try {
    const result = await runWithRetry(
      async () => {
        const r = await attemptCallAi(data, provider, input, entry.controller);
        if (entry.canceled) throw new Error("AI 调用已取消");
        return r;
      },
      maxAttempts,
      ({ attempt, error, willRetry }) => {
        const friendly = toFriendlyAiError(error, provider);
        const suffix = willRetry ? `（第 ${attempt}/${maxAttempts} 次尝试失败，稍后自动重试）` : "";
        appendLog(data, input.taskKey, provider.name, input.modelId, 0, 0, "error", `${friendly.message}${suffix}`);
      },
      undefined,
      () => entry.canceled,
    );
    appendLog(data, input.taskKey, provider.name, input.modelId, result.tokenIn, result.tokenOut, "success", "");
    saveUserData(uid, data);
    return result;
  } catch (error) {
    if (!entry.canceled) {
      saveUserData(uid, data);
    }
    throw entry.canceled ? new Error("AI 调用已取消") : toFriendlyAiError(error, provider);
  } finally {
    inflight.delete(k);
  }
}

/** 连接测试：GET {baseUrl}/models */
export async function testProvider(uid: string, providerId: number): Promise<TestProviderResult> {
  const data = loadUserData(uid);
  const provider = data.providers.find((p) => p.id === providerId);
  if (!provider) {
    return { ok: false, message: "服务商不存在" };
  }
  const url = provider.baseUrl.replace(/\/$/, "") + "/models";
  let apiKey = "";
  try {
    apiKey = await decryptApiKey(data, provider.apiKey);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
  try {
    const res = await fetch(url, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      return { ok: true, message: `连接成功（HTTP ${res.status}）` };
    }
    return { ok: false, message: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** 拉取服务商可用模型列表（OpenAI 兼容 GET {baseUrl}/models） */
export async function listModels(uid: string, providerId: number): Promise<ListModelsResult> {
  const data = loadUserData(uid);
  const provider = data.providers.find((p) => p.id === providerId);
  if (!provider) {
    return { ok: false, message: "服务商不存在", models: [] };
  }
  const url = provider.baseUrl.replace(/\/$/, "") + "/models";
  let apiKey = "";
  try {
    apiKey = await decryptApiKey(data, provider.apiKey);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e), models: [] };
  }
  try {
    const res = await fetch(url, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return { ok: false, message: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`, models: [] };
    }
    const body = (await res.json()) as { data?: Array<{ id?: string }> } | Array<{ id?: string }>;
    const raw = Array.isArray(body) ? body : body.data ?? [];
    const models = [...new Set(raw.map((m) => m?.id).filter((id): id is string => typeof id === "string" && id.length > 0))].sort(
      (a, b) => a.localeCompare(b),
    );
    if (models.length === 0) {
      return { ok: false, message: "服务商返回的模型列表为空（可能不支持 /models 接口）", models: [] };
    }
    return { ok: true, message: `获取到 ${models.length} 个模型`, models };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e), models: [] };
  }
}
