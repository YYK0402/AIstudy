import type { AppData } from "./api";

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

export interface SiYuanAiStudyApi {
  /** 本次插件加载实例 id：热重载/重启插件后变化 */
  pluginInstanceId: string;
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
  ensureNotebook(name: string): Promise<string>;
  createSiyuanDoc(markdown: string, path: string, notebook: string, parentID?: string | null): Promise<{ id: string }>;
  removeSiyuanDoc(id: string): Promise<void>;
  updateSiyuanDoc(id: string, markdown: string): Promise<void>;
  getSiyuanDocMarkdown(id: string): Promise<string | null>;
  siyuanDocExists(id: string): Promise<boolean>;
  moveSiyuanDoc(id: string, targetId: string): Promise<void>;
  renameSiyuanDoc(id: string, name: string): Promise<void>;
  removeAsset(path: string): Promise<void>;
  ocrAsset(path: string): Promise<string>;
}

declare global {
  /** 当前插件版本（构建期由 web/vite.config.ts 从 package.json 注入） */
  const __APP_VERSION__: string;
  interface Window {
    siyuanAiStudy: SiYuanAiStudyApi;
    AiStudyApp: {
      mount(el: Element): void;
      unmount(): void;
    };
  }
}

export {};
