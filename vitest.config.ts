import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  test: {
    include: ["web/src/**/__tests__/**/*.test.ts"],
    environment: "node",
  },
});
