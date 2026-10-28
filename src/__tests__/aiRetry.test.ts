import { describe, expect, it, vi } from "vitest";
import { isRetryableAiError, isRateLimitAiError, runWithRetry } from "../aiRetry";

describe("isRetryableAiError", () => {
  it("5xx 可重试", () => {
    expect(isRetryableAiError(new Error("AI 请求失败：HTTP 500 上游异常"))).toBe(true);
    expect(isRetryableAiError(new Error("AI 请求失败：HTTP 502"))).toBe(true);
  });

  it("429 可重试（速率限制）", () => {
    expect(isRetryableAiError(new Error("AI 请求失败：HTTP 429 Too Many Requests"))).toBe(true);
  });

  it("其他 4xx 不可重试", () => {
    expect(isRetryableAiError(new Error("AI 请求失败：HTTP 401 鉴权失败"))).toBe(false);
    expect(isRetryableAiError(new Error("AI 请求失败：HTTP 404 模型不存在"))).toBe(false);
    expect(isRetryableAiError(new Error("AI 请求失败：HTTP 422"))).toBe(false);
  });

  it("超时/网络层错误可重试", () => {
    expect(isRetryableAiError(new Error("Client.Timeout exceeded while awaiting headers"))).toBe(true);
    expect(isRetryableAiError(new Error("forwardProxy 失败: connection refused"))).toBe(true);
  });

  it("未知错误不可重试", () => {
    expect(isRetryableAiError(new Error("其他错误"))).toBe(false);
  });
});

describe("isRateLimitAiError", () => {
  it("429 判定", () => {
    expect(isRateLimitAiError(new Error("AI 请求失败：HTTP 429"))).toBe(true);
    expect(isRateLimitAiError(new Error("AI 请求失败：HTTP 500"))).toBe(false);
  });
});

describe("runWithRetry 退避", () => {
  it("429 使用加倍退避（4s×attempt），5xx 使用常规退避（2s×attempt）", async () => {
    const delay = vi.fn(async () => {});
    const call = vi
      .fn()
      .mockRejectedValueOnce(new Error("AI 请求失败：HTTP 429"))
      .mockRejectedValueOnce(new Error("AI 请求失败：HTTP 500"))
      .mockResolvedValue("ok");
    const onFail = vi.fn();
    const out = await runWithRetry(call, 3, onFail, delay);
    expect(out).toBe("ok");
    expect(delay).toHaveBeenNthCalledWith(1, 4000);
    expect(delay).toHaveBeenNthCalledWith(2, 4000);
  });

  it("不可重试错误立即抛出且不退避", async () => {
    const delay = vi.fn(async () => {});
    const call = vi.fn().mockRejectedValue(new Error("AI 请求失败：HTTP 401"));
    await expect(runWithRetry(call, 3, vi.fn(), delay)).rejects.toThrow("401");
    expect(call).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it("达到次数上限后抛出最后错误", async () => {
    const delay = vi.fn(async () => {});
    const call = vi.fn().mockRejectedValue(new Error("AI 请求失败：HTTP 429"));
    const onFail = vi.fn();
    await expect(runWithRetry(call, 2, onFail, delay)).rejects.toThrow("429");
    expect(call).toHaveBeenCalledTimes(2);
    expect(onFail).toHaveBeenCalledTimes(2);
    expect(onFail.mock.calls[0][0].willRetry).toBe(true);
    expect(onFail.mock.calls[1][0].willRetry).toBe(false);
  });

  describe("isCanceled 取消钩子", () => {
    it("循环开始即已取消：不再发起调用，直接抛取消错误", async () => {
      const call = vi.fn().mockResolvedValue("ok");
      await expect(runWithRetry(call, 3, vi.fn(), async () => {}, () => true)).rejects.toThrow("AI 调用已取消");
      expect(call).not.toHaveBeenCalled();
    });

    it("重试等待前发现取消：不重试，抛取消错误（而非原始错误）", async () => {
      const delay = vi.fn(async () => {});
      const call = vi.fn().mockRejectedValue(new Error("AI 请求失败：HTTP 500"));
      // 首次检查（循环头）未取消 → 发起调用；调用失败后取消 → 不应重试
      const checks = [false, true];
      let idx = 0;
      await expect(
        runWithRetry(call, 3, vi.fn(), delay, () => checks[idx++] ?? true),
      ).rejects.toThrow("AI 调用已取消");
      expect(call).toHaveBeenCalledTimes(1);
      expect(delay).not.toHaveBeenCalled();
    });

    it("未取消时行为不变", async () => {
      const call = vi
        .fn()
        .mockRejectedValueOnce(new Error("AI 请求失败：HTTP 500"))
        .mockResolvedValue("ok");
      const out = await runWithRetry(call, 2, vi.fn(), async () => {}, () => false);
      expect(out).toBe("ok");
    });
  });
});
