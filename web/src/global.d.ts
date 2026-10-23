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
  getData(): AppData;
  saveData(data: AppData): Promise<{ code: number }>;
  callAi(input: {
    providerId: number;
    modelId: string;
    messages: CallAiMessage[];
    taskKey: string;
  }): Promise<CallAiResult>;
  testProvider(providerId: number): Promise<TestProviderResult>;
  listModels(providerId: number): Promise<ListModelsResult>;
  showMessage(message: string, timeout?: number, type?: "info" | "error"): void;
  ensureNotebook(name: string): Promise<string>;
  createSiyuanDoc(markdown: string, path: string, notebook: string): Promise<{ id: string }>;
  removeSiyuanDoc(id: string): Promise<void>;
  updateSiyuanDoc(id: string, markdown: string): Promise<void>;
  getSiyuanDocMarkdown(id: string): Promise<string | null>;
  renameSiyuanDoc(id: string, name: string): Promise<void>;
  removeAsset(path: string): Promise<void>;
  ocrAsset(path: string): Promise<string>;
}

declare global {
  interface Window {
    siyuanAiStudy: SiYuanAiStudyApi;
    AiStudyApp: {
      mount(el: Element): void;
      unmount(): void;
    };
  }
}

export {};
