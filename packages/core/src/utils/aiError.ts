/**
 * LLM HTTP 错误 → 用户消息（两端共用：siyuan forwardProxy / fnos fetch）。
 * 401/403（key 无效/无权限/已被撤销）：OpenAI 系响应体会回显部分 key
 * （如 `Incorrect API key provided: sk-abc…wxyz`），而该消息会落调用日志并在 UI 展示，
 * 故不带响应体，只给可操作指引；其他状态码保留截断错误体供排障。
 */
export function llmHttpErrorMessage(status: number, body: string): string {
  if (status === 401 || status === 403) {
    return `LLM 请求失败: HTTP ${status}（API Key 无效或无权限，请到「模型配置」重新填写 API Key）`;
  }
  return `LLM 请求失败: HTTP ${status} ${body.slice(0, 200)}`.trim();
}
