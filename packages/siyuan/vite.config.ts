import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(rootDir, "../..");
// fast-glob 在 Windows 下不认反斜杠绝对路径，统一转正斜杠（否则静态复制 0 个文件）
const globPath = (p: string) => p.replace(/\\/g, "/");

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
        { src: globPath(resolve(rootDir, "plugin.json")), dest: "./" },
        { src: globPath(resolve(rootDir, "icon.png")), dest: "./" },
        { src: globPath(resolve(rootDir, "preview.png")), dest: "./" },
        { src: globPath(resolve(repoRoot, "README*.md")), dest: "./" },
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
