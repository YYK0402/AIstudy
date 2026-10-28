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
