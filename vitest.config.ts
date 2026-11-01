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
    coverage: {
      provider: "v8",
      // 基线范围：core 纯逻辑层（utils + api）；视图/组件层未配 jsdom，不纳入
      include: ["packages/core/src/utils/**/*.ts", "packages/core/src/api/**/*.ts"],
      exclude: [
        "**/__tests__/**",
        "**/*.d.ts",
        // 依赖 DOM/canvas 或纯 barrel 的文件，node 环境不可测
        "packages/core/src/utils/modals.ts",
        "packages/core/src/utils/pdfOcr.ts",
        "packages/core/src/utils/index.ts",
      ],
      reporter: ["text", "lcov"],
      reportsDirectory: "docs/audit/coverage",
      // 基线阈值（2026-11-01 实测：utils 85.35%）；api 层大量桥调用依赖真机，不设阈值防假性回归
      thresholds: {
        "packages/core/src/utils/**": { lines: 80 },
      },
    },
  },
});
