// AI 调用的重试判定与退避执行（纯函数，供 src/index.ts 使用，便于单测）

/**
 * 判断 AI 调用错误是否值得自动重试：超时 / 5xx / 429 速率限制 / 网络层错误。
 * 4xx（鉴权、模型不存在等）重试无意义，返回 false。
 */
export function isRetryableAiError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (/Client\.Timeout exceeded|context deadline exceeded|awaiting headers/i.test(message)) {
    return true;
  }
  const m = message.match(/HTTP (\d{3})/);
  if (m) {
    const code = Number(m[1]);
    return code >= 500 || code === 429;
  }
  if (/forwardProxy 失败/.test(message) && /(connection|refused|reset|EOF|unreachable|no such host|timed out|network)/i.test(message)) {
    return true;
  }
  return false;
}

/** 429 速率限制：重试需要更长的退避（等待服务端限流窗口释放） */
export function isRateLimitAiError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /HTTP 429/i.test(message);
}

export interface AiRetryFailInfo {
  /** 第几次尝试（从 1 开始） */
  attempt: number;
  error: unknown;
  /** 是否还会重试（可重试且未达次数上限） */
  willRetry: boolean;
}

const defaultDelay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 重试执行：失败且可重试时等待 2s×尝试次数后重试（429 速率限制加倍为 4s×尝试次数），
 * 每次失败都回调 onFail（供记日志）。maxAttempts = 1 + 重试次数；不可重试的错误立即抛出。
 * isCanceled 为 true 时（调用方标记取消）立即抛「AI 调用已取消」，不再发起/重试。
 */
export async function runWithRetry<T>(
  call: () => Promise<T>,
  maxAttempts: number,
  onFail: (info: AiRetryFailInfo) => void,
  delay?: (ms: number) => Promise<void>,
  isCanceled?: () => boolean,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    if (isCanceled?.()) {
      throw new Error("AI 调用已取消");
    }
    try {
      return await call();
    } catch (error) {
      if (isCanceled?.()) {
        throw new Error("AI 调用已取消");
      }
      const willRetry = attempt < maxAttempts && isRetryableAiError(error);
      onFail({ attempt, error, willRetry });
      if (!willRetry) {
        throw error;
      }
      const baseMs = isRateLimitAiError(error) ? 4000 : 2000;
      await (delay ?? defaultDelay)(baseMs * attempt);
    }
  }
}
