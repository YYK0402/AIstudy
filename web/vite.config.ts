import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const webDir = fileURLToPath(new URL(".", import.meta.url));

// 前端打包为 IIFE JS bundle，由插件主入口动态加载后直接 mount 到页签
export default defineConfig({
  root: webDir,
  plugins: [vue()],
  resolve: {
    alias: {
      "@": resolve(webDir, "src"),
    },
  },
  build: {
    outDir: resolve(webDir, "../dist/web"),
    emptyOutDir: false,
    lib: {
      entry: resolve(webDir, "src/mount.ts"),
      name: "AiStudyApp",
      formats: ["iife"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
