import type { StudyBridge } from "./bridge/types";

declare global {
  /** 当前插件版本（构建期由 vite.config.ts 从根 package.json 注入） */
  const __APP_VERSION__: string;
  interface Window {
    /** 宿主桥接实现：宿主须在调用 AiStudyApp.mount 前设置 */
    __AI_STUDY_BRIDGE__?: StudyBridge;
    AiStudyApp: {
      mount(el: Element): void;
      unmount(): void;
    };
  }
}

export {};
