import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import router from "./router";
import { useThemeStore } from "./stores/theme";
import cssText from "./style.css?inline";

// 前端入口：由插件主入口动态加载后，调用 mount 挂载到页签元素
export function mount(el: Element): void {
  if (!document.getElementById("ai-study-style")) {
    const style = document.createElement("style");
    style.id = "ai-study-style";
    style.textContent = cssText;
    document.head.appendChild(style);
  }

  const app = createApp(App);
  const pinia = createPinia();
  app.use(pinia);
  app.use(router);
  app.mount(el);

  useThemeStore().apply();
}

export function unmount(): void {
  const style = document.getElementById("ai-study-style");
  if (style) {
    style.remove();
  }
}