import { describe, expect, it, vi } from "vitest";
import { setBridge } from "../../bridge";
import type { StudyBridge } from "../../bridge/types";
import { stripThinking, isRetryableError, callAiWithRetry, AiCanceledError } from "../ai";
import type { CallAiInput } from "../ai";

// think 标签用拼接构造（工具链路会把源码中的原始标签串转写成省略号）
const OPEN = "<" + "think>";
const CLOSE = "</" + "think>";
const OPEN_UP = "<" + "THINK>";
const CLOSE_UP = "</" + "THINK>";

describe("stripThinking 剥离模型内联思考块", () => {
  it("无思考块：原样返回（仅去首尾空白）", () => {
    expect(stripThinking("答案是 E")).toBe("答案是 E");
    expect(stripThinking("  答案是 E\n")).toBe("答案是 E");
  });

  it("思考块在正文前：只留正文", () => {
    expect(stripThinking(OPEN + "let me think" + CLOSE + "好的，选 E。")).toBe("好的，选 E。");
  });

  it("多个思考块：全部剥离", () => {
    expect(stripThinking(OPEN + "a" + CLOSE + "答案一" + OPEN + "b" + CLOSE + "答案二")).toBe("答案一答案二");
  });

  it("思考块在正文后：只留正文", () => {
    expect(stripThinking("选 E。" + OPEN + "afterthought" + CLOSE)).toBe("选 E。");
  });

  it("标签大小写不敏感", () => {
    expect(stripThinking(OPEN_UP + "a" + CLOSE_UP + "正文")).toBe("正文");
  });

  it("思考块跨多行", () => {
    expect(stripThinking(OPEN + "\nline1\nline2\n" + CLOSE + "正文")).toBe("正文");
  });

  it("未闭合的思考块（响应被截断）：丢弃思考部分、保留前面的正文", () => {
    expect(stripThinking("正文部分" + OPEN + "未闭合的思考")).toBe("正文部分");
  });

  it("未闭合且前面无正文：返回空串", () => {
    expect(stripThinking(OPEN + "只思考没回答")).toBe("");
  });

  it("整段都是思考块：返回空串（由调用方按「AI 未返回回答」处理）", () => {
    expect(stripThinking(OPEN + "只有思考" + CLOSE)).toBe("");
  });

  it("空串：返回空串", () => {
    expect(stripThinking("")).toBe("");
  });
});

describe("isRetryableError 可重试判定", () => {
  it("429/限流/5xx/超时 → 可重试（含插件真实错误文案）", () => {
    expect(isRetryableError(new Error("LLM 请求失败: HTTP 429 rate_limit_error"))).toBe(true);
    expect(isRetryableError(new Error("HTTP 500 internal"))).toBe(true);
    expect(isRetryableError(new Error("request timeout"))).toBe(true);
    expect(isRetryableError(new Error("请求超时"))).toBe(true);
  });
  it("422 内容敏感过滤/404 → 不可重试", () => {
    expect(isRetryableError(new Error("LLM 请求失败: HTTP 422 input new_sensitive"))).toBe(false);
    expect(isRetryableError(new Error("HTTP 404 not found"))).toBe(false);
  });
});

describe("callAiWithRetry 退避重试", () => {
  const input: CallAiInput = { providerId: 1, modelId: "m1", taskKey: "kp_relink", messages: [] };
  function stubCallAi(impl: (n: number) => Promise<{ content: string; tokenIn: number; tokenOut: number }>) {
    let n = 0;
    setBridge({ callAi: async () => impl(++n) } as unknown as StudyBridge);
    return () => n;
  }

  it("429 失败两次后成功：按传入 delays 重试返回成功", async () => {
    const count = stubCallAi(async (n) => {
      if (n < 3) throw new Error("HTTP 429 Too Many Requests");
      return { content: "ok", tokenIn: 1, tokenOut: 1 };
    });
    const res = await callAiWithRetry(input, [1, 1, 1]);
    expect(res.content).toBe("ok");
    expect(count()).toBe(3);
  });

  it("不可重试错误：不重试直接抛出", async () => {
    const count = stubCallAi(async () => {
      throw new Error("HTTP 422 content filtered");
    });
    await expect(callAiWithRetry(input, [1, 1, 1])).rejects.toThrow("HTTP 422 content filtered");
    expect(count()).toBe(1);
  });

  it("AiCanceledError：不重试直接抛出", async () => {
    const count = stubCallAi(async () => {
      throw new AiCanceledError();
    });
    await expect(callAiWithRetry(input, [1, 1, 1])).rejects.toBeInstanceOf(AiCanceledError);
    expect(count()).toBe(1);
  });

  it("重试次数耗尽：抛出最后错误", async () => {
    const count = stubCallAi(async () => {
      throw new Error("HTTP 429 Too Many Requests");
    });
    await expect(callAiWithRetry(input, [1, 1, 1])).rejects.toThrow("HTTP 429");
    expect(count()).toBe(4); // 初始 1 次 + 3 次重试
  });

  it("默认 delays：不传 delays 时也可成功（不触发真实等待即通过）", async () => {
    const count = stubCallAi(async () => ({ content: "ok", tokenIn: 1, tokenOut: 1 }));
    const res = await callAiWithRetry(input);
    expect(res.content).toBe("ok");
    expect(count()).toBe(1);
  });

  it("isAborted 一开始即 true：不调 AI，直接抛 AiCanceledError", async () => {
    const count = stubCallAi(async () => ({ content: "ok", tokenIn: 1, tokenOut: 1 }));
    await expect(callAiWithRetry(input, [1, 1], () => true)).rejects.toBeInstanceOf(AiCanceledError);
    expect(count()).toBe(0);
  });

  it("退避期间取消：无需等满退避时长，约一个分片内抛出", async () => {
    let aborted = false;
    const count = stubCallAi(async () => {
      throw new Error("HTTP 429 Too Many Requests");
    });
    const t0 = Date.now();
    setTimeout(() => { aborted = true; }, 100);
    await expect(callAiWithRetry(input, [60000], () => aborted)).rejects.toBeInstanceOf(AiCanceledError);
    expect(Date.now() - t0).toBeLessThan(3000); // 远小于 60s 退避
    expect(count()).toBe(1);
  });
});
