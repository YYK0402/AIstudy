import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

// 插件主入口构建：src/index.ts -> dist/index.js（CommonJS，external siyuan）
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(rootDir, "src"),
    },
  },
  plugins: [
    viteStaticCopy({
      targets: [
        { src: "./plugin.json", dest: "./" },
        { src: "./icon.png", dest: "./" },
        { src: "./preview.png", dest: "./" },
        { src: "./README*.md", dest: "./" },
        { src: "./i18n/*.json", dest: "./i18n" },
      ],
    }),
  ],
  build: {
    outDir: "dist",
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
