// AI 调用的纯函数工具：请求体构造 + 滑动窗口速率限制（宿主无关，三端共用）

/**
 * 构造 chat/completions 请求体：温度/最大输出 token 仅在显式设置时透传（null/缺失 = 不传）。
 * 抽为纯函数便于单测。
 */
export function buildChatPayload(
  modelId: string,
  messages: Array<{ role: string; content: string }>,
  modelRow: { temperature?: number | null; maxTokens?: number | null } | null | undefined,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { model: modelId, messages };
  if (modelRow?.temperature != null) {
    payload.temperature = modelRow.temperature;
  }
  if (modelRow?.maxTokens != null) {
    payload.max_tokens = modelRow.maxTokens;
  }
  return payload;
}

/**
 * 滑动窗口速率限制：返回需等待的毫秒数（0 = 立即可发）。
 * timestamps = 窗口内各次调用发起时间；limitPerMin 0/缺失 = 不限。
 */
export function nextRateSlotWaitMs(timestamps: number[], limitPerMin: number, now: number): number {
  if (!limitPerMin || limitPerMin <= 0) {
    return 0;
  }
  const recent = timestamps.filter((t) => now - t < 60_000);
  if (recent.length < limitPerMin) {
    return 0;
  }
  const oldest = Math.min(...recent);
  return 60_000 - (now - oldest) + 100;
}
