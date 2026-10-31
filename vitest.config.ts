import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

const repoRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": `${repoRoot}packages/core/src`,
    },
  },
  test: {
    include: [
      "packages/core/src/**/__tests__/**/*.test.ts",
      "packages/siyuan/src/**/__tests__/**/*.test.ts",
    ],
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
  },
});
