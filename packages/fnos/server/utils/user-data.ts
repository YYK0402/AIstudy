import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createEmptyData, type AppData, type CourseData } from "../../../core/src/types/appData";
import {
  courseStorageName,
  mergeAppData,
  normalizeCourseData,
  splitAppData,
} from "../../../core/src/utils/courseSplit";

/**
 * 数据布局（与思源端同一套 courseSplit 拆写规则）：
 *   {TRIM_PKGVAR}/data/<uid>/global.json    全局：服务商/模型/设置/日志 + 孤儿实体
 *   {TRIM_PKGVAR}/data/<uid>/course-<id>.json  每课程独立文件
 * 旧布局 {TRIM_PKGVAR}/data/<uid>.json（单文件）首次加载时自动迁移。
 */

function baseDir(): string {
  return process.env.TRIM_PKGVAR || join(process.cwd(), "var");
}

/** 用户数据目录：{base}/data/<uid>/（本地开发回退 cwd/var） */
function userDir(uid: string): string {
  if (!/^\d{1,10}$/.test(uid)) {
    throw new Error(`非法用户 ID: ${uid}`);
  }
  const dir = join(baseDir(), "data", uid);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function legacyFile(uid: string): string {
  return join(baseDir(), "data", `${uid}.json`);
}

function globalFile(uid: string): string {
  return join(userDir(uid), "global.json");
}

function courseFile(uid: string, courseId: number): string {
  return join(userDir(uid), `${courseStorageName(courseId)}.json`);
}

function readJson<T>(file: string): T | null {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch (e) {
    console.error(`[ai-study] 读取数据文件失败（${file}）:`, e);
    return null;
  }
}

/** 原子写（tmp + rename），避免写一半崩溃损坏数据 */
function writeJsonAtomic(file: string, value: unknown): void {
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(value));
  renameSync(tmp, file);
}

export function loadUserData(uid: string): AppData {
  userDir(uid); // 校验 uid
  // 新布局
  if (existsSync(globalFile(uid))) {
    const global = readJson<AppData>(globalFile(uid)) ?? createEmptyData();
    const courses = new Map<number, CourseData>();
    const dir = userDir(uid);
    for (const f of readdirSync(dir)) {
      const m = f.match(/^course-(\d+)\.json$/);
      if (!m) continue;
      const raw = readJson<unknown>(join(dir, f));
      if (raw !== null) courses.set(Number(m[1]), normalizeCourseData(raw));
    }
    return mergeAppData(global, courses);
  }
  // 旧单文件布局：拆写到新布局后删旧文件（先写新后删旧，中途崩溃也不丢数据）
  const legacy = readJson<AppData>(legacyFile(uid));
  if (legacy === null) return createEmptyData();
  const { global, courses } = splitAppData(legacy);
  writeJsonAtomic(globalFile(uid), global);
  for (const [id, cd] of courses) writeJsonAtomic(courseFile(uid, id), cd);
  rmSync(legacyFile(uid), { force: true });
  return mergeAppData(global, courses);
}

export interface SaveResult {
  /** 全局文件是否有变化落盘 */
  global: boolean;
  /** 有变化落盘的课程 id（core 据此增量刷新） */
  courseIds: number[];
}

/** 每 uid 一个提交队列：并发保存串行化，避免双窗口/双设备互覆盖（对齐思源端 commitQueue 语义） */
const commitQueues = new Map<string, Promise<unknown>>();

/** 拆成 全局 + 各课程文件分别落盘（仅写序列化结果有变化的文件）；返回脏集 */
export function saveUserData(uid: string, data: AppData): Promise<SaveResult> {
  userDir(uid); // 校验 uid（同步抛出，调用方可直接 catch）
  const prev = commitQueues.get(uid) ?? Promise.resolve();
  const run = prev.then(() => doSaveUserData(uid, data));
  commitQueues.set(uid, run.then(() => undefined, () => undefined));
  return run;
}

function doSaveUserData(uid: string, data: AppData): SaveResult {
  const { global, courses } = splitAppData(data);
  const dirty: SaveResult = { global: false, courseIds: [] };

  const gFile = globalFile(uid);
  const gSerialized = JSON.stringify(global);
  const gOld = existsSync(gFile) ? readFileSync(gFile, "utf8") : null;
  if (gOld !== gSerialized) {
    writeJsonAtomic(gFile, global);
    dirty.global = true;
  }

  const current = new Set(courses.keys());
  for (const [id, cd] of courses) {
    const f = courseFile(uid, id);
    const serialized = JSON.stringify(cd);
    const old = existsSync(f) ? readFileSync(f, "utf8") : null;
    if (old !== serialized) {
      writeJsonAtomic(f, cd);
      dirty.courseIds.push(id);
    }
  }

  // 删课后清理遗留课程文件（courseId 单调递增不会复用，物理删除安全；思源端 petal 无删除 API 故保留）
  const dir = userDir(uid);
  for (const f of readdirSync(dir)) {
    const m = f.match(/^course-(\d+)\.json$/);
    if (m && !current.has(Number(m[1]))) rmSync(join(dir, f), { force: true });
  }

  return dirty;
}

/** 资源文件目录：{TRIM_PKGVAR}/assets/{uid}（上传的原始资料，供重新解析） */
export function assetDir(uid: string): string {
  userDir(uid); // 校验 uid
  const dir = join(baseDir(), "assets", uid);
  mkdirSync(dir, { recursive: true });
  return dir;
}
