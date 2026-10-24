import { Plugin, showMessage, openTab, fetchSyncPost, getFrontend } from "siyuan";
import { createEmptyData } from "./data";
import type { AppData, CallLog } from "./data";
import { decryptApiKey, migrateProviderKeys } from "./crypto";

const DATA_STORAGE = "data";
const TAB_TYPE = "study_tab";

interface CallAiMessage {
  role: string;
  content: string;
}

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
 * 判断 AI 调用错误是否值得自动重试：超时 / 5xx / 网络层错误。
 * 4xx（鉴权、模型不存在等）重试无意义，返回 false。
 */
export function isRetryableAiError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (/Client\.Timeout exceeded|context deadline exceeded|awaiting headers/i.test(message)) {
    return true;
  }
  const m = message.match(/HTTP (\d{3})/);
  if (m) {
    return Number(m[1]) >= 500;
  }
  if (/forwardProxy 失败/.test(message) && /(connection|refused|reset|EOF|unreachable|no such host|timed out|network)/i.test(message)) {
    return true;
  }
  return false;
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
 * 重试执行：失败且可重试时等待 2s×尝试次数后重试，每次失败都回调 onFail（供记日志）。
 * maxAttempts = 1 + 重试次数；不可重试的错误立即抛出。
 */
export async function runWithRetry<T>(
  call: () => Promise<T>,
  maxAttempts: number,
  onFail: (info: AiRetryFailInfo) => void,
  delay?: (ms: number) => Promise<void>,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      const willRetry = attempt < maxAttempts && isRetryableAiError(error);
      onFail({ attempt, error, willRetry });
      if (!willRetry) {
        throw error;
      }
      await (delay ?? defaultDelay)(2000 * attempt);
    }
  }
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

interface CallAiInput {
  providerId: number;
  modelId: string;
  messages: CallAiMessage[];
  taskKey: string;
}

interface CallAiResult {
  content: string;
  tokenIn: number;
  tokenOut: number;
}

interface TestProviderResult {
  ok: boolean;
  message: string;
}

interface ListModelsResult extends TestProviderResult {
  models: string[];
}

// 暴露给前端（同渲染进程直接挂载）的数据/内核 API
interface StudyApi {
  getData(): AppData;
  saveData(data: AppData): Promise<{ code: number; msg?: string }>;
  callAi(input: CallAiInput): Promise<CallAiResult>;
  testProvider(providerId: number): Promise<TestProviderResult>;
  listModels(providerId: number): Promise<ListModelsResult>;
  showMessage(message: string, timeout?: number, type?: "info" | "error"): void;
  ensureNotebook(name: string): Promise<string>;
  createSiyuanDoc(markdown: string, path: string, notebook: string): Promise<{ id: string }>;
  removeSiyuanDoc(id: string): Promise<void>;
  updateSiyuanDoc(id: string, markdown: string): Promise<void>;
  getSiyuanDocMarkdown(id: string): Promise<string | null>;
  renameSiyuanDoc(id: string, name: string): Promise<void>;
  removeAsset(assetPath: string): Promise<void>;
  ocrAsset(assetPath: string): Promise<string>;
}

declare global {
  interface Window {
    siyuanAiStudy: StudyApi;
    AiStudyApp: {
      mount(el: Element): void;
      unmount(): void;
    };
  }
}

interface ForwardProxyResponse {
  code: number;
  msg: string;
  data: {
    url: string;
    status: number;
    contentType: string;
    body: string;
    bodyEncoding: string;
    headers: Record<string, Array<string> | null> | null;
  } | null;
}

// 经思源内核 forwardProxy 转发外部请求（绕过 CORS，timeout 单位为毫秒）
async function forwardProxyRequest(input: {
  url: string;
  method: string;
  headers: Array<Record<string, string>>;
  payload?: string;
  timeout?: number;
}): Promise<ForwardProxyResponse> {
  return (await fetchSyncPost("/api/network/forwardProxy", {
    url: input.url,
    method: input.method,
    headers: input.headers,
    payload: input.payload ?? "",
    contentType: "application/json",
    timeout: input.timeout ?? 60000,
  })) as ForwardProxyResponse;
}

// ===== .sy 块树 → markdown 还原（思源 spec 格式；用于对话文档同步时读取当前内容） =====
interface SyNode {
  Type?: string;
  HeadingLevel?: number;
  Data?: string;
  TextMarkType?: string;
  TextMarkTextContent?: string;
  CodeBlockInfo?: string;
  ListData?: { Typ?: number; Num?: number };
  TaskListItemChecked?: boolean;
  Properties?: { title?: string };
  Children?: SyNode[];
}

function safeJsonParse(text: string): SyNode | null {
  try {
    const v = JSON.parse(text) as unknown;
    return (v && typeof v === "object" ? v : null) as SyNode | null;
  } catch {
    return null;
  }
}

function b64Decode(v: string | undefined): string {
  if (!v) return "";
  try {
    return Buffer.from(v, "base64").toString("utf8");
  } catch {
    return v;
  }
}

function htmlUnescape(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** 行内节点（文本/标记/公式/图片）→ markdown */
function syInline(nodes: SyNode[] | undefined): string {
  let out = "";
  for (const n of nodes ?? []) {
    switch (n.Type) {
      case "NodeText":
        out += htmlUnescape(n.Data ?? "");
        break;
      case "NodeTextMark": {
        const raw = n.Data != null ? n.Data : n.TextMarkTextContent;
        const inner = raw != null ? htmlUnescape(raw) : syInline(n.Children);
        const t = n.TextMarkType;
        if (t === "strong") out += `**${inner}**`;
        else if (t === "em") out += `*${inner}*`;
        else if (t === "del") out += `~~${inner}~~`;
        else if (t === "code") out += `\`${inner}\``;
        else if (t === "link") out += `[${inner}]${syLinkDest(n.Children)}`;
        else out += inner;
        break;
      }
      case "NodeMath":
      case "NodeInlineMath":
        out += `$${n.Data ?? ""}$`;
        break;
      case "NodeImage":
        out += `![${syLinkText(n.Children)}]${syLinkDest(n.Children)}`;
        break;
      default:
        break;
    }
  }
  return out;
}

function syLinkText(children: SyNode[] | undefined): string {
  const n = (children ?? []).find((c) => c.Type === "NodeLinkText");
  return n ? htmlUnescape(n.Data ?? "") : "";
}

function syLinkDest(children: SyNode[] | undefined): string {
  const n = (children ?? []).find((c) => c.Type === "NodeLinkDest");
  return n && n.Data ? `(${htmlUnescape(n.Data)})` : "";
}

function syListItem(item: SyNode, depth: number): string {
  const pad = "  ".repeat(depth);
  const kids = item.Children ?? [];
  const taskMarker = kids.find((c) => c.Type === "NodeTaskListItemMarker");
  const para = kids.find((c) => c.Type === "NodeParagraph");
  const nested = kids.filter((c) => c.Type === "NodeList");
  const text = para ? syInline(para.Children) : "";
  let prefix: string;
  if (taskMarker) prefix = taskMarker.TaskListItemChecked === true ? "- [x] " : "- [ ] ";
  else if (item.ListData?.Typ === 1) prefix = `${item.ListData?.Num ?? ""}. `;
  else prefix = "- ";
  let out = pad + prefix + text;
  for (const nl of nested) {
    out += "\n" + (nl.Children ?? []).map((it) => syListItem(it, depth + 1)).join("\n");
  }
  return out;
}

function syBlock(n: SyNode): string {
  const kids = (n.Children ?? []).filter((c) => c.Type !== "NodeAttr");
  switch (n.Type) {
    case "NodeHeading": {
      const level = Math.min(Math.max(n.HeadingLevel ?? 1, 1), 6);
      const text = syInline(kids).trim();
      return text ? `${"#".repeat(level)} ${text}` : "";
    }
    case "NodeParagraph":
      return syInline(kids).trim();
    case "NodeBlockquote": {
      const inner = kids
        .filter((c) => c.Type !== "NodeBlockquoteMarker")
        .map((c) => syBlock(c))
        .filter(Boolean);
      return inner.map((l) => l.split("\n").map((x) => `> ${x}`).join("\n")).join("\n");
    }
    case "NodeList":
      return kids.filter((c) => c.Type === "NodeListItem").map((it) => syListItem(it, 0)).join("\n");
    case "NodeCodeBlock": {
      const info = kids.find((c) => c.Type === "NodeCodeBlockFenceInfoMarker");
      const code = kids.find((c) => c.Type === "NodeCodeBlockCode");
      const lang = b64Decode(info?.CodeBlockInfo).trim();
      return "```" + lang + "\n" + (code?.Data ?? "") + "```";
    }
    default:
      return syInline(kids).trim();
  }
}

function syTreeToMarkdown(tree: SyNode): string {
  const title = (tree.Properties?.title ?? "").trim();
  const children = (tree.Children ?? []).filter((n) => n.Type && n.Type !== "NodeAttr");
  // 首个 h1 与文档标题等价（思源约定），避免重复
  if (children[0]?.Type === "NodeHeading" && children[0].HeadingLevel === 1) {
    children.shift();
  }
  const body = children.map((n) => syBlock(n)).filter((s) => s.trim() !== "").join("\n\n");
  return title ? (body ? `# ${title}\n\n${body}` : `# ${title}`) : body;
}

export default class AiStudyPlugin extends Plugin {
  /** 近 60s 内 AI 调用发起时间戳（滑动窗口，仅内存） */
  private rateWindow: number[] = [];
  private rateWaitNotified = false;

  async onload() {
    this.exposeApi();
    await this.initData();
    this.registerTab();
    this.selfHealTab();
  }

  async onLayoutReady() {
    this.addIcons(`<symbol id="iconAiStudy" viewBox="0 0 32 32">
<path d="M16 4l11 6v12l-11 6-11-6V10l11-6z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>
<path d="M16 12.5L27 6.5M16 12.5V28M16 12.5L5 6.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>
</symbol>`);

    this.addTopBar({
      icon: "iconAiStudy",
      title: this.displayName || "AI 智能学习",
      position: "right",
      callback: () => this.openStudyTab(),
    });
  }

  // 覆盖内核默认行为：petal 数据文件变更不再触发插件整体重载
  // （变更本就来自我们自己的写入；重载会重写数据文件，3.8.8 下形成无限循环）
  onDataChanged() {
    // 有意留空
  }

  onunload() {
    // 卸载时清理已挂载的前端应用，避免 Vue 实例泄漏
    window.AiStudyApp?.unmount();
  }

  // 暴露数据与内核 API 到全局，供直接挂载的前端调用
  private exposeApi() {
    window.siyuanAiStudy = {
      getData: () => this.data[DATA_STORAGE] ?? createEmptyData(),
      saveData: async (data: AppData) => {
        const res = await this.commitData(data);
        // 透传内核真实结果；兼容 SiYuan Plugin.saveData 返回 any：
        // 缺失 code 按成功处理，与原行为一致；明确拿到数字 code 且非 0 才报错
        const r = (res ?? {}) as { code?: number; msg?: string };
        const code = typeof r.code === "number" ? r.code : 0;
        return { code, msg: r.msg };
      },
      callAi: async (input: CallAiInput) => {
        return await this.handleCallAi(input);
      },
      testProvider: async (providerId: number) => {
        return await this.handleTestProvider(providerId);
      },
      listModels: async (providerId: number) => {
        return await this.handleListModels(providerId);
      },
      showMessage: (message: string, timeout = 4000, type: "info" | "error" = "info") => {
        showMessage(message, timeout, type);
      },
      ensureNotebook: async (name: string) => {
        return await this.handleEnsureNotebook(name);
      },
      createSiyuanDoc: async (markdown: string, path: string, notebook: string) => {
        return await this.handleCreateSiyuanDoc(markdown, path, notebook);
      },
      removeSiyuanDoc: async (id: string) => {
        await this.handleRemoveSiyuanDoc(id);
      },
      updateSiyuanDoc: async (id: string, markdown: string) => {
        await this.handleUpdateSiyuanDoc(id, markdown);
      },
      getSiyuanDocMarkdown: async (id: string) => {
        return await this.handleGetSiyuanDocMarkdown(id);
      },
      renameSiyuanDoc: async (id: string, name: string) => {
        await this.handleRenameSiyuanDoc(id, name);
      },
      removeAsset: async (assetPath: string) => {
        await this.handleRemoveAsset(assetPath);
      },
      ocrAsset: async (assetPath: string) => {
        return await this.handleOcrAsset(assetPath);
      },
    };
  }

  // 获取或创建思源笔记本，返回笔记本 id
  private async handleEnsureNotebook(name: string): Promise<string> {
    const list = (await fetchSyncPost("/api/notebook/lsNotebooks", {})) as {
      data?: { notebooks?: Array<{ id: string; name: string } | null> | null };
    };
    const existing = list.data?.notebooks?.find((n) => n?.name === name);
    if (existing) {
      return existing.id;
    }
    const created = (await fetchSyncPost("/api/notebook/createNotebook", { name })) as {
      data?: { notebook?: { id: string } | null };
    };
    const id = created.data?.notebook?.id ?? "";
    if (!id) {
      throw new Error("创建笔记本失败");
    }
    return id;
  }

  // 在指定笔记本路径下创建 markdown 文档，返回文档 id
  private async handleCreateSiyuanDoc(
    markdown: string,
    path: string,
    notebook: string,
  ): Promise<{ id: string }> {
    const res = (await fetchSyncPost("/api/filetree/createDocWithMd", {
      notebook,
      path,
      markdown,
    })) as { code: number; data?: string | null; msg?: string };
    if (res.code !== 0 || !res.data) {
      throw new Error(`创建思源文档失败: ${res.msg ?? "未知错误"}`);
    }
    return { id: res.data };
  }

  private async handleRemoveSiyuanDoc(id: string): Promise<void> {
    const res = (await fetchSyncPost("/api/filetree/removeDocByID", { id })) as {
      code: number;
      msg?: string;
    };
    if (res.code !== 0) {
      throw new Error(`删除思源文档失败: ${res.msg ?? "未知错误"}`);
    }
  }

  // 更新思源文档的 markdown 内容（用于资料重新解析后同步更新笔记）
  private async handleUpdateSiyuanDoc(id: string, markdown: string): Promise<void> {
    const doc = (await fetchSyncPost("/api/filetree/getDoc", { id })) as {
      data?: { rootID?: string };
    };
    const rootId = doc.data?.rootID;
    if (!rootId) {
      throw new Error("获取文档根块失败");
    }
    await fetchSyncPost("/api/block/updateBlock", {
      id: rootId,
      data: markdown,
      dataType: "markdown",
    });
  }

  /**
   * 读取文档当前 markdown：getDoc 定位 .sy 文件 → /api/file/getFile 读原文 → 解析块树还原 markdown。
   * 文件即数据源（内核每次编辑都会落盘），不依赖文档是否载入内核内存；失败返回 null 由调用方兜底。
   */
  private async handleGetSiyuanDocMarkdown(id: string): Promise<string | null> {
    const doc = (await fetchSyncPost("/api/filetree/getDoc", { id })) as {
      code: number;
      data?: { path?: string; box?: string } | null;
    };
    const relPath = doc.data?.path;
    const box = doc.data?.box ?? "";
    if (!relPath) return null;
    // path 以 /<notebookId>/ 开头时为全路径，否则相对笔记本根
    const fileRel = relPath.startsWith(`/${box}/`)
      ? `/data${relPath}`
      : `/data/${box}${relPath.startsWith("/") ? "" : "/"}${relPath}`;
    const res = await fetchSyncPost("/api/file/getFile", { path: fileRel });
    const tree = (typeof res === "string" ? safeJsonParse(res) : res) as SyNode | null;
    if (!tree || tree.Type !== "NodeDocument") return null;
    return syTreeToMarkdown(tree);
  }

  // 重命名思源文档（用于课程/章节改名后同步落库文档名）
  private async handleRenameSiyuanDoc(id: string, name: string): Promise<void> {
    const res = (await fetchSyncPost("/api/filetree/renameDocByID", { id, title: name })) as {
      code: number;
      msg?: string;
    };
    if (res.code !== 0) {
      throw new Error(`重命名思源文档失败: ${res.msg ?? "未知错误"}`);
    }
  }

  // 删除资源文件（内核仅允许删除未被任何文档引用的资源，被引用时抛错由调用方兜底）
  private async handleRemoveAsset(assetPath: string): Promise<void> {
    const res = (await fetchSyncPost("/api/asset/removeUnusedAsset", { path: assetPath })) as {
      code: number;
      msg?: string;
    };
    if (res.code !== 0) {
      throw new Error(`删除资源文件失败: ${res.msg ?? "未知错误"}`);
    }
  }

  // 图片 OCR（内核 PaddleOCR），返回识别文本；内核不支持 OCR 时抛错由调用方兜底
  private async handleOcrAsset(assetPath: string): Promise<string> {
    const res = (await fetchSyncPost("/api/asset/ocr", { path: assetPath })) as {
      code: number;
      msg?: string;
      data?: { text?: string } | null;
    };
    if (res.code !== 0) {
      throw new Error(`OCR 识别失败: ${res.msg ?? "未知错误"}`);
    }
    return res.data?.text ?? "";
  }

  private getData(): AppData {
    return this.data[DATA_STORAGE] ?? createEmptyData();
  }

  private async persist(data: AppData) {
    await this.commitData(data);
  }

  /** 统一写入口：先迁移明文 API Key 为密文，再落盘 */
  private async commitData(data: AppData) {
    await migrateProviderKeys(data);
    this.data[DATA_STORAGE] = data;
    return await this.saveData(DATA_STORAGE, data);
  }

  private appendLog(
    data: AppData,
    taskKey: string,
    providerName: string,
    modelName: string,
    tokenIn: number,
    tokenOut: number,
    status: string,
    errorMsg: string,
  ) {
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

  /** 单次 AI 调用（不含重试），失败抛原始错误 */
  private async attemptCallAi(
    data: AppData,
    provider: { id: number; baseUrl: string; apiKey: string; timeout?: number },
    input: CallAiInput,
  ): Promise<CallAiResult> {
    const url = provider.baseUrl.replace(/\/$/, "") + "/chat/completions";
    const modelRow = data.models.find((m) => m.providerId === provider.id && m.modelId === input.modelId);
    const payload = buildChatPayload(input.modelId, input.messages, modelRow);
    const apiKey = await decryptApiKey(data, provider.apiKey);
    const res = await forwardProxyRequest({
      url,
      method: "POST",
      headers: [
        { Authorization: `Bearer ${apiKey}` },
        { "Content-Type": "application/json" },
      ],
      payload: JSON.stringify(payload),
      timeout: (provider.timeout || 60) * 1000,
    });
    if (res.code !== 0 || !res.data) {
      throw new Error(`forwardProxy 失败: ${res.msg}`);
    }
    if (res.data.status < 200 || res.data.status >= 300) {
      throw new Error(`LLM 请求失败: HTTP ${res.data.status} ${res.data.body}`);
    }
    const body = JSON.parse(res.data.body) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = body.choices?.[0]?.message?.content ?? "";
    const tokenIn = body.usage?.prompt_tokens ?? 0;
    const tokenOut = body.usage?.completion_tokens ?? 0;
    return { content, tokenIn, tokenOut };
  }

  /** 按 aiRateLimitPerMin 排队等待发送槽位；返回是否发生了等待 */
  private async acquireRateSlot(limitPerMin: number): Promise<boolean> {
    let waited = false;
    while (true) {
      const now = Date.now();
      this.rateWindow = this.rateWindow.filter((t) => now - t < 60_000);
      const waitMs = nextRateSlotWaitMs(this.rateWindow, limitPerMin, now);
      if (waitMs <= 0) {
        this.rateWindow.push(now);
        return waited;
      }
      if (!waited) {
        this.rateWaitNotified = false;
      }
      if (!this.rateWaitNotified) {
        showMessage(`AI 请求已达速率上限（${limitPerMin} 次/分钟），排队等待中…`, 2000);
        this.rateWaitNotified = true;
      }
      // 分片等待，避免长时间阻塞主线程事件
      const chunk = Math.min(waitMs, 500);
      await new Promise((r) => setTimeout(r, chunk));
      waited = true;
    }
  }

  private async handleCallAi(input: CallAiInput): Promise<CallAiResult> {
    const data = this.getData();
    const provider = data.providers.find((p) => p.id === input.providerId);
    if (!provider) {
      throw new Error("服务商不存在");
    }
    const limitPerMin = Math.max(0, Math.trunc(data.settings?.aiRateLimitPerMin ?? 0));
    await this.acquireRateSlot(limitPerMin);
    const retryCount = Math.min(2, Math.max(0, Math.trunc(data.settings?.aiRetryCount ?? 0)));
    const maxAttempts = 1 + retryCount;
    let result: CallAiResult;
    try {
      result = await runWithRetry(
        () => this.attemptCallAi(data, provider, input),
        maxAttempts,
        ({ attempt, error, willRetry }) => {
          const friendly = this.toFriendlyAiError(error, provider);
          const suffix = willRetry ? `（第 ${attempt}/${maxAttempts} 次尝试失败，稍后自动重试）` : "";
          this.appendLog(data, input.taskKey, provider.name, input.modelId, 0, 0, "error", `${friendly.message}${suffix}`);
        },
      );
    } catch (error) {
      // 最后一次失败的日志已在 onFail 中记录
      await this.persist(data);
      throw this.toFriendlyAiError(error, provider);
    }
    this.appendLog(data, input.taskKey, provider.name, input.modelId, result.tokenIn, result.tokenOut, "success", "");
    await this.persist(data);
    return result;
  }

  // 识别 forwardProxy 的超时类错误（Go http client 超时 / context 截止），转换为用户可操作的提示
  private toFriendlyAiError(error: unknown, provider: { name: string; timeout?: number }): Error {
    const message = error instanceof Error ? error.message : String(error);
    if (/Client\.Timeout exceeded|context deadline exceeded|awaiting headers/i.test(message)) {
      return new Error(
        `AI 请求超时（超过「${provider.name}」服务商超时设置 ${provider.timeout || 60} 秒）。` +
          "生成学习计划等任务输出较长、推理模型思考耗时，建议到「模型配置 → 编辑服务商」把超时调大到 300 秒以上后重试",
      );
    }
    return error instanceof Error ? error : new Error(message);
  }

  private async handleTestProvider(providerId: number): Promise<TestProviderResult> {
    const data = this.getData();
    const provider = data.providers.find((p) => p.id === providerId);
    if (!provider) {
      return { ok: false, message: "服务商不存在" };
    }
    const url = provider.baseUrl.replace(/\/$/, "") + "/models";
    const apiKey = await decryptApiKey(data, provider.apiKey);
    try {
      const res = await forwardProxyRequest({
        url,
        method: "GET",
        headers: [{ Authorization: `Bearer ${apiKey}` }],
        timeout: 15000,
      });
      if (res.code !== 0 || !res.data) {
        return { ok: false, message: res.msg };
      }
      if (res.data.status >= 200 && res.data.status < 300) {
        return { ok: true, message: `连接成功（HTTP ${res.data.status}）` };
      }
      return { ok: false, message: `HTTP ${res.data.status}: ${res.data.body.slice(0, 200)}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, message };
    }
  }

  // 拉取服务商可用模型列表（OpenAI 兼容 GET {baseUrl}/models）
  private async handleListModels(providerId: number): Promise<ListModelsResult> {
    const data = this.getData();
    const provider = data.providers.find((p) => p.id === providerId);
    if (!provider) {
      return { ok: false, message: "服务商不存在", models: [] };
    }
    const url = provider.baseUrl.replace(/\/$/, "") + "/models";
    const apiKey = await decryptApiKey(data, provider.apiKey);
    try {
      const res = await forwardProxyRequest({
        url,
        method: "GET",
        headers: [{ Authorization: `Bearer ${apiKey}` }],
        timeout: 15000,
      });
      if (res.code !== 0 || !res.data) {
        return { ok: false, message: "连接失败", models: [] };
      }
      if (res.data.status < 200 || res.data.status >= 300) {
        return { ok: false, message: `HTTP ${res.data.status}: ${res.data.body.slice(0, 200)}`, models: [] };
      }
      const body = JSON.parse(res.data.body) as
        | { data?: Array<{ id?: string }> }
        | Array<{ id?: string }>;
      const raw = Array.isArray(body) ? body : body.data ?? [];
      const models = [
        ...new Set(
          raw
            .map((m) => m?.id)
            .filter((id): id is string => typeof id === "string" && id.length > 0),
        ),
      ].sort((a, b) => a.localeCompare(b));
      if (models.length === 0) {
        return { ok: false, message: "服务商返回的模型列表为空（可能不支持 /models 接口）", models: [] };
      }
      return { ok: true, message: `获取到 ${models.length} 个模型`, models };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, message, models: [] };
    }
  }

  // 注册自定义页签：动态加载前端 bundle 并直接 mount 到页签元素
  private registerTab() {
    const pluginName = this.name;
    this.addTab({
      type: TAB_TYPE,
      init() {
        // 幂等：bundle 已加载过（内核重放页签 init / 插件重载后）直接挂载，不重复插入 script 二次执行
        if (window.AiStudyApp) {
          window.AiStudyApp.mount(this.element);
          return;
        }
        const frontend = getFrontend();
        const isBrowser = frontend === "browser-desktop" || frontend === "browser-mobile";
        const dataDir = window.siyuan.config?.system?.dataDir;
        const src = isBrowser
          ? `/plugins/${pluginName}/web/index.js`
          : `file://${dataDir}/plugins/${pluginName}/web/index.js`;
        const script = document.createElement("script");
        script.src = src;
        script.onload = () => {
          window.AiStudyApp?.mount(this.element);
        };
        script.onerror = () => {
          console.error("[siyuan-ai-study] 加载前端资源失败:", src);
        };
        document.head.appendChild(script);
      },
    });
  }

  /** 定位本插件页签的前端挂载面板（页签栏项与内容面板共享同一 data-id） */
  private findTabPanel(): Element | null {
    const uses = Array.from(document.querySelectorAll("li.item use"));
    const use = uses.find((u) => (u.getAttribute("href") ?? u.getAttribute("xlink:href")) === "#iconAiStudy");
    const li = use?.closest("li.item") as HTMLElement | null;
    const id = li?.dataset.id;
    if (!id) return null;
    return Array.from(document.querySelectorAll(`[data-id="${id}"]`)).find((el) => el.classList.contains("fn__flex-1")) ?? null;
  }

  /**
   * 自愈：内核整体重载插件（onunload 已 unmount）后页签仍在但不会重跑 init，面板会永久为空；
   * 新开页面内核延迟恢复页签时也可能早于 onload。onload 后短时间窗内轮询，面板存在且无内容则补 mount。
   */
  private selfHealTab() {
    for (const delay of [500, 1500, 3000, 6000]) {
      setTimeout(() => {
        const panel = this.findTabPanel();
        if (!panel || panel.querySelector(".ai-study-app")) return;
        if (window.AiStudyApp) window.AiStudyApp.mount(panel);
      }, delay);
    }
  }

  private openStudyTab() {
    try {
      openTab({
        app: this.app,
        custom: {
          id: this.name + TAB_TYPE,
          icon: "iconAiStudy",
          title: "AI 智能学习",
        },
      });
    } catch (error) {
      console.error("[siyuan-ai-study] 打开学习页签失败:", error);
      showMessage("打开 AI 学习页签失败，请查看控制台日志", 4000, "error");
    }
  }

  // 加载持久化数据；首次使用（文件不存在）时初始化为空结构
  private async initData() {
    try {
      const loaded = await this.loadData(DATA_STORAGE);
      if (!loaded || typeof loaded !== "object" || Object.keys(loaded).length === 0) {
        this.data[DATA_STORAGE] = createEmptyData();
        await this.saveData(DATA_STORAGE, this.data[DATA_STORAGE]);
        return;
      }
      // 与空结构合并：补齐旧版本数据文件中缺失的字段，避免后续读写崩溃
      const empty = createEmptyData();
      const partial = loaded as Partial<AppData>;
      const merged: AppData = { ...empty, ...partial };
      merged.settings = { ...empty.settings, ...(partial.settings ?? {}) };
      // 首次读取即触发明文 API Key 迁移（有明文时数据会被修改）
      await migrateProviderKeys(merged);
      this.data[DATA_STORAGE] = merged;
      // 仅当确有变化（字段补齐 / 密钥迁移）才落盘：
      // SiYuan 3.8.8 会对 petal 数据文件变更触发插件整体重载，
      // 每次加载无条件写回会形成「写文件 → 重载 → 再写」无限循环
      if (JSON.stringify(merged) !== JSON.stringify(loaded)) {
        await this.saveData(DATA_STORAGE, merged);
      }
    } catch (error) {
      console.error("[siyuan-ai-study] 加载数据失败:", error);
      this.data[DATA_STORAGE] = createEmptyData();
    }
  }
}
