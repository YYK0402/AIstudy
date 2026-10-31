#!/usr/bin/env node
// 打包前静态校验：manifest 字段、图标、脚本可执行性（发布检查清单的子集）
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const fnosDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = join(fnosDir, ".fnos-build/package");

const errors = [];
function check(cond, message) {
  if (!cond) errors.push(message);
}

const manifestPath = join(packageDir, "manifest");
check(existsSync(manifestPath), "manifest 缺失");
if (existsSync(manifestPath)) {
  const manifest = readFileSync(manifestPath, "utf8");
  const fields = manifest.split("\n").map((l) => l.split("=")[0]);
  for (const key of [
    "appname",
    "version",
    "sub_version",
    "display_name",
    "desc",
    "source",
    "platform",
    "os_min_version",
    "desktop_uidir",
    "desktop_applaunchname",
    "install_dep_apps",
    "ctl_stop",
    "micro_app",
    "checksum",
  ]) {
    check(fields.includes(key), `manifest 缺少字段: ${key}`);
  }
  check(!manifest.includes("__APP_TGZ_MD5__"), "manifest checksum 未替换（先执行 pack-app.sh）");
  const m = manifest.match(/^os_min_version=(\S+)/m);
  check(!!m && /^1\.\d+\.\d+$/.test(m[1]), "os_min_version 格式异常");
}

for (const icon of ["ICON.PNG", "ICON_256.PNG", "ICON_512.PNG"]) {
  check(existsSync(join(packageDir, icon)), `图标缺失: ${icon}`);
}
check(existsSync(join(packageDir, "config/privilege")), "config/privilege 缺失");
const resource = existsSync(join(packageDir, "config/resource"))
  ? JSON.parse(readFileSync(join(packageDir, "config/resource"), "utf8"))
  : null;
check(resource && Array.isArray(resource["api-scope"]), "config/resource 缺少 api-scope 声明");

const uiConfigPath = join(packageDir, "app/ui/config");
check(existsSync(uiConfigPath), "app/ui/config 缺失");
if (existsSync(uiConfigPath)) {
  const uiConfig = JSON.parse(readFileSync(uiConfigPath, "utf8"));
  const entries = Object.values(uiConfig[".url"] ?? {});
  check(entries.length === 1, "app/ui/config 应只有一个桌面入口");
  const entry = entries[0];
  check(entry.type === "iframe" && entry.gatewaySocket && entry.gatewayPrefix, "桌面入口缺网关配置");
}

check(existsSync(join(packageDir, "app/ui/index.html")), "app/ui/index.html 缺失");
check(existsSync(join(packageDir, "app/ui/assets/index.js")), "app/ui/assets/index.js 缺失");
check(existsSync(join(packageDir, "app/server/serve.mjs")), "app/server/serve.mjs 缺失");
check(existsSync(join(packageDir, "app/server/server/index.mjs")), "app/server/server/index.mjs 缺失");
for (const size of [32, 48, 64, 72, 96, 128, 256, 512]) {
  check(existsSync(join(packageDir, `app/ui/images/icon_${size}.png`)), `UI 图标缺失: icon_${size}.png`);
}

for (const script of ["main", "install_init", "install_callback", "upgrade_init", "upgrade_callback", "uninstall_init", "uninstall_callback", "config_init", "config_callback"]) {
  const p = join(packageDir, "cmd", script);
  check(existsSync(p), `cmd/${script} 缺失`);
  if (existsSync(p)) {
    check((statSync(p).mode & 0o111) !== 0, `cmd/${script} 缺少可执行权限`);
  }
}

// 图标尺寸抽查（sips 可用时）
try {
  const dims = execFileSync("sips", ["-g", "pixelWidth", join(packageDir, "ICON_256.PNG")], { encoding: "utf8" });
  check(/pixelWidth: 256/.test(dims), "ICON_256.PNG 尺寸不是 256px");
} catch {
  // sips 不可用（非 macOS）时跳过
}

if (errors.length > 0) {
  console.error(`包校验失败（${errors.length} 项）:`);
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log("包校验通过");
