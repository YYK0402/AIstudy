// node 环境下最小 window 桩：storage.ts 顶层事件监听与 new Event 依赖 window 全局
// （Node 无 globalThis.addEventListener，用 EventTarget 提供）
const g = globalThis as Record<string, unknown>;
if (typeof g.window === "undefined") {
  const target = new EventTarget();
  g.window = {
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject) =>
      target.addEventListener(type, listener),
    dispatchEvent: (ev: Event) => target.dispatchEvent(ev),
  };
}
// jsdom 未实现 matchMedia：补默认桩（不命中=桌面布局）；单测可用 defineProperty 覆盖控制命中
const w = g.window as Record<string, unknown>;
if (typeof w.matchMedia !== "function") {
  w.matchMedia = (media: string) => ({
    matches: false,
    media,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}
