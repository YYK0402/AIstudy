import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(rootDir, "../..");

// 插件主入口构建：src/index.ts -> <仓库根>/dist/index.js（CommonJS，external siyuan）
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(rootDir, "src"),
    },
  },
  plugins: [
    viteStaticCopy({
      targets: [
        { src: resolve(rootDir, "plugin.json"), dest: "./" },
        { src: resolve(rootDir, "icon.png"), dest: "./" },
        { src: resolve(rootDir, "preview.png"), dest: "./" },
        { src: resolve(repoRoot, "README*.md"), dest: "./" },
        { src: resolve(rootDir, "i18n/*.json"), dest: "./i18n" },
      ],
    }),
  ],
  build: {
    outDir: resolve(repoRoot, "dist"),
    emptyOutDir: false,
    minify: false,
    sourcemap: false,
    lib: {
      entry: resolve(rootDir, "src/index.ts"),
      fileName: () => "index.js",
      formats: ["cjs"],
    },
    rollupOptions: {
      external: ["siyuan", "electron"],
      output: {
        entryFileNames: "[name].js",
        assetFileNames: (assetInfo) => assetInfo.name ?? "asset",
      },
    },
  },
});
