import { createApp, type App as VueApp } from "vue";
import { createPinia, disposePinia, type Pinia } from "pinia";
import App from "./App.vue";
import router from "./router";
import { useThemeStore } from "./stores/theme";
import { setBridge } from "./bridge";
import { installModalGlobals, uninstallModalGlobals } from "./utils/modals";
import cssText from "./style.css?inline";

let app: VueApp | null = null;
let pinia: Pinia | null = null;

// 前端入口：由宿主动态加载后，调用 mount 挂载到目标元素
export function mount(el: Element): void {
  // 解析宿主桥接（宿主须在加载 bundle 后、mount 前设置 window.__AI_STUDY_BRIDGE__）
  if (!window.__AI_STUDY_BRIDGE__) {
    throw new Error("宿主桥接未设置：挂载前须赋值 window.__AI_STUDY_BRIDGE__");
  }
  setBridge(window.__AI_STUDY_BRIDGE__);
  // 幂等：该元素已挂载过应用内容则跳过（防内核重放页签 init / 插件重载导致双重 mount，跨 bundle 实例也生效）
  if (el.querySelector(":scope > .ai-study-app")) return;
  if (!document.getElementById("ai-study-style")) {
    const style = document.createElement("style");
    style.id = "ai-study-style";
    style.textContent = cssText;
    document.head.appendChild(style);
  }

  app = createApp(App);
  pinia = createPinia();
  app.use(pinia);
  app.use(router);
  app.mount(el);
  installModalGlobals(el);

  useThemeStore().apply();
}

export function unmount(): void {
  uninstallModalGlobals();
  if (app) {
    app.unmount();
    app = null;
  }
  // pinia 的 effectScope 不随 app.unmount 销毁，必须显式 dispose，
  // 否则 store 里的 onScopeDispose 清理（如 notify 的僵尸任务 interval）不会执行
  if (pinia) {
    disposePinia(pinia);
    pinia = null;
  }
  const style = document.getElementById("ai-study-style");
  if (style) {
    style.remove();
  }
}