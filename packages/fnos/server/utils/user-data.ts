import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createEmptyData, type AppData } from "../../../core/src/types/appData";

/** 数据目录：{TRIM_PKGVAR}/data（持久运行数据，本地开发回退 cwd/var） */
function dataDir(): string {
  const base = process.env.TRIM_PKGVAR || join(process.cwd(), "var");
  const dir = join(base, "data");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function dataFile(uid: string): string {
  if (!/^\d{1,10}$/.test(uid)) {
    throw new Error(`非法用户 ID: ${uid}`);
  }
  return join(dataDir(), `${uid}.json`);
}

export function loadUserData(uid: string): AppData {
  const file = dataFile(uid);
  if (!existsSync(file)) {
    return createEmptyData();
  }
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as AppData;
  } catch (e) {
    console.error(`[ai-study] 读取用户数据失败（${file}）:`, e);
    return createEmptyData();
  }
}

/** 原子写（tmp + rename），避免写一半崩溃损坏数据 */
export function saveUserData(uid: string, data: AppData): void {
  const file = dataFile(uid);
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data), "utf-8");
  renameSync(tmp, file);
}

/** 资源文件目录：{TRIM_PKGVAR}/assets/{uid}（上传的原始资料，供重新解析） */
export function assetDir(uid: string): string {
  dataFile(uid); // 校验 uid
  const base = process.env.TRIM_PKGVAR || join(process.cwd(), "var");
  const dir = join(base, "assets", uid);
  mkdirSync(dir, { recursive: true });
  return dir;
}
