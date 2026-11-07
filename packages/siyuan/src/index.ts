import { Plugin, showMessage, openTab, fetchSyncPost, getFrontend, getAllModels, Dialog } from "siyuan";
import type { TPluginDataChangeReason } from "siyuan";
import { createEmptyData } from "../../core/src/types/appData";
import type { AppData, CallLog, CourseData } from "../../core/src/types/appData";
import type { CallAiResult, ListModelsResult, StudyBridge, TestProviderResult } from "../../core/src/bridge/types";
import { decryptApiKey, migrateProviderKeys } from "../../core/src/crypto";
import { buildChatPayload, nextRateSlotWaitMs } from "../../core/src/aiPayload";
import { llmHttpErrorMessage } from "../../core/src/utils/aiError";
import {
  courseStorageName,
  hasCourseEntities,
  mergeAppData,
  normalizeCourseData,
  splitAppData,
} from "../../core/src/utils/courseSplit";
import { runWithRetry } from "../../core/src/aiRetry";
import type { AiRetryFailInfo } from "../../core/src/aiRetry";
import { shouldRejectEmptyOverwrite } from "../../core/src/utils/emptyGuard";
import { parseCourseFileIds } from "../../core/src/utils/courseFileIds";
import { migratePassageQuestions } from "../../core/src/utils/passageMigration";
import { applyRetention } from "./retention";
import { safeJsonParse, syTreeToMarkdown } from "./syMarkdown";
import type { SyNode } from "./syMarkdown";
import { isMobileFrontend } from "./frontend";
import { FrontendLoader } from "./frontendLoader";
import { decideSelfHeal } from "./tabSelfHeal";

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
    AiStudyApp: {
      /** bridge 由宿主直传（不挂 window 裸全局，防同窗口第三方脚本读取/劫持） */
      mount(el: Element, bridge: StudyBridge): void;
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

export default class AiStudyPlugin extends Plugin {
  /** 近 60s 内 AI 调用发起时间戳（滑动窗口，仅内存） */
  private rateWindow: number[] = [];
  private rateWaitNotified = false;

  async onload() {
    await this.initData();
    this.registerTab();
    this.selfHealTab();
  }

  async onLayoutReady() {
    this.addIcons(`<symbol id="iconAiStudy" viewBox="0 0 32 32">
<line x1="16" y1="5.4" x2="16" y2="2.7" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"/>
<circle cx="16" cy="2.2" r="1.5" fill="currentColor"/>
<rect x="8.5" y="5.5" width="15" height="10.5" rx="3.4" fill="none" stroke="currentColor" stroke-width="2"/>
<circle cx="13.2" cy="10.6" r="1.5" fill="currentColor"/>
<circle cx="18.8" cy="10.6" r="1.5" fill="currentColor"/>
<path d="M16 19.6 C 13.6 17.9, 10.2 17.5, 7.2 18.3 L 7.2 26.2 C 10.2 25.4, 13.6 25.8, 16 27.5 C 18.4 25.8, 21.8 25.4, 24.8 26.2 L 24.8 18.3 C 21.8 17.5, 18.4 17.9, 16 19.6 Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
<line x1="16" y1="20" x2="16" y2="27.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
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
      // 同步合并已发生：新环境窗口结束（远端数据已落本地或本就不存在）
      this.freshEnv = false;
      await this.refreshFromExternalChange("sync");
      return;
    }
    if (reason === "overwrite" && (await this.hasExternalChange())) {
      await this.refreshFromExternalChange("overwrite");
    }
  }

  /** 逐文件比对磁盘内容与已写盘基线；任一不符（或读取失败无法判定）视为存在外部变更。
   *  用 readPetalFileRaw 原始读盘：loadData 会把读到的原始文件内容回填进 this.data 缓存，
   *  "data" 文件回填的是仅全局视图（无课程实体），回显判定为"无外部变更"时缓存即被污染 */
  private async hasExternalChange(): Promise<boolean> {
    for (const [name, baseline] of Array.from(this.writtenBaselines.entries())) {
      let disk: unknown;
      try {
        disk = await this.readPetalFileRaw(name);
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
      this.setMergedView(merged);
      this.initBaselines();
      window.dispatchEvent(new Event(DATA_EXTERNAL_EVENT));
    });
  }

  /** 强制读盘：全局文件 + 各课程文件合并为内存视图；失败返回 null（保留现有内存，避免读空） */
  private async rebuildMergedFromDisk(): Promise<AppData | null> {
    try {
      const disk = (await this.readPetalFileRaw(DATA_STORAGE)) as AppData | null;
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
    // 卸载时清理移动端 Dialog（destroy 触发 destroyCallback → unmount），避免 Vue 实例泄漏
    this.mobileDialog?.destroy();
    this.mobileDialog = null;
    window.AiStudyApp?.unmount();
  }

  // 实现桥接契约，挂载时直传给前端（core 经 getBridge() 访问）
  private buildBridge(): StudyBridge {
    return {
      /** 本次插件加载实例 id：构建热重载/重启插件后变化，前端据此发现进行中的调用已被杀死（僵尸任务） */
      pluginInstanceId: PLUGIN_INSTANCE_ID,
      capabilities: { host: "siyuan", ocr: "kernel", nasFiles: false, docs: "siyuan" },
      getData: () => this.getData(),
      saveData: async (data: AppData) => {
        try {
          const dirty = await this.commitData(data);
          return { code: 0, msg: "", dirty };
        } catch (e) {
          return { code: -1, msg: e instanceof Error ? e.message : String(e) };
        }
      },
      listCourseFileIds: async () => {
        try {
          const res = (await this.withTimeout(
            fetchSyncPost("/api/file/readDir", { path: `/data/storage/petal/${this.name}` }),
          )) as { code?: number; data?: Array<{ name: string }> } | null;
          if (!res || (typeof res.code === "number" && res.code !== 0) || !Array.isArray(res.data)) return [];
          return parseCourseFileIds(res.data.map((e) => e.name));
        } catch {
          // 列举失败退化为空（core 按仅注册表分配 id，保持可用）
          return [];
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
      uploadAsset: async (file: File) => {
        return await this.handleUploadAsset(file);
      },
      removeAsset: async (assetPath: string) => {
        await this.handleRemoveAsset(assetPath);
      },
      // 思源端无 NAS 文件选择能力（capabilities.nasFiles=false，UI 入口隐藏）
      pickNasFiles: async () => {
        throw new Error("当前环境不支持从 NAS 选择文件");
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

  // 上传原始资料到思源资源目录，返回浏览器可直接 fetch 的资源路径（供重新解析）
  private async handleUploadAsset(file: File): Promise<string> {
    const formData = new FormData();
    formData.append("file[]", file);
    const res = await fetch("/api/asset/upload", { method: "POST", body: formData });
    const json = (await res.json()) as { code: number; data?: { succMap?: Record<string, string> | null } };
    const path = Object.values(json?.data?.succMap ?? {})[0] ?? "";
    if (!path) {
      throw new Error("上传资源文件失败");
    }
    return path;
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

  /** 内存合并视图（唯一事实来源）。
   *  绝不从 this.data 缓存读取：内核 loadData/saveData 会把 this.data[name] 回填为
   *  原始文件内容（"data" 文件=仅全局视图，不含课程实体），任何回填/删除都会让
   *  getData() 返回污染视图，core 的 getData()+saveData 随即以空课程文件覆盖真数据
   *  （2026-11-08 course-1 事故根因）。 */
  private mergedView: AppData | null = null;

  private setMergedView(view: AppData | null): void {
    this.mergedView = view;
    // this.data 同步维护仅为调试可见性；正确性不依赖它
    if (view) this.data[DATA_STORAGE] = view;
    else delete this.data[DATA_STORAGE];
  }

  private getData(): AppData {
    return this.mergedView ?? createEmptyData();
  }

  /** 原始读盘（不触碰 this.data 缓存）。
   *  成功返回文件内容（JSON 文件为解析后的值）；文件缺失（404）返回 null；
   *  读失败/超时时抛出（由调用方决定 fail-closed 语义）。 */
  private async readPetalFileRaw(name: string): Promise<unknown> {
    const resp = await this.withTimeout(
      fetch("/api/file/getFile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: `/data/storage/petal/${this.name}/${name}` }),
      }),
    );
    if (resp.status !== 200) {
      // 缺失与非缺失错误都是非 200（内核以 202 + {code:404,...} 报告文件不存在）
      const env = (await resp.json().catch(() => null)) as { code?: number; msg?: string } | null;
      if (env?.code === 404) return null;
      throw new Error(`读取数据文件 ${name} 失败：${env?.msg ?? `HTTP ${resp.status}`}`);
    }
    const text = await resp.text();
    if (text === "") return "";
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
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
      // 新环境状态复核：data 文件现已存在（其他窗口写入 / 手动拷入 / 同步已送达）→ 空态已不存在
      if (this.freshEnv) {
        const diskGlobal = await this.forceReadStorage(DATA_STORAGE);
        if (diskGlobal && typeof diskGlobal === "object") this.freshEnv = false;
      }
      // 新环境门控：data 文件启动时缺失且远端持有本插件数据 → 首同步未完成前禁止写盘
      if (this.freshEnv && (await this.isFreshEnvGateActive())) {
        // 先恢复空态内存（丢弃本次未落盘的变更，防"幽灵课程"残留），再通知前端刷新
        this.setMergedView(createEmptyData());
        this.initBaselines();
        showMessage(
          "AI 学习：首同步尚未完成，保存已暂停（防止覆盖其他设备数据）。同步完成后自动放行；10 分钟未同步则自动放行",
          10000,
          "error",
        );
        window.dispatchEvent(new Event(DATA_EXTERNAL_EVENT));
        throw new Error("首同步未完成，保存已暂停");
      }
      // 乐观并发：对每个将真实写盘的文件强制读盘与基线比对，检测到其他窗口的外部变更
      // 则整个 commit 原子中止（不写任何文件），从磁盘重建内存并通知前端刷新后重试
        const external = await this.detectExternalModifications(global, courses);
        if (external.length > 0) {
          const merged = await this.rebuildMergedFromDisk();
          if (merged && JSON.stringify(merged) !== JSON.stringify(this.getData())) {
            this.setMergedView(merged);
            this.initBaselines();
            window.dispatchEvent(new Event(DATA_EXTERNAL_EVENT));
          }
        showMessage(
          `AI 学习：数据刚被其他窗口修改（${external.length} 个文件有外部变更），内存已刷新，请重试`,
          10000,
          "error",
        );
        throw new Error("数据被其他窗口并发修改，本次保存已中止");
      }
      // "空覆盖非空"守卫：新状态是纯空结构而最后一次已知的磁盘状态非空 → 拒绝写盘。
      // 合法操作永远产不出纯空结构（settings 恒存在），此情形必为异常路径
      // （如内存态被意外重置）；拦截后经 catch 回滚内存，防止空态落盘后
      // 随同步以新 mtime 覆盖其他设备的真数据
      if (shouldRejectEmptyOverwrite(global, this.writtenBaselines.get(DATA_STORAGE))) {
        showMessage("AI 学习：检测到空状态异常写入，已拦截（你的数据未被修改），请重启思源后重试", 8000, "error");
        throw new Error("空状态写盘已被拦截（防止覆盖已有数据）");
      }
      if (await this.writeStorageIfChanged(DATA_STORAGE, global)) dirty.global = true;
      for (const [id, cd] of courses) {
        if (await this.writeStorageIfChanged(courseStorageName(id), cd)) dirty.courseIds.push(id);
      }
      this.setMergedView(data);
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

  /**
   * 乐观并发检查：对本次将真实写盘（内容与基线不同）的每个文件强制读盘与基线比对，
   * 任一不符 = 存在外部变更（其他窗口 / 文件接口写入）。基线缺失的新课程文件必须
   * 磁盘不存在（否则即将覆盖删课遗留的孤儿文件）。
   */
  private async detectExternalModifications(global: AppData, courses: Map<number, CourseData>): Promise<string[]> {
    const changed: string[] = [];
    const targets: Array<{ name: string; baseline: string | undefined; content: unknown }> = [
      { name: DATA_STORAGE, baseline: this.writtenBaselines.get(DATA_STORAGE), content: global },
    ];
    for (const [id, cd] of courses) {
      const name = courseStorageName(id);
      targets.push({ name, baseline: this.writtenBaselines.get(name), content: cd });
    }
    for (const { name, baseline, content } of targets) {
      const serialized = JSON.stringify(content);
      if (baseline !== undefined && serialized === baseline) continue;
      const disk = await this.forceReadStorage(name);
      const diskJson = disk == null || disk === "" ? null : JSON.stringify(disk);
      if (baseline === undefined) {
        if (diskJson !== null) changed.push(name);
      } else {
        // 磁盘缺失按空结构处理（与首启空态基线登记一致，避免误报）
        const comparable =
          name === DATA_STORAGE && diskJson === null ? JSON.stringify(createEmptyData()) : diskJson;
        if (comparable !== baseline) changed.push(name);
      }
    }
    return changed;
  }

  /** 强制真实读盘（readPetalFileRaw 不经过 this.data 缓存）；读失败返回 ""（按缺失处理，fail-closed 由调用方判定） */
  private async forceReadStorage(name: string): Promise<unknown> {
    try {
      return await this.readPetalFileRaw(name);
    } catch {
      return "";
    }
  }

  /**
   * 新环境门控是否生效。放行条件：
   * - 10 分钟兜底时间已过（同步未配置/长期失败，不无限阻塞）
   * - 本次启动后已有成功同步（synced > 启动时间：远端有本插件数据则已落本地，
   *   无数据则本就无覆盖风险）
   * 拦截条件：本设备曾同步成功但本次启动后尚未同步（远端很可能持有历史数据，
   * 含数据文件被抹除的恢复场景），或从未同步但云端同步目录非空（其他设备已同步）
   */
  private async isFreshEnvGateActive(): Promise<boolean> {
    if (Date.now() - this.startupTime > AiStudyPlugin.FRESH_ENV_GRACE_MS) return false;
    let synced = 0;
    try {
      const info = (await this.withTimeout(fetchSyncPost("/api/sync/getSyncInfo", {}))) as
        | { code?: number; data?: { synced?: number } }
        | null;
      synced = info?.data?.synced ?? 0;
    } catch {
      // 查询失败按"曾同步"保守处理（getSyncInfo 是本地调用，失败极罕见）
      synced = Number.MAX_SAFE_INTEGER;
    }
    if (synced > this.startupTime) return false;
    if (synced > 0) return true;
    return await this.cloudSyncDirHasData();
  }

  /** 云端同步目录是否非空（30s 缓存）；查询失败按无数据处理，不阻塞纯新用户 */
  private async cloudSyncDirHasData(): Promise<boolean> {
    const now = Date.now();
    if (now - this.freshEnvRemoteCheck.at < AiStudyPlugin.FRESH_ENV_CHECK_TTL_MS) {
      return this.freshEnvRemoteCheck.hasRemoteData;
    }
    let hasRemoteData = false;
    try {
      const dirs = (await this.withTimeout(fetchSyncPost("/api/sync/listCloudSyncDir", {}))) as
        | { code?: number; data?: { syncDirs?: Array<{ size?: number }> } }
        | null;
      hasRemoteData = !!dirs?.data?.syncDirs?.some((d) => (d.size ?? 0) > 0);
    } catch {
      hasRemoteData = false;
    }
    this.freshEnvRemoteCheck = { at: now, hasRemoteData };
    return hasRemoteData;
  }

  /** 保存失败后把内存恢复到磁盘版本（best-effort）。
   *  readPetalFileRaw 不触碰 this.data 缓存：读失败时现有内存原样保留
   *  （旧实现先 delete 缓存再读，读失败会让 getData() 回退空结构） */
  private async restoreFromDisk() {
    try {
      const disk = (await this.readPetalFileRaw(DATA_STORAGE)) as AppData | null;
      if (!disk || typeof disk !== "object") {
        // 新环境（文件本就缺失）：缺失即真实空态而非读失败，恢复空结构，
        // 丢弃失败保存留在内存里的变更（否则门控兜底放行后会把"幽灵课程"写盘）
        if (this.freshEnv) {
          this.setMergedView(createEmptyData());
          this.initBaselines();
        }
        // 其余情况（读盘瞬时失败）：保留现有内存，交由下一次成功保存覆盖
        return;
      }
      const base = { ...createEmptyData(), ...disk };
      this.setMergedView(await this.loadMergedData(base));
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
      // 401/403 响应体可能回显部分 API Key（OpenAI 系），消息会落日志/展示，不带响应体
      throw new Error(llmHttpErrorMessage(res.data.status, res.data.body));
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

  /** 按 aiRateLimitPerMin 排队等待发送槽位；返回是否发生了等待。shouldCancel 为 true 时立即中止排队 */
  private async acquireRateSlot(limitPerMin: number, shouldCancel?: () => boolean): Promise<boolean> {
    let waited = false;
    while (true) {
      if (shouldCancel?.()) throw new Error("AI 调用已取消");
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
    const retryCount = Math.min(2, Math.max(0, Math.trunc(data.settings?.aiRetryCount ?? 0)));
    const maxAttempts = 1 + retryCount;
    const key = this.aiCallKey(input.taskKey, input.scope);
    // 登记在限流等待之前：排队期间用户取消也能立即生效（acquireRateSlot 检查 canceled 直接中止）
    const entry: { canceled: boolean } = { canceled: false };
    this.inflightAi.set(key, entry);
    let result: CallAiResult;
    try {
      await this.acquireRateSlot(limitPerMin, () => entry.canceled);
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
      // 同 key 并发时后者的 set 会覆盖前者；结束时只清理自己，避免误删在途新调用的登记
      if (this.inflightAi.get(key) === entry) {
        this.inflightAi.delete(key);
      }
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
      return { ok: false, message: llmHttpErrorMessage(res.data.status, res.data.body) };
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
        return { ok: false, message: llmHttpErrorMessage(res.data.status, res.data.body), models: [] };
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

  // 前端 bundle 加载器：桌面 custom 页签与移动端全屏 Dialog 共用（幂等/并发排队/错误渲染见 frontendLoader.ts）
  private frontendLoader: FrontendLoader<Element> | null = null;

  /** 移动端全屏容器单例：内核移动端未实现 custom 页签（openTab 空实现），用 Dialog 当页面 */
  private mobileDialog: Dialog | null = null;

  private getLoader(): FrontendLoader<Element> {
    if (!this.frontendLoader) {
      this.frontendLoader = new FrontendLoader<Element>(
        {
          isLoaded: () => Boolean(window.AiStudyApp),
          injectScript: (src, onSuccess, onFailure) => {
            // 全端统一走内核 HTTP：桌面 / 移动端 petal 页面本身都由内核 HTTP 加载
            // （3.8.9 移动端是 /stage/build/mobile/，getFrontend() 返回 browser-mobile / mobile），
            // 相对路径 /plugins/... 均解析到内核（曾按 file:// 区分原生桌面，iOS WKWebView 禁 http 页加载 file:// 导致白屏）
            const script = document.createElement("script");
            script.src = src;
            script.onload = onSuccess;
            script.onerror = () => onFailure(src);
            document.head.appendChild(script);
          },
          mount: (panel) => this.mountApp(panel),
          reportEvalError: (panel) => {
            // bundle 下载成功但求值中途抛错（语法/运行时），AiStudyApp 未挂上
            console.error("[AIstudy-diag] bundle 已下载但求值失败，window.AiStudyApp 未定义");
            this.showTabError(panel, "前端脚本执行失败", "bundle 已下载但执行中途出错，请查看控制台 [AIstudy-diag] 日志或截图本页反馈");
          },
          reportNetworkError: (panel, src) => {
            console.error("[AIstudy-diag] 加载前端资源失败:", src);
            this.showTabError(panel, "前端资源加载失败", `script 请求未成功：${src}`);
          },
        },
        this.name,
      );
    }
    return this.frontendLoader;
  }

  // 注册自定义页签：动态加载前端 bundle 并直接 mount 到页签元素
  private registerTab() {
    // init/destroy 回调内 this 是 Custom 模型（见 siyuan 类型），插件能力须经闭包引用
    const self = this;
    this.addTab({
      type: TAB_TYPE,
      init() {
        self.getLoader().load(this.element);
      },
      // 内核关闭页签时移除 DOM 但不会销毁前端应用；不接 destroy 钩子会导致
      // Vue 实例 + pinia store 定时器（notify 5s interval）每次开关页签累积泄漏
      destroy() {
        window.AiStudyApp?.unmount();
      },
    });
  }

  /** 定位本插件页签的前端挂载面板（页签栏项与内容面板共享同一 data-id）。
   *  多页签并存时优先返回可见面板：隐藏页签面板宽度为 0，向其 mount 会把活实例 adopt 过去，
   *  用户正在看的可见页签反而空白 */
  private findTabPanel(): Element | null {
    const uses = Array.from(document.querySelectorAll("li.item use"));
    const candidates = uses
      .filter((u) => (u.getAttribute("href") ?? u.getAttribute("xlink:href")) === "#iconAiStudy")
      .map((u) => u.closest("li.item"))
      .filter((li): li is HTMLElement => Boolean(li instanceof HTMLElement && li.dataset.id))
      .map((li) =>
        Array.from(document.querySelectorAll(`[data-id="${li.dataset.id}"]`)).find(
          (el) => el.classList.contains("fn__flex-1"),
        ) ?? null,
      )
      .filter((p): p is Element => Boolean(p));
    if (candidates.length === 0) return null;
    return candidates.find((p) => p.getBoundingClientRect().width > 0) ?? candidates[0];
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
          if (window.AiStudyApp) this.mountApp(panel);
        }, delay),
      );
    }
  }

  /** 挂载前端（统一兜底：挂载失败渲染页签内可见错误，而非静默白屏） */
  private mountApp(panel: Element) {
    try {
      window.AiStudyApp.mount(panel, this.buildBridge());
    } catch (error) {
      console.error("[AIstudy-diag] 前端挂载失败:", error);
      const detail =
        error instanceof Error ? `${error.message}\n${(error.stack ?? "").split("\n").slice(0, 4).join("\n")}` : String(error);
      this.showTabError(panel, "前端挂载失败", detail);
    }
  }

  /** 页签内可见错误提示（此时前端 CSS 可能尚未加载，全部用内联样式） */
  private showTabError(panel: Element, title: string, detail: string) {
    if (panel.querySelector("[data-ai-study-error]")) return;
    const env = `frontend=${getFrontend()} | url=${location.href}`;
    const box = document.createElement("div");
    box.setAttribute("data-ai-study-error", "1");
    box.style.cssText = "box-sizing:border-box;min-height:100%;padding:24px;background:#141714;color:#e8e3d5;font-size:14px;font-family:inherit;";
    const inner = document.createElement("div");
    inner.style.cssText = "max-width:600px;width:100%;margin:0 auto;background:#1e231d;border:1px solid #3a4036;border-radius:10px;padding:16px 18px;";
    const h = document.createElement("div");
    h.style.cssText = "font-weight:600;font-size:15px;margin-bottom:10px;color:#e3b95e;";
    h.textContent = `AI 学习：${title}`;
    const d = document.createElement("pre");
    d.style.cssText = "margin:0 0 10px;white-space:pre-wrap;word-break:break-all;font-size:12px;line-height:1.6;color:#c8cfc2;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;";
    d.textContent = detail;
    const e = document.createElement("div");
    e.style.cssText = "font-size:11px;color:#8a948b;";
    e.textContent = env;
    inner.append(h, d, e);
    box.appendChild(inner);
    panel.appendChild(box);
  }

  private openStudyTab() {
    const report = (stage: string, error: unknown) => {
      console.error(`[AIstudy-diag] 打开学习页签失败（${stage}）:`, error);
      const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
      showMessage(`AI 学习：打开页签失败（${stage}）${message ? "：" + message.slice(0, 60) : ""}，详情见控制台 [AIstudy-diag]`, 8000, "error");
    };
    if (isMobileFrontend(getFrontend())) {
      // 内核移动端未实现 custom 页签（openTab 空实现，DOM 无 custom 渲染分支）
      // → 全屏 Dialog 当页面（前端 app 经 768px 断点自适应移动布局）
      this.openMobileDialog();
      return;
    }
    try {
      // openTab 可能同步 throw 或异步 reject，两种都要兜住（移动端曾出现点击无反应）
      Promise.resolve(
        openTab({
          app: this.app,
          custom: {
            id: this.name + TAB_TYPE,
            icon: "iconAiStudy",
            title: "AI 智能学习",
          },
        }),
      ).catch((error: unknown) => report("openTab 被拒绝", error));
    } catch (error) {
      report("openTab 同步异常", error);
      return;
    }
    this.selfHealOpenTab(report);
  }

  /**
   * 打开页签后的轮询自检（800/1600/3200ms）：
   * - 页签未创建 → openTab 静默失败，报错
   * - 页签存在但面板未挂载 → 关闭→快速重开的竞态（内核 focus 了移除中的旧页签，
   *   未重跑 init 而 destroy 已 unmount）→ 连续两次同一面板确认稳定后补挂载
   */
  private selfHealOpenTab(report: (stage: string, error: unknown) => void) {
    let prevPanel: Element | null = null;
    const delays = [800, 1600, 3200];
    delays.forEach((delay, idx) => {
      const isLast = idx === delays.length - 1;
      this.selfHealTimers.push(
        window.setTimeout(() => {
          const panel = this.findTabPanel();
          const action = decideSelfHeal(prevPanel, panel, isLast);
          if (panel) prevPanel = panel;
          if (action === "mount" && window.AiStudyApp) {
            this.mountApp(panel as Element);
          } else if (action === "error") {
            report("自检：页签未创建", new Error(`${(delay / 1000).toFixed(1)}s 后仍未找到 AIstudy 自定义页签`));
          }
        }, delay),
      );
    });
  }

  /** 移动端：全屏 Dialog 当页面，前端 app 挂进 Dialog 内容容器（单实例，重复点击不叠加） */
  private openMobileDialog() {
    if (this.mobileDialog) return;
    const dialog = new Dialog({
      content: '<div id="aiStudyMobileRoot" style="height:100%;width:100%"></div>',
      title: "AI 智能学习",
      width: "100%",
      height: "100%",
      destroyCallback: () => {
        this.mobileDialog = null;
        window.AiStudyApp?.unmount();
      },
    });
    this.mobileDialog = dialog;
    const root = dialog.element.querySelector("#aiStudyMobileRoot");
    if (!root) {
      dialog.destroy();
      this.mobileDialog = null;
      return;
    }
    this.getLoader().load(root);
  }

  // 各数据文件的已写盘状态（序列化快照）；commitData 据此判断是否需要真实写盘
  private writtenBaselines = new Map<string, string>();

  // 新环境判定：启动时 data 文件缺失（首次使用 / 数据文件丢失）。此状态下若远端持有
  // 本插件数据（本设备曾同步成功，或云端同步目录非空），须先完成首同步才允许写盘，
  // 否则空态写盘产生新 mtime，同步冲突空态胜出，其他设备的课程注册表被孤儿化
  // （2026-11-07 事故的延伸场景：新设备首同步前建课）。
  // 首同步完成（onDataChanged("sync")）清除；10 分钟兜底自动放行（同步未配置/长期失败场景）。
  private freshEnv = false;
  private readonly startupTime = Date.now();
  private freshEnvRemoteCheck = { at: 0, hasRemoteData: false };
  private static readonly FRESH_ENV_GRACE_MS = 10 * 60 * 1000;
  private static readonly FRESH_ENV_CHECK_TTL_MS = 30 * 1000;

  // 加载持久化数据：全局文件 + 各课程文件合并为内存视图。
  // 首次使用（文件不存在）初始化为空结构；
  // 旧布局（实体混在全局文件里）做一次迁移：拆出 course-<id> 文件、全局文件只留全局配置。
  private async initData() {
    let loaded: unknown;
    try {
      // readPetalFileRaw 不经过 this.data 缓存（loadData 会把全局文件原始内容
      // 回填缓存，合并视图建成前 getData() 会读到仅全局视图）
      loaded = await this.readPetalFileRaw(DATA_STORAGE);
    } catch (error) {
      // 磁盘读取失败：不进入"空数据可写"状态（见 dataReady），保持只读等待重启
      console.error("[siyuan-ai-study] 加载数据失败，保存已暂停（防止空数据覆盖磁盘）:", error);
      showMessage("AI 学习：数据文件读取失败，保存已暂停，请重启插件或思源", 6000, "error");
      return;
    }
    try {
      // 全局文件状态判定：
      // - 缺失（""/null）→ 首次使用，空结构只留内存不写盘（dataReady 照常置位）。
      //   关键：多设备同步按 mtime 判胜，若首启立即写空结构，新设备的空文件必然比
      //   旧设备的真数据 mtime 新 → 同步冲突空态胜出 → 存量数据被清空（2026-11-07 事故）。
      //   不写盘后：本地无文件 + 云端有文件 = 同步干净下载真数据（onDataChanged("sync")
      //   自愈刷新内存）；用户首次真实操作才落盘，内容直接是真数据。
      //   基线登记为空结构：空态期间的 save 因内容无变化被 writeStorageIfChanged 跳过。
      // - 存在但非对象（无效 JSON 被内核按文本返回）或空对象 → 损坏，fail-closed 保持只读，
      //   防止把"损坏但可人工恢复"的原文件用空结构覆盖
      if (!loaded || loaded === "") {
        this.setMergedView(createEmptyData());
        this.freshEnv = true;
        this.initBaselines();
        this.dataReady = true;
        return;
      }
      this.freshEnv = false;
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

      this.setMergedView(await this.loadMergedData(global));
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

  /** 读取单个课程文件；文件缺失返回 null（合法空课程，不阻塞其他课程）。
   *  读超时/读失败/损坏向外抛（fail-closed）：瞬时失败被当作"空课程"会在下次保存
   *  以空内容覆盖真数据，故一律拒绝加载而非降级 */
  private async loadCourseFile(courseId: number): Promise<CourseData | null> {
    const name = courseStorageName(courseId);
    let raw: unknown;
    try {
      raw = await this.readPetalFileRaw(name);
    } catch (e) {
      if (e instanceof DataIoTimeoutError) throw e;
      throw new Error(`读取课程数据文件 ${name} 失败，保存已暂停（防止空内容覆盖）`);
    }
    if (raw == null || raw === "") return null;
    if (typeof raw !== "object" || Array.isArray(raw)) {
      // 非空非对象 = 文件损坏：若按"空课程"处理，下次保存会以空内容覆盖损坏文件造成丢失，
      // 故向外抛错 fail-closed（initData 捕获后进入只读）
      throw new Error(`课程数据文件 ${name} 损坏（内容不是有效对象），请从备份恢复`);
    }
    try {
      const cd = normalizeCourseData(raw);
      const { cd: migrated, changed } = migratePassageQuestions(cd);
      if (changed) {
        try {
          // 文章题一次性迁移（旧词形填空合并成篇）：写盘并登记基线
          await this.writeStorageIfChanged(name, migrated);
        } catch (e2) {
          // 迁移写盘失败：内存保留迁移前结构，下次加载幂等重试
          console.error(`[siyuan-ai-study] 课程 ${courseId} 文章题迁移写盘失败，本次保留旧结构:`, e2);
          return cd;
        }
      }
      return migrated;
    } catch (e) {
      // 解析失败 = 结构损坏或版本不兼容：降级"空课程"会在下次保存以空内容覆盖，
      // 故向外抛错 fail-closed（调用方中止加载，进入只读等待人工处理）
      console.error(`[siyuan-ai-study] 解析课程数据文件 ${name} 失败:`, e);
      throw new Error(`课程数据文件 ${name} 解析失败，保存已暂停（防止空内容覆盖）`);
    }
  }

  // 启动读盘成功并完成合并前为 false。读失败时若允许写入，前端拿到的空视图
  // 会在下次保存时把空结构写盘，摧毁既有数据；故所有保存入口检查此标志直接拒绝
  private dataReady = false;

  /** 用内存状态重建各文件的已写盘基线（加载完成后调用） */
  private initBaselines() {
    const { global, courses } = splitAppData(this.getData());
    this.writtenBaselines = new Map([[DATA_STORAGE, JSON.stringify(global)]]);
    for (const [id, cd] of courses) {
      this.writtenBaselines.set(courseStorageName(id), JSON.stringify(cd));
    }
  }
}
