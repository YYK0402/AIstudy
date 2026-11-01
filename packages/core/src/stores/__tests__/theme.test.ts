// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { effectiveTheme, themeForHour, useThemeStore } from "../theme";

describe("themeForHour", () => {
  it("06:00–18:00 为亮", () => {
    for (const h of [6, 8, 12, 17]) expect(themeForHour(h)).toBe("light");
  });

  it("其余为暗", () => {
    for (const h of [0, 3, 5, 18, 21, 23]) expect(themeForHour(h)).toBe("dark");
  });
});

describe("useThemeStore", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it("无存储时默认 auto", () => {
    expect(useThemeStore().mode).toBe("auto");
  });

  it("cycle：auto → light → dark → auto 并持久化", () => {
    const s = useThemeStore();
    s.cycle();
    expect(s.mode).toBe("light");
    expect(localStorage.getItem("siyuan-ai-study-theme")).toBe("light");
    s.cycle();
    expect(s.mode).toBe("dark");
    expect(localStorage.getItem("siyuan-ai-study-theme")).toBe("dark");
    s.cycle();
    expect(s.mode).toBe("auto");
    expect(localStorage.getItem("siyuan-ai-study-theme")).toBe("auto");
  });

  it("恢复存储的手动模式（含旧版只存 light/dark）", () => {
    localStorage.setItem("siyuan-ai-study-theme", "light");
    setActivePinia(createPinia());
    expect(useThemeStore().mode).toBe("light");
    localStorage.setItem("siyuan-ai-study-theme", "garbage");
    setActivePinia(createPinia());
    expect(useThemeStore().mode).toBe("auto");
  });

  it("apply：light 时设 data-theme，dark 时移除", () => {
    const root = document.createElement("div");
    root.className = "ai-study-app";
    document.body.appendChild(root);
    const s = useThemeStore();
    s.setRoot(root);
    s.mode = "light";
    s.apply();
    expect(root.getAttribute("data-theme")).toBe("light");
    s.mode = "dark";
    s.apply();
    expect(root.hasAttribute("data-theme")).toBe(false);
    document.body.innerHTML = "";
  });

  it("多实例（多页签）：apply 只作用于绑定实例，不波及 DOM 中更早的实例", () => {
    const first = document.createElement("div");
    first.className = "ai-study-app";
    const second = document.createElement("div");
    second.className = "ai-study-app";
    document.body.append(first, second);
    const s = useThemeStore();
    s.setRoot(second);
    s.mode = "light";
    s.apply();
    expect(second.getAttribute("data-theme")).toBe("light");
    expect(first.hasAttribute("data-theme")).toBe(false);
    document.body.innerHTML = "";
  });
});

describe("effectiveTheme", () => {
  it("auto 按小时判定，手动模式恒等于 mode", () => {
    expect(effectiveTheme("auto", 12)).toBe("light");
    expect(effectiveTheme("auto", 3)).toBe("dark");
    expect(effectiveTheme("light", 3)).toBe("light");
    expect(effectiveTheme("dark", 12)).toBe("dark");
  });
});
