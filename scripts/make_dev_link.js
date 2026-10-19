import { readFileSync, existsSync, symlinkSync, rmSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import os from "node:os";

// 将 dist 目录软链接到思源工作空间的 plugins 目录，用于本地开发调试
// 用法: node scripts/make_dev_link.js [思源工作空间路径]
// 或设置环境变量 SIYUAN_WORKSPACE

const pluginJson = JSON.parse(readFileSync(resolve("plugin.json"), "utf8"));
const pluginName = pluginJson.name;

const home = os.homedir();
const defaultWorkspace = join(home, "Documents", "SiYuan");
const workspace = process.argv[2] || process.env.SIYUAN_WORKSPACE || defaultWorkspace;
const pluginsDir = join(workspace, "data", "plugins");
const target = join(pluginsDir, pluginName);
const distDir = resolve("dist");

if (!existsSync(pluginsDir)) {
  console.error(`未找到思源工作空间: ${workspace}`);
  console.error("请传入正确路径: node scripts/make_dev_link.js /path/to/SiYuan");
  process.exit(1);
}

if (!existsSync(distDir)) {
  console.error("dist 目录不存在，请先执行 npm run build");
  process.exit(1);
}

mkdirSync(pluginsDir, { recursive: true });
if (existsSync(target)) {
  rmSync(target, { recursive: true, force: true });
}
symlinkSync(distDir, target, "dir");
console.log(`已链接: ${target}`);
console.log(`    -> ${distDir}`);
console.log("在思源中刷新插件即可加载（若已启用请先禁用再启用）。");
