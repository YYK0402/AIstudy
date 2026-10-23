import { createApp, type App as VueApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import router from "./router";
import { useThemeStore } from "./stores/theme";
import cssText from "./style.css?inline";

let app: VueApp | null = null;

// 前端入口：由插件主入口动态加载后，调用 mount 挂载到页签元素
export function mount(el: Element): void {
  // 幂等：该元素已挂载过应用内容则跳过（防内核重放页签 init / 插件重载导致双重 mount，跨 bundle 实例也生效）
  if (el.querySelector(":scope > .ai-study-app")) return;
  if (!document.getElementById("ai-study-style")) {
    const style = document.createElement("style");
    style.id = "ai-study-style";
    style.textContent = cssText;
    document.head.appendChild(style);
  }

  app = createApp(App);
  const pinia = createPinia();
  app.use(pinia);
  app.use(router);
  app.mount(el);

  useThemeStore().apply();
}

export function unmount(): void {
  if (app) {
    app.unmount();
    app = null;
  }
  const style = document.getElementById("ai-study-style");
  if (style) {
    style.remove();
  }
}