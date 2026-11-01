import { describe, expect, it } from "vitest";
import { llmHttpErrorMessage } from "../aiError";

describe("llmHttpErrorMessage", () => {
  it("401：不带响应体（防 key 回显落日志），给可操作指引", () => {
    const msg = llmHttpErrorMessage(401, '{"error":{"message":"Incorrect API key provided: sk-abc123wxyz. You can find your API key at https://platform.openai.com/account/api-keys"}}');
    expect(msg).toBe("LLM 请求失败: HTTP 401（API Key 无效或无权限，请到「模型配置」重新填写 API Key）");
    expect(msg).not.toContain("sk-abc123wxyz");
    expect(msg).not.toContain("Incorrect API key");
  });

  it("403：同样不带响应体", () => {
    const msg = llmHttpErrorMessage(403, "secret-body-content");
    expect(msg).toBe("LLM 请求失败: HTTP 403（API Key 无效或无权限，请到「模型配置」重新填写 API Key）");
    expect(msg).not.toContain("secret-body-content");
  });

  it("500：保留截断错误体（200 字符）供排障", () => {
    const body = "x".repeat(500);
    const msg = llmHttpErrorMessage(500, body);
    expect(msg).toBe(`LLM 请求失败: HTTP 500 ${"x".repeat(200)}`);
  });

  it("429：保留截断错误体", () => {
    const msg = llmHttpErrorMessage(429, "rate limited");
    expect(msg).toBe("LLM 请求失败: HTTP 429 rate limited");
  });

  it("错误体为空：消息无尾部悬挂空格", () => {
    expect(llmHttpErrorMessage(502, "")).toBe("LLM 请求失败: HTTP 502");
  });
});
