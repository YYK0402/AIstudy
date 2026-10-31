import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

// public 目录以 serve.mjs 注入的 AI_STUDY_PUBLIC_DIR 为准；其余为开发/回退场景的常规位置
const runtimeDir = dirname(fileURLToPath(import.meta.url));

function candidatePublicDirs() {
  return [
    process.env.AI_STUDY_PUBLIC_DIR || "",
    join(process.cwd(), ".ui-dist"),
    join(process.cwd(), ".server-dist", "public"),
    join(runtimeDir, "..", "..", "public")
  ].filter(Boolean);
}

export function gatewayPrefix() {
  return process.env.GATEWAY_PREFIX || "/app/ai-study";
}

export function isAssetRequest(pathname: string) {
  return pathname.startsWith("/assets/") || pathname === "/favicon.ico" || extname(pathname) !== "";
}

export function stripGatewayPrefix(pathname: string) {
  const prefix = gatewayPrefix();
  if (pathname === prefix) {
    return "/";
  }
  if (pathname.startsWith(`${prefix}/`)) {
    return pathname.slice(prefix.length);
  }
  return pathname;
}

export function resolveUiFile(pathname: string) {
  const safePath = normalize(stripGatewayPrefix(pathname)).replace(/^(\.\.(\/|\\|$))+/, "");
  for (const baseDir of candidatePublicDirs()) {
    const filePath = join(baseDir, safePath);
    if (existsSync(filePath)) {
      return filePath;
    }
  }
  return null;
}

export async function readUiFile(pathname: string) {
  const filePath = resolveUiFile(pathname);
  if (!filePath) {
    return null;
  }
  return readFile(filePath);
}

export async function readUiIndexHtml() {
  for (const baseDir of candidatePublicDirs()) {
    const indexPath = join(baseDir, "index.html");
    if (existsSync(indexPath)) {
      return readFile(indexPath, "utf8");
    }
  }
  throw new Error("Unable to locate built UI index.html.");
}
