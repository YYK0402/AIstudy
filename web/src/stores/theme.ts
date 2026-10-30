import { defineStore } from "pinia";

export type ThemeMode = "auto" | "light" | "dark";

const STORAGE_KEY = "siyuan-ai-study-theme";
/** 昼区：06:00–18:00 亮，其余暗 */
export const DAY_START = 6;
export const DAY_END = 18;

/** 纯函数：按小时判定明暗（可测） */
export function themeForHour(hour: number): "light" | "dark" {
  return hour >= DAY_START && hour < DAY_END ? "light" : "dark";
}

/** 纯函数：mode → 实际生效明暗（auto 按小时判定） */
export function effectiveTheme(mode: ThemeMode, hour: number): "light" | "dark" {
  return mode === "auto" ? themeForHour(hour) : mode;
}

function readMode(): ThemeMode {
  const v = localStorage.getItem(STORAGE_KEY);
  // 旧版本只存过 light/dark，天然兼容为手动模式
  return v === "auto" || v === "light" || v === "dark" ? v : "auto";
}

export const useThemeStore = defineStore("theme", {
  state: () => ({
    /** auto = 按时间自动；light/dark = 手动覆盖 */
    mode: readMode(),
  }),
  actions: {
    /** 当前实际生效的明暗 */
    getEffective(): "light" | "dark" {
      return effectiveTheme(this.mode, new Date().getHours());
    },
    /** 循环切换：auto → light → dark → auto */
    cycle() {
      this.mode = this.mode === "auto" ? "light" : this.mode === "light" ? "dark" : "auto";
      localStorage.setItem(STORAGE_KEY, this.mode);
      this.apply();
    },
    apply() {
      const root = document.querySelector(".ai-study-app");
      if (!root) {
        return;
      }
      if (this.getEffective() === "light") {
        root.setAttribute("data-theme", "light");
      } else {
        root.removeAttribute("data-theme");
      }
    },
  },
});
