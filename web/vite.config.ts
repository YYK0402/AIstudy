import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { viteSingleFile } from "vite-plugin-singlefile";

const webDir = fileURLToPath(new URL(".", import.meta.url));

// 独立窗口前端：构建到 dist/web，内联为单文件以适配 file:// 加载（规避 CORS）
export default defineConfig({
  root: webDir,
  plugins: [vue(), viteSingleFile()],
  base: "./",
  resolve: {
    alias: {
      "@": resolve(webDir, "src"),
    },
  },
  build: {
    outDir: resolve(webDir, "../dist/web"),
    emptyOutDir: false,
    assetsDir: "assets",
  },
});
