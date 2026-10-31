import type { AppData } from "../types/appData";

export interface CallAiMessage {
  role: string;
  content: string;
}

export interface CallAiResult {
  content: string;
  tokenIn: number;
  tokenOut: number;
}

export interface TestProviderResult {
  ok: boolean;
  message: string;
}

export interface ListModelsResult extends TestProviderResult {
  models: string[];
}

/** 宿主能力声明：core 按此优雅降级功能入口（不认识的实现直接隐藏对应 UI） */
export interface BridgeCapabilities {
  /** OCR 实现：kernel = 宿主内核 OCR（走 ocrAsset）/ vision = AI 视觉模型（core 走 callAi）/ none = 不支持扫描版 */
  ocr: "kernel" | "vision" | "none";
  /** 资料来源是否支持「从 NAS 目录选择」 */
  nasFiles: boolean;
}

/**
 * 宿主适配器契约：core 只依赖本接口，不感知平台。
 * 宿主（思源插件 / 飞牛服务端 / Obsidian 插件）在调用 AiStudyApp.mount 前设置
 * window.__AI_STUDY_BRIDGE__；文档句柄（id）对 core 不透明，各端自行解释。
 */
export interface StudyBridge {
  /** 本次宿主加载实例 id：热重载/重启后变化，前端据此发现已被杀死的在途调用（僵尸任务） */
  pluginInstanceId: string;
  capabilities: BridgeCapabilities;
  getData(): AppData;
  saveData(data: AppData): Promise<{ code: number; msg?: string; dirty?: { global: boolean; courseIds: number[] } }>;
  callAi(input: {
    providerId: number;
    modelId: string;
    messages: CallAiMessage[];
    taskKey: string;
    scope?: string;
  }): Promise<CallAiResult>;
  cancelAiCall(taskKey: string, scope?: string): void;
  testProvider(providerId: number): Promise<TestProviderResult>;
  listModels(providerId: number): Promise<ListModelsResult>;
  showMessage(message: string, timeout?: number, type?: "info" | "error"): void;
  /** 确保落库顶层容器存在（思源=笔记本 / 飞牛=共享目录 / Obsidian=vault 目录），返回不透明句柄 */
  ensureFolder(name: string): Promise<string>;
  createDoc(markdown: string, path: string, folder: string, parentRef?: string | null): Promise<{ id: string }>;
  removeDoc(id: string): Promise<void>;
  updateDoc(id: string, markdown: string): Promise<void>;
  getDocMarkdown(id: string): Promise<string | null>;
  docExists(id: string): Promise<boolean>;
  moveDoc(id: string, targetId: string): Promise<void>;
  renameDoc(id: string, name: string): Promise<void>;
  /** 校验字符串是否为有效的落库文档句柄（各端 id 格式不同；区分文档句柄与块 id/脏数据） */
  isValidDocRef(ref: string): boolean;
  removeAsset(path: string): Promise<void>;
  /** OCR（capabilities.ocr === "kernel" 时由 core 调用；vision 模式 core 自行走 callAi） */
  ocrAsset?(path: string): Promise<string>;
}
