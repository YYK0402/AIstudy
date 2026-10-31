import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, join, relative, extname } from "node:path";
import JSZip from "jszip";

// 将 dist 打包为 package.zip（思源集市上架 / 手动安装用），并校验清单与包结构
// 用法: node scripts/make_install.js（先执行 npm run build:web && npm run build:plugin）
// 产物: 仓库根目录 package.zip（已 gitignore），zip 根目录即插件文件，不套文件夹

const rootDir = resolve(".");
const distDir = resolve("dist");
const output = join(rootDir, "package.zip");

const errors = [];
const warnings = [];

if (!existsSync(distDir)) {
  console.error("dist 目录不存在，请先执行: npm run build:web && npm run build:plugin");
  process.exit(1);
}

// ---- 校验 plugin.json 清单（对齐内核 bazaar 包校验规则） ----
const manifest = JSON.parse(readFileSync(join(rootDir, "packages/siyuan/plugin.json"), "utf8"));

// 与内核 IsValidPackageName 一致：可作跨平台目录名的合法包名
const RESERVED_NAMES = new Set([
  "CON", "PRN", "AUX", "NUL",
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
]);
function isValidPackageName(name) {
  if (typeof name !== "string" || name.length < 1 || name.length > 255) return false;
  if (name[0] === "." || name[0] === " " || name.endsWith(".") || name.endsWith(" ")) return false;
  if (name.includes("..")) return false;
  for (const ch of name) {
    const code = ch.codePointAt(0);
    if (code < 32 || code === 127) return false;
    if ("<>&'\":/\\|?*".includes(ch)) return false;
  }
  return !RESERVED_NAMES.has(name.toUpperCase());
}

// name: 包名合法；须与仓库名一致（官方模板要求，内核只要求唯一）
if (!isValidPackageName(manifest.name)) {
  errors.push(`name "${manifest.name}" 不是合法的包名（1-255 字符，不能以 . 或空格开头/结尾，不能含 <>&'":/\\|?*）`);
}
const urlMatch = (manifest.url || "").match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/);
if (!urlMatch) {
  errors.push(`url 必须是 https://github.com/owner/repo 形式，当前: ${manifest.url}`);
} else if (manifest.name && urlMatch[2].toLowerCase() !== manifest.name.toLowerCase()) {
  warnings.push(`name "${manifest.name}" 与仓库名 "${urlMatch[2]}" 不一致（官方模板要求一致）`);
}
// version: semver
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(manifest.version || "")) {
  errors.push(`version "${manifest.version}" 不符合 semver 规范`);
}
// 多语言展示字段: default 必填
for (const field of ["displayName", "description", "readme"]) {
  if (!manifest[field] || !manifest[field].default) {
    errors.push(`${field}.default 缺失，集市列表与详情页需要 default 语种`);
  }
}

// ---- 校验 dist 必要文件 ----
function requireFile(rel, reason) {
  const full = join(distDir, rel);
  if (!existsSync(full) || !statSync(full).isFile()) {
    errors.push(`dist 缺少必要文件: ${rel}（${reason}）`);
    return null;
  }
  return full;
}
const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".webp", ".avif"];
function checkImage(rel, maxBytes) {
  const full = requireFile(rel, "plugin.json 已声明");
  if (!full) return;
  const ext = extname(rel).toLowerCase();
  if (!IMAGE_EXTS.includes(ext)) {
    errors.push(`${rel} 格式不支持（仅 ${IMAGE_EXTS.join(" / ")}，SVG 不支持）`);
  }
  const size = statSync(full).size;
  if (size > maxBytes) {
    errors.push(`${rel} 大小 ${(size / 1024).toFixed(1)}KiB 超过上限 ${(maxBytes / 1024).toFixed(0)}KiB`);
  }
}
requireFile("plugin.json", "包清单");
requireFile("index.js", "前端入口");
if (manifest.readme?.default) requireFile(manifest.readme.default, "集市详情页 README");
if (manifest.icon) checkImage(manifest.icon, 64 * 1024);
if (manifest.preview) checkImage(manifest.preview, 512 * 1024);
if (!existsSync(join(distDir, "i18n"))) {
  warnings.push("dist 中没有 i18n/ 目录（多语言插件需要打包到该目录）");
}
// 构建产物过期检查
const distManifest = JSON.parse(readFileSync(join(distDir, "plugin.json"), "utf8"));
if (distManifest.name !== manifest.name || distManifest.version !== manifest.version) {
  errors.push(`dist/plugin.json（${distManifest.name}@${distManifest.version}）与根目录 plugin.json（${manifest.name}@${manifest.version}）不一致，请重新构建`);
}

if (errors.length > 0) {
  console.error("校验未通过:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

// ---- 打包 ----
function collectFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === ".DS_Store") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectFiles(full));
    else out.push(relative(distDir, full));
  }
  return out;
}
const files = collectFiles(distDir);

const zip = new JSZip();
for (const rel of files) {
  zip.file(rel.split("\\").join("/"), readFileSync(join(distDir, rel)));
}
if (!files.includes("index.css")) {
  zip.file("index.css", "");
  warnings.push("dist 中没有 index.css，已补充空文件（官方包清单要求）");
}

const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
writeFileSync(output, buf);

const totalSize = files.reduce((sum, rel) => sum + statSync(join(distDir, rel)).size, 0);
console.log(`已生成 ${output}`);
console.log(`  包名: ${manifest.name}@${manifest.version}`);
console.log(`  文件: ${files.length} 个，原始 ${totalSize} B，压缩后 ${buf.length} B`);
for (const w of warnings) console.log(`  警告: ${w}`);
console.log("下一步:");
console.log("  1. GitHub 仓库创建 Release（tag 用版本号），上传 package.zip 并发布");
console.log("  2. 首次上架: Fork siyuan-note/bazaar，在 plugins.txt 加一行 owner/repo 并提 PR");
