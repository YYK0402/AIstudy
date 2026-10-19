import { defineStore } from "pinia";

type Theme = "light" | "dark";

const STORAGE_KEY = "siyuan-ai-study-theme";

export const useThemeStore = defineStore("theme", {
  state: () => ({
    theme: (localStorage.getItem(STORAGE_KEY) as Theme) || "dark",
  }),
  actions: {
    toggle() {
      this.theme = this.theme === "light" ? "dark" : "light";
      localStorage.setItem(STORAGE_KEY, this.theme);
      this.apply();
    },
    apply() {
      const root = document.querySelector(".ai-study-app");
      if (!root) {
        return;
      }
      if (this.theme === "light") {
        root.setAttribute("data-theme", "light");
      } else {
        root.removeAttribute("data-theme");
      }
    },
  },
});
