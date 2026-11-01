import type { StudyBridge } from "./bridge/types";

declare global {
  /** 当前插件版本（构建期由 vite.config.ts 从根 package.json 注入） */
  const __APP_VERSION__: string;
  interface Window {
    AiStudyApp: {
      /** bridge 由宿主直传（不挂 window 裸全局，防同窗口第三方脚本读取/劫持） */
      mount(el: Element, bridge: StudyBridge): void;
      unmount(): void;
    };
  }
}

export {};
