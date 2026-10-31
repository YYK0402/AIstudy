#!/usr/bin/env node
// 组装前端产物：core IIFE bundle + 飞牛文件选择 SDK + 桥接 shim → .fnos-build/.ui-dist
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const fnosDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(fnosDir, "../..");
const coreBundle = join(repoRoot, "dist/web/index.js");
const outDir = join(fnosDir, ".fnos-build/.ui-dist");

if (!existsSync(coreBundle)) {
  throw new Error("缺少 core 前端产物 dist/web/index.js，请先执行 npm run build:web");
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(join(outDir, "assets"), { recursive: true });
cpSync(coreBundle, join(outDir, "assets/index.js"));

// 飞牛文件选择 SDK（@trimjs/web-app）→ 全局 __TRIM_SDK__，供桥接 shim 调用 pickNasFiles
await esbuild.build({
  stdin: {
    contents: `export { TrimApp } from "@trimjs/web-app";`,
    resolveDir: repoRoot,
    sourcefile: "trim-sdk-entry.js",
  },
  bundle: true,
  minify: true,
  format: "iife",
  globalName: "__TRIM_SDK__",
  platform: "browser",
  target: "es2020",
  outfile: join(outDir, "assets/trim-sdk.js"),
});

const template = readFileSync(join(fnosDir, "ui/index.template.html"), "utf-8");
const shim = readFileSync(join(fnosDir, "ui/bridge-shim.js"), "utf-8");
const html = template.replace("__SHIM__", `<script>\n${shim}\n</script>`);
writeFileSync(join(outDir, "index.html"), html, "utf-8");

console.log(`UI 产物已生成: ${outDir}`);
