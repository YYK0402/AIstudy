import type { AppData } from "./api";

export interface SiYuanAiStudyApi {
  getData(): AppData;
  saveData(data: AppData): Promise<{ code: number }>;
  querySql(stmt: string): Promise<unknown>;
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
