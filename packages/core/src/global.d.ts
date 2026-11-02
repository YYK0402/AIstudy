import type { StudyBridge } from "./bridge/types";

declare module "*?url" {
  /** vite ?url 导入：资源 URL（本项目 assetsInlineLimit 全量内联，实际为 data URL 字符串） */
  const url: string;
  export default url;
}

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
