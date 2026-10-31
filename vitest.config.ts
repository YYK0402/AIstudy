import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  test: {
    include: [
      "packages/core/src/**/__tests__/**/*.test.ts",
      "packages/siyuan/src/**/__tests__/**/*.test.ts",
    ],
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
  },
});
