import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

const repoRoot = fileURLToPath(new URL(".", import.meta.url));
// 与 packages/core/vite.config.ts 的 define 对齐：组件测试挂载 App.vue 时引用构建期注入的版本号
const appVersion = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8")).version as string;

export default defineConfig({
  plugins: [vue()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  resolve: {
    alias: {
      "@": `${repoRoot}packages/core/src`,
    },
  },
  test: {
    include: [
      "packages/core/src/**/__tests__/**/*.test.ts",
      "packages/siyuan/src/**/__tests__/**/*.test.ts",
      "packages/fnos/server/**/__tests__/**/*.test.ts",
    ],
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
  },
});
