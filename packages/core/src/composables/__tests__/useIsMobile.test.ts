// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

// matchMedia 桩：currentMatches 控制命中，changeHandlers 记录监听（模拟视口变化）
let currentMatches = false;
const changeHandlers = new Set<(e: { matches: boolean }) => void>();
Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: (media: string) => ({
    matches: currentMatches,
    media,
    addEventListener: (_type: string, cb: (e: { matches: boolean }) => void) => changeHandlers.add(cb),
    removeEventListener: () => {},
    onchange: null,
    dispatchEvent: () => true,
  }),
});

async function fireChange() {
  for (const cb of changeHandlers) cb({ matches: currentMatches });
}

describe("useIsMobile", () => {
  it("初始未命中（>768px）：isMobile 为 false", async () => {
    currentMatches = false;
    const { useIsMobile } = await import("../useIsMobile");
    const { isMobile } = useIsMobile();
    expect(isMobile.value).toBe(false);
  });

  it("视口缩到 ≤768px：change 事件后为 true，恢复后回 false；多消费方共享同一状态", async () => {
    const { useIsMobile } = await import("../useIsMobile");
    const first = useIsMobile();
    currentMatches = true;
    await fireChange();
    expect(first.isMobile.value).toBe(true);
    // 第二个消费方拿到同一响应式状态（模块级单例）
    const second = useIsMobile();
    expect(second.isMobile.value).toBe(true);
    currentMatches = false;
    await fireChange();
    expect(first.isMobile.value).toBe(false);
  });
});
