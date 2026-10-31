import { Plugin, showMessage, openTab, fetchSyncPost, getFrontend } from "siyuan";
import type { TPluginDataChangeReason } from "siyuan";
import { createEmptyData } from "../../core/src/types/appData";
import type { AppData, CallLog, CourseData } from "../../core/src/types/appData";
import type { CallAiResult, ListModelsResult, StudyBridge, TestProviderResult } from "../../core/src/bridge/types";
import { decryptApiKey, migrateProviderKeys } from "../../core/src/crypto";
import { buildChatPayload, nextRateSlotWaitMs } from "../../core/src/aiPayload";
import {
  courseStorageName,
  hasCourseEntities,
  mergeAppData,
  normalizeCourseData,
  splitAppData,
} from "./courseSplit";
import { runWithRetry } from "../../core/src/aiRetry";
import type { AiRetryFailInfo } from "../../core/src/aiRetry";
import { applyRetention } from "./retention";

const DATA_STORAGE = "data";
const TAB_TYPE = "study_tab";
// 检测到外部数据变更（其他窗口/同步合并）并刷新内存后派发；
// 前端 packages/core/src/api/storage.ts 监听该事件并复用 DATA_SAVED 机制刷新视图
const DATA_EXTERNAL_EVENT = "siyuan-ai-study:data-external";
// 每次插件加载（含构建触发的热重载）模块重新求值生成新 id，前端用它检测进行中的调用是否已被旧实例杀死
const PLUGIN_INSTANCE_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// callAi 入参类型直接取桥接契约定义，避免双写
type CallAiInput = Parameters<StudyBridge["callAi"]>[0];

declare global {
  interface Window {
    /** 宿主桥接实现：mount.ts 挂载时解析（契约见 core/src/bridge/types.ts） */
    __AI_STUDY_BRIDGE__?: StudyBridge;
    AiStudyApp: {
      mount(el: Element): void;
      unmount(): void;
    };
  }
}

// 内核 loadData/saveData 在网络异常/内核负数错误码时可能永久挂起（siyuan.d.ts 明确警告），
// 统一以超时兜底；超时按失败处理（写盘失败走回滚，读盘失败进入只读）
export class DataIoTimeoutError extends Error {}

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
  // （默认重载会重写数据文件，3.8.8 下形成无限循环）。按来源分支处理：
  // - sync（跨设备同步合并）必然是外部变更 → 直接刷新内存
  // - overwrite（文件接口写入）可能是我们自己的写盘回显，也可能是其他窗口写入：
  //   逐文件比对磁盘内容与已写盘基线，任一不符才刷新
  // - 无 reason：视为自己写入的回显，忽略（变更已在内存中）
  async onDataChanged(reason?: TPluginDataChangeReason): Promise<void> {
    if (!this.dataReady) return;
    if (reason === "sync") {
      await this.refreshFromExternalChange("sync");
      return;
    }
    if (reason === "overwrite" && (await this.hasExternalChange())) {
      await this.refreshFromExternalChange("overwrite");
    }
  }

  /** 逐文件比对磁盘内容与已写盘基线；任一不符（或读取失败无法判定）视为存在外部变更 */
  private async hasExternalChange(): Promise<boolean> {
    for (const [name, baseline] of Array.from(this.writtenBaselines.entries())) {
      let disk: unknown;
      try {
        // 强制真实读盘：loadData 默认直接返回内存缓存，比对将失去意义
        delete this.data[name];
        disk = await this.withTimeout(this.loadData(name));
      } catch {
        return true;
      }
      if (JSON.stringify(disk ?? null) !== baseline) return true;
    }
    return false;
  }

  /** 强制读盘重建内存视图与基线，并通知前端刷新（在 commit 队列内执行，避免与写盘交错） */
  private async refreshFromExternalChange(source: string) {
    await this.enqueueCommit(async () => {
      const merged = await this.rebuildMergedFromDisk();
      if (!merged) return;
      if (JSON.stringify(merged) === JSON.stringify(this.getData())) return;
      console.info(`[siyuan-ai-study] 检测到外部数据变更（${source}），内存视图已刷新`);
      this.data[DATA_STORAGE] = merged;
      this.initBaselines();
      window.dispatchEvent(new Event(DATA_EXTERNAL_EVENT));
    });
  }

  /** 强制读盘：全局文件 + 各课程文件合并为内存视图；失败返回 null（保留现有内存） */
  private async rebuildMergedFromDisk(): Promise<AppData | null> {
    try {
      delete this.data[DATA_STORAGE];
      const disk = (await this.withTimeout(this.loadData(DATA_STORAGE))) as AppData | null;
      if (!disk || typeof disk !== "object") return null;
      return await this.loadMergedData({ ...createEmptyData(), ...disk });
    } catch {
      return null;
    }
  }

  onunload() {
    // 清除自愈轮询定时器，避免卸载发生在窗口期内时回调仍向内核已移除的面板 mount
    for (const timer of this.selfHealTimers) window.clearTimeout(timer);
    this.selfHealTimers = [];
    // 卸载时清理已挂载的前端应用，避免 Vue 实例泄漏
    window.AiStudyApp?.unmount();
  }

  // 实现桥接契约并暴露到全局，供直接挂载的前端调用（core 经 getBridge() 访问）
  private exposeApi(): void {
    window.__AI_STUDY_BRIDGE__ = {
      /** 本次插件加载实例 id：构建热重载/重启插件后变化，前端据此发现进行中的调用已被杀死（僵尸任务） */
      pluginInstanceId: PLUGIN_INSTANCE_ID,
      capabilities: { ocr: "kernel", nasFiles: false, docs: "siyuan" },
      getData: () => this.data[DATA_STORAGE] ?? createEmptyData(),
      saveData: async (data: AppData) => {
        try {
          const dirty = await this.commitData(data);
          return { code: 0, msg: "", dirty };
        } catch (e) {
          return { code: -1, msg: e instanceof Error ? e.message : String(e) };
        }
      },
      callAi: async (input: CallAiInput) => {
        return await this.handleCallAi(input);
      },
      cancelAiCall: (taskKey: string, scope?: string) => {
        this.handleCancelAiCall(taskKey, scope);
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
      ensureFolder: async (name: string) => {
        return await this.handleEnsureNotebook(name);
      },
      createDoc: async (markdown: string, path: string, folder: string, parentRef?: string | null) => {
        return await this.handleCreateSiyuanDoc(markdown, path, folder, parentRef);
      },
      removeDoc: async (id: string) => {
        await this.handleRemoveSiyuanDoc(id);
      },
      updateDoc: async (id: string, markdown: string) => {
        await this.handleUpdateSiyuanDoc(id, markdown);
      },
      getDocMarkdown: async (id: string) => {
        return await this.handleGetSiyuanDocMarkdown(id);
      },
      docExists: async (id: string) => {
        return await this.handleSiyuanDocExists(id);
      },
      moveDoc: async (id: string, targetId: string) => {
        await this.handleMoveSiyuanDoc(id, targetId);
      },
      renameDoc: async (id: string, name: string) => {
        await this.handleRenameSiyuanDoc(id, name);
      },
      isValidDocRef: (ref: string) => {
        return /^\d{14}-[0-9a-z]{7}$/.test(ref);
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
  // parentID 已知时一并传递：3.8.9 新标题模式下祖先链存在同名文档需 parentID 消歧（旧版忽略该参数无副作用）
  private async handleCreateSiyuanDoc(
    markdown: string,
    path: string,
    notebook: string,
    parentID?: string | null,
  ): Promise<{ id: string }> {
    const res = (await fetchSyncPost("/api/filetree/createDocWithMd", {
      notebook,
      path,
      markdown,
      ...(parentID ? { parentID } : {}),
    })) as {
      code: number;
      data?: string | { reason?: string } | null;
      msg?: string;
    };
    if (res.code !== 0 || !res.data) {
      throw new Error(`创建思源文档失败: ${this.toCreateDocErrorMessage(res)}`);
    }
    return { id: res.data as string };
  }

  /** 创建文档失败信息：3.8.9 新标题模式的业务错误以 code:-1 + data.reason 返回，映射为可操作提示 */
  private toCreateDocErrorMessage(res: { data?: string | { reason?: string } | null; msg?: string }): string {
    const reason = typeof res.data === "object" && res.data !== null ? res.data.reason : undefined;
    if (reason === "pathAmbiguous") {
      return "文档路径歧义：笔记本中已存在同名文档，请在思源中重命名同名文档后重试";
    }
    if (reason === "legacyPathUnsupported") {
      return "文档名称含「/」或为空，路径方式无法创建，请调整课程/章节/资料名称后重试";
    }
    return res.msg ?? "未知错误";
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

  /** 文档是否仍存在（用于区分「已删除」与「瞬时读失败」） */
  private async handleSiyuanDocExists(id: string): Promise<boolean> {
    const doc = (await fetchSyncPost("/api/filetree/getDoc", { id })) as {
      code: number;
      data?: { path?: string } | null;
    };
    return doc.code === 0 && Boolean(doc.data?.path);
  }

  // 移动文档到目标文档下（章节拖拽换父级时同步思源树）
  // 3.8.x 契约为 { fromIDs, toID }（真机实证：移动后 getDoc path 随之变化）；
  // siyuan d.ts 的 API 映射表缺该条目，参数类型收窄为 unknown
  private async handleMoveSiyuanDoc(id: string, targetId: string): Promise<void> {
    const rawPost = fetchSyncPost as (path: string, body: Record<string, unknown>) => Promise<unknown>;
    const res = (await rawPost("/api/filetree/moveDocsByID", {
      fromIDs: [id],
      toID: targetId,
    })) as { code: number; msg?: string };
    if (res.code !== 0) {
      throw new Error(`移动思源文档失败: ${res.msg ?? "未知错误"}`);
    }
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

  /** 内核数据读写统一超时包装；超时抛 DataIoTimeoutError */
  private withTimeout<T>(promise: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(
        () => reject(new DataIoTimeoutError("数据读写超时（15s），请检查思源内核状态")),
        15000,
      );
      promise.then(
        (value) => {
          window.clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          window.clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  // 插件侧提交串行队列：前端 saveData 请求与 AI 路径的 persist 共用，
  // 并发提交不再交错"先快照后写盘"，后写者无法用旧快照覆盖较新快照
  private commitQueue: Promise<unknown> = Promise.resolve();

  private enqueueCommit<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.commitQueue.then(() => fn());
    // 队列链吞掉失败：单次提交失败不阻断后续提交
    this.commitQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async persist(data: AppData) {
    await this.commitData(data);
  }

  /** 统一写入口：所有写入经 commitQueue 串行化（避免并发提交互相覆盖旧快照）；返回脏集供前端选择性刷新 */
  private commitData(data: AppData): Promise<{ global: boolean; courseIds: number[] }> {
    return this.enqueueCommit(() => this.doCommitData(data));
  }

  /** 提交执行体：先迁移明文 API Key 为密文，再拆成 全局文件 + 各课程文件 分别落盘
   *  （仅写内容有变化的文件）。删课后遗留的 course-<id> 文件保留在磁盘（加载时忽略，
   *  petal 无删除文件的 API；id 单调递增不会冲突）。
   *  失败时从磁盘回滚内存缓存，避免「保存失败但内存已脏」，前端的失败回滚才有意义。 */
  private async doCommitData(data: AppData): Promise<{ global: boolean; courseIds: number[] }> {
    if (!this.dataReady) {
      throw new Error("数据未就绪（加载失败），保存已暂停，请重启插件");
    }
    await migrateProviderKeys(data);
    applyRetention(data);
    const { global, courses } = splitAppData(data);
    const dirty: { global: boolean; courseIds: number[] } = { global: false, courseIds: [] };
    try {
      if (await this.writeStorageIfChanged(DATA_STORAGE, global)) dirty.global = true;
      for (const [id, cd] of courses) {
        if (await this.writeStorageIfChanged(courseStorageName(id), cd)) dirty.courseIds.push(id);
      }
      this.data[DATA_STORAGE] = data;
      return dirty;
    } catch (e) {
      await this.restoreFromDisk();
      throw e;
    }
  }

  /** 序列化结果与已写盘状态一致则跳过写盘；返回是否真实写盘（即有变化） */
  private async writeStorageIfChanged(name: string, value: unknown): Promise<boolean> {
    const serialized = JSON.stringify(value);
    if (this.writtenBaselines.get(name) === serialized) return false;
    const res = await this.withTimeout(this.saveData(name, value));
    const r = (res ?? {}) as { code?: number };
    if (typeof r.code === "number" && r.code !== 0) {
      throw new Error("数据保存失败");
    }
    this.writtenBaselines.set(name, serialized);
    return true;
  }

  /** 保存失败后把内存缓存恢复到磁盘版本（best-effort） */
  private async restoreFromDisk() {
    try {
      // 强制真实读盘：commitData 已把完整合并视图缓存进 this.data，loadData 默认
      // 直接返回缓存（读盘失败也回退缓存），不 delete 的话"合并视图 + 课程文件"
      // 二次 merge 会使课程实体翻倍并写回磁盘
      delete this.data[DATA_STORAGE];
      const disk = (await this.withTimeout(this.loadData(DATA_STORAGE))) as AppData | null;
      if (!disk || typeof disk !== "object") {
        // 直读磁盘也失败（返回 ""/null）：保留现有内存，交由下一次成功保存覆盖
        return;
      }
      const base = { ...createEmptyData(), ...disk };
      this.data[DATA_STORAGE] = await this.loadMergedData(base);
      this.initBaselines();
    } catch {
      // 读取磁盘也失败时保留现有内存，交由下一次成功保存覆盖
    }
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
      // 错误体可能很大（HTML 错误页），截断避免撑爆日志/提示
      throw new Error(`LLM 请求失败: HTTP ${res.data.status} ${res.data.body.slice(0, 500)}`);
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

  // 在途 AI 调用登记表：cancelAiCall 标记 canceled 后，
  // 重试循环立即中止、forwardProxy 返回的响应直接丢弃（forwardProxy 无网络层 abort，已消耗 token 无法退回）
  private readonly inflightAi = new Map<string, { canceled: boolean }>();

  private aiCallKey(taskKey: string, scope?: string): string {
    return `${taskKey}:${scope ?? "-"}`;
  }

  private handleCancelAiCall(taskKey: string, scope?: string): void {
    const entry = this.inflightAi.get(this.aiCallKey(taskKey, scope));
    if (entry) entry.canceled = true;
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
    const key = this.aiCallKey(input.taskKey, input.scope);
    const entry: { canceled: boolean } = { canceled: false };
    this.inflightAi.set(key, entry);
    let result: CallAiResult;
    try {
      result = await runWithRetry(
        async () => {
          const r = await this.attemptCallAi(data, provider, input);
          // 响应丢弃：调用返回前已标记取消（如前端点了取消）
          if (entry.canceled) throw new Error("AI 调用已取消");
          return r;
        },
        maxAttempts,
        ({ attempt, error, willRetry }) => {
          const friendly = this.toFriendlyAiError(error, provider);
          const suffix = willRetry ? `（第 ${attempt}/${maxAttempts} 次尝试失败，稍后自动重试）` : "";
          this.appendLog(data, input.taskKey, provider.name, input.modelId, 0, 0, "error", `${friendly.message}${suffix}`);
        },
        undefined,
        () => entry.canceled,
      );
    } catch (error) {
      const canceled = entry.canceled;
      // 取消不记 AI 日志（非模型失败，不污染统计）
      if (!canceled) {
        // 最后一次失败的日志已在 onFail 中记录
        await this.persist(data);
      }
      throw canceled ? new Error("AI 调用已取消") : this.toFriendlyAiError(error, provider);
    } finally {
      this.inflightAi.delete(key);
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
        // 仅原生桌面（Electron）走 file://（无缓存问题）；浏览器与原生移动端（mobile /
        // browser-mobile）一律走内核 HTTP——/plugins/... 由内核提供服务（已验证），
        // 加时间戳避免构建后刷新仍命中旧 bundle 缓存
        const isNativeDesktop = frontend === "desktop" || frontend === "desktop-window";
        const dataDir = window.siyuan.config?.system?.dataDir;
        const src = isNativeDesktop
          ? `file://${dataDir}/plugins/${pluginName}/web/index.js`
          : `/plugins/${pluginName}/web/index.js?v=${Date.now()}`;
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
      // 内核关闭页签时移除 DOM 但不会销毁前端应用；不接 destroy 钩子会导致
      // Vue 实例 + pinia store 定时器（notify 5s interval）每次开关页签累积泄漏
      destroy() {
        window.AiStudyApp?.unmount();
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
  // 页签自愈轮询定时器；插件卸载时统一清除，防止窗口期内回调仍在死实例上执行
  private selfHealTimers: number[] = [];

  private selfHealTab() {
    for (const delay of [500, 1500, 3000, 6000]) {
      this.selfHealTimers.push(
        window.setTimeout(() => {
          const panel = this.findTabPanel();
          if (!panel || panel.querySelector(".ai-study-app")) return;
          if (window.AiStudyApp) window.AiStudyApp.mount(panel);
        }, delay),
      );
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

  // 各数据文件的已写盘状态（序列化快照）；commitData 据此判断是否需要真实写盘
  private writtenBaselines = new Map<string, string>();

  // 加载持久化数据：全局文件 + 各课程文件合并为内存视图。
  // 首次使用（文件不存在）初始化为空结构；
  // 旧布局（实体混在全局文件里）做一次迁移：拆出 course-<id> 文件、全局文件只留全局配置。
  private async initData() {
    let loaded: unknown;
    try {
      loaded = await this.withTimeout(this.loadData(DATA_STORAGE));
    } catch (error) {
      // 磁盘读取失败：不进入"空数据可写"状态（见 dataReady），保持只读等待重启
      console.error("[siyuan-ai-study] 加载数据失败，保存已暂停（防止空数据覆盖磁盘）:", error);
      showMessage("AI 学习：数据文件读取失败，保存已暂停，请重启插件或思源", 6000, "error");
      return;
    }
    try {
      // 全局文件状态判定：
      // - 缺失（""/null）→ 首次使用，写入空结构
      // - 存在但非对象（无效 JSON 被内核按文本返回）或空对象 → 损坏，fail-closed 保持只读，
      //   防止把"损坏但可人工恢复"的原文件用空结构覆盖
      if (!loaded || loaded === "") {
        this.data[DATA_STORAGE] = createEmptyData();
        // 经 writeStorageIfChanged 写盘：校验内核返回 code 并登记基线，
        // 失败则抛错保持只读（dataReady 不置位），避免基线谎报"已写盘"
        await this.writeStorageIfChanged(DATA_STORAGE, this.data[DATA_STORAGE]);
        this.dataReady = true;
        return;
      }
      if (typeof loaded !== "object" || loaded === null || Array.isArray(loaded) || Object.keys(loaded).length === 0) {
        console.error(
          "[siyuan-ai-study] 数据文件损坏（内容不是有效非空对象），保存已暂停，请从备份恢复。文件开头:",
          String(loaded).slice(0, 200),
        );
        showMessage("AI 学习：数据文件损坏，保存已暂停，请从备份恢复或重启思源", 8000, "error");
        return;
      }
      // 与空结构合并：补齐旧版本数据文件中缺失的字段，避免后续读写崩溃
      const empty = createEmptyData();
      const partial = loaded as Partial<AppData>;
      let global: AppData = { ...empty, ...partial };
      global.settings = { ...empty.settings, ...(partial.settings ?? {}) };
      // 首次读取即触发明文 API Key 迁移（有明文时数据会被修改）
      await migrateProviderKeys(global);

      const legacy = hasCourseEntities(global);
      if (legacy) {
        const { global: trimmed, courses } = splitAppData(global);
        // 迁移写盘经 writeStorageIfChanged：校验 code + 成功后才登记基线；
        // 失败抛错保持只读，重启后从全局文件重跑迁移（课程文件写入幂等）
        for (const [id, cd] of courses) {
          await this.writeStorageIfChanged(courseStorageName(id), cd);
        }
        await this.writeStorageIfChanged(DATA_STORAGE, trimmed);
        global = trimmed;
      } else if (JSON.stringify(splitAppData(global).global) !== JSON.stringify(loaded)) {
        // 字段补齐 / 明文字段清理 / 密钥迁移：全局文件确有变化才写回
        // （避免无条件写回触发内核重载循环）
        await this.writeStorageIfChanged(DATA_STORAGE, global);
      }

      this.data[DATA_STORAGE] = await this.loadMergedData(global);
      this.initBaselines();
      this.dataReady = true;
    } catch (error) {
      // 迁移/合并中途失败（如课程文件损坏）：内存保留已读到的部分，但不开放写入（dataReady 保持 false），
      // 避免部分状态或前端空视图被写盘；修复/恢复后重启插件重新初始化
      console.error("[siyuan-ai-study] 数据初始化中途失败，保存已暂停:", error);
      const detail = error instanceof Error ? `：${error.message.slice(0, 80)}` : "";
      showMessage(`AI 学习：数据初始化失败，保存已暂停${detail}`, 8000, "error");
    }
  }

  /** 全局数据 + 各课程文件 → 内存合并视图（内存中始终是完整 AppData，前端无感知） */
  private async loadMergedData(global: AppData): Promise<AppData> {
    let merged = global;
    for (const course of global.courses) {
      const cd = await this.loadCourseFile(course.id);
      if (cd) {
        merged = mergeAppData(merged, new Map([[course.id, cd]]));
      }
    }
    return merged;
  }

  /** 读取单个课程文件；文件不存在 / 损坏返回 null（按空课程处理，不阻塞其他课程）。
   *  读超时向外抛（fail-closed）：防止瞬时超时被当作"空课程"、下次保存以空内容覆盖 */
  private async loadCourseFile(courseId: number): Promise<CourseData | null> {
    let raw: unknown;
    try {
      raw = await this.withTimeout(this.loadData(courseStorageName(courseId)));
    } catch (e) {
      if (e instanceof DataIoTimeoutError) throw e;
      console.error(`[siyuan-ai-study] 读取课程数据文件 ${courseStorageName(courseId)} 失败（按空课程处理）:`, e);
      return null;
    }
    if (raw == null || raw === "") return null;
    if (typeof raw !== "object" || Array.isArray(raw)) {
      // 非空非对象 = 文件损坏：若按"空课程"处理，下次保存会以空内容覆盖损坏文件造成丢失，
      // 故向外抛错 fail-closed（initData 捕获后进入只读）
      throw new Error(`课程数据文件 ${courseStorageName(courseId)} 损坏（内容不是有效对象），请从备份恢复`);
    }
    try {
      return normalizeCourseData(raw);
    } catch (e) {
      console.error(`[siyuan-ai-study] 解析课程数据文件 ${courseStorageName(courseId)} 失败（按空课程处理）:`, e);
      return null;
    }
  }

  // 启动读盘成功并完成合并前为 false。读失败时若允许写入，前端拿到的空视图
  // 会在下次保存时把空结构写盘，摧毁既有数据；故所有保存入口检查此标志直接拒绝
  private dataReady = false;

  /** 用内存状态重建各文件的已写盘基线（加载完成后调用） */
  private initBaselines() {
    const { global, courses } = splitAppData(this.data[DATA_STORAGE] ?? createEmptyData());
    this.writtenBaselines = new Map([[DATA_STORAGE, JSON.stringify(global)]]);
    for (const [id, cd] of courses) {
      this.writtenBaselines.set(courseStorageName(id), JSON.stringify(cd));
    }
  }
}
