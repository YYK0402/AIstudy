import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { viteSingleFile } from "vite-plugin-singlefile";

const webDir = fileURLToPath(new URL(".", import.meta.url));
// 发版时 package.json 与 plugin.json 同步 bump、同步打包，前端据此版本与本地记录比对以弹「更新说明」
const appVersion = JSON.parse(readFileSync(resolve(webDir, "../package.json"), "utf-8")).version as string;

// 前端打包为 IIFE JS bundle，由插件主入口动态加载后直接 mount 到页签
export default defineConfig({
  root: webDir,
  plugins: [
    vue(),
    viteSingleFile(),
  ],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    __APP_VERSION__: JSON.stringify(appVersion),
  },
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