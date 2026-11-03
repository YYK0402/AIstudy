import { createApp, type App as VueApp } from "vue";
import { createPinia, disposePinia, type Pinia } from "pinia";
import App from "./App.vue";
import router from "./router";
import { useThemeStore } from "./stores/theme";
import { setBridge, type StudyBridge } from "./bridge";
import { installModalGlobals, uninstallModalGlobals } from "./utils/modals";
import { maybeShowDailyReminder } from "./composables/useDailyReminder";
import cssText from "./style.css?inline";

let app: VueApp | null = null;
let pinia: Pinia | null = null;
let appRoot: Element | null = null;

/**
 * 查找存活的既有实例：Vue 挂载时把 __vue_app__ 写在挂载容器（.ai-study-app 的父元素）上。
 * 宿主内核可能先恢复隐藏页签（挂载 0x0 实例）再打开新页签（二次挂载）；
 * 类选择器 Teleport 会命中 DOM 中第一个实例，双实例并存时弹窗全部渲染进隐藏容器。
 */
function findLiveRoot(): Element | null {
  const roots = Array.from(document.querySelectorAll(".ai-study-app"));
  for (const root of roots) {
    const host = root.parentElement as (HTMLElement & { __vue_app__?: unknown }) | null;
    if (host && host.__vue_app__) return root;
  }
  return null;
}

// 前端入口：由宿主动态加载后，调用 mount 挂载到目标元素（bridge 由宿主直传，不挂 window 裸全局）
export function mount(el: Element, bridge: StudyBridge): void {
  setBridge(bridge);
  // 今日任务提醒：每次开页签都尝试（单实例 DOM 迁移时 onMounted 不重跑，必须挂这里）。
  // 可见性守卫：内核恢复隐藏页签（0x0）时不触发，避免 toast 不可见却消费当日去重。
  if (el.clientWidth > 0) void maybeShowDailyReminder();
  if (!document.getElementById("ai-study-style")) {
    const style = document.createElement("style");
    style.id = "ai-study-style";
    style.textContent = cssText;
    document.head.appendChild(style);
  }

  // 单实例：既有活实例直接迁入新挂载点（DOM 迁移，Vue 状态/路由/keep-alive 全保留），
  // 避免二次 createApp 造成双实例（共享 router 模块单例、弹窗 Teleport 落错容器）
  const live = findLiveRoot();
  if (live) {
    if (live.parentElement === el) return;
    el.appendChild(live);
    return;
  }
  // 清理无 Vue 引用的僵尸实例（内核重载 bundle 后旧挂载点残留 DOM），防止其抢占 Teleport 目标
  document.querySelectorAll(".ai-study-app").forEach((zombie) => zombie.remove());
  // 孤儿兜底：上一实例的 DOM 已被内核移除但未走 unmount（destroy 钩子未触达），
  // 模块变量仍持有旧 app/pinia（定时器泄漏）→ 先彻底清理再新建
  if (app) {
    uninstallModalGlobals();
    app.unmount();
    app = null;
  }
  if (pinia) {
    disposePinia(pinia);
    pinia = null;
  }

  app = createApp(App);
  pinia = createPinia();
  app.use(pinia);
  app.use(router);
  app.mount(el);
  appRoot = el.querySelector(":scope > .ai-study-app");
  // 观察 .ai-study-app 本体（adopt 迁移父级时节点不变，观察者不失效）
  if (appRoot) installModalGlobals(appRoot);

  const theme = useThemeStore();
  theme.setRoot(appRoot);
  theme.apply();
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
  appRoot = null;
  const style = document.getElementById("ai-study-style");
  if (style) {
    style.remove();
  }
}
