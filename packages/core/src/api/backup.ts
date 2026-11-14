// 全量备份 / 恢复 / 整库合并（本地文件，无后端）
// 备份包：manifest.json + data.json(全量 AppData) + assets/(可选原始资料) + README.txt
// 恢复 = 覆盖；合并 = 只并入备份课程与学习数据（不动当前全局配置），外键整体重映射。
// 纯函数（build/parse/prepare/merge）可单测；IO 封装在 exportBackupZip / restoreFromBackup / mergeFromBackup。
import JSZip from "jszip";
import type {
  AnswerRecord,
  AppData,
  Chapter,
  Course,
  ExamPaper,
  FlashCard,
  KnowledgePoint,
  Material,
  MaterialChapter,
  Question,
  QuestionAsk,
  ReviewSchedule,
  StudyLog,
  StudyLogMonthly,
  StudyPlan,
  StudyTask,
  TocMapping,
  WrongQuestion,
  ExplainRecord,
  AnswerStatsMonthly,
} from "../types/appData";
import { createEmptyData } from "../types/appData";
import { nextId, now } from "./format";
import { getData, saveData } from "./storage";
import { uploadAsset } from "./material";
import { packageAssetRef } from "./coursePackage";
import { getBridgeSafe } from "@/bridge";
import { isValidAssetPath } from "../utils/assetPath";

export const BACKUP_FORMAT = "ai-study-backup";
export const BACKUP_VERSION = 1;

export interface BackupOptions {
  /** 含原始资料文件（打包进 assets/）；默认 true */
  includeAssets?: boolean;
  /** 含 API Key（已加密）；默认 true。文件含密钥材料，等同于明文，导出后勿分享 */
  includeApiKeys?: boolean;
}

export interface BackupCounts {
  courses: number;
  chapters: number;
  kps: number;
  materials: number;
  questions: number;
  examPapers: number;
  cards: number;
  answerRecords: number;
  wrongQuestions: number;
  reviewSchedules: number;
  studyLogs: number;
  explainRecords: number;
}

export interface BackupManifest {
  format: string;
  version: number;
  createdAt: string;
  /** 生成备份的宿主端（siyuan / fnos / unknown）；恢复时据此决定是否保留宿主文档/资源绑定 */
  host: string;
  options: { assets: boolean; apiKeys: boolean };
  counts: BackupCounts;
  note: string;
}

const ARRAY_KEYS = [
  "providers",
  "models",
  "taskModels",
  "logs",
  "courses",
  "chapters",
  "knowledgePoints",
  "materials",
  "materialChapters",
  "tocMappings",
  "questions",
  "examPapers",
  "answerRecords",
  "questionAsks",
  "wrongQuestions",
  "studyPlans",
  "studyTasks",
  "explainRecords",
  "reviewSchedules",
  "flashCards",
  "studyLogs",
  "studyLogMonthly",
  "answerStatsMonthly",
] as const;
type ArrayKey = (typeof ARRAY_KEYS)[number];

type RawAppData = Partial<AppData> & Record<string, unknown>;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function currentHost(): string {
  return getBridgeSafe()?.capabilities?.host ?? "unknown";
}

function stamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/** 备份数据统计（manifest 与 UI 共用） */
export function backupCounts(data: AppData): BackupCounts {
  return {
    courses: data.courses.length,
    chapters: data.chapters.length,
    kps: data.knowledgePoints.length,
    materials: data.materials.length,
    questions: data.questions.length,
    examPapers: data.examPapers.length,
    cards: data.flashCards.length,
    answerRecords: data.answerRecords.length,
    wrongQuestions: data.wrongQuestions.length,
    reviewSchedules: data.reviewSchedules.length,
    studyLogs: data.studyLogs.length,
    explainRecords: data.explainRecords.length,
  };
}

/** 构建待导出的全量数据（深拷贝；可选剔除 API Key）；纯 */
export function buildBackupData(data: AppData, opts: BackupOptions = {}): AppData {
  const includeApiKeys = opts.includeApiKeys ?? true;
  const out = clone(data);
  if (!includeApiKeys) {
    for (const p of out.providers) p.apiKey = "";
  }
  return out;
}

export function buildBackupManifest(data: AppData, opts: BackupOptions = {}): BackupManifest {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: now(),
    host: currentHost(),
    options: {
      assets: opts.includeAssets ?? true,
      apiKeys: opts.includeApiKeys ?? true,
    },
    counts: backupCounts(data),
    note: "AI 智能学习全量备份。恢复会覆盖当前全部数据；请勿分享含 API Key 的备份文件。",
  };
}

/** 校验并补齐备份数据结构；关键数组缺失/类型错误视为损坏（防静默恢复成空库） */
export function normalizeBackupData(raw: unknown): AppData {
  if (!raw || typeof raw !== "object") throw new Error("备份数据损坏：data.json 不是对象");
  const src = raw as RawAppData;
  for (const key of ARRAY_KEYS) {
    if (!Array.isArray(src[key])) throw new Error(`备份数据损坏：缺少 ${key}`);
  }
  if (!src.settings || typeof src.settings !== "object") throw new Error("备份数据损坏：缺少 settings");
  const empty = createEmptyData();
  const out = empty;
  for (const key of ARRAY_KEYS) {
    (out as unknown as Record<string, unknown>)[key] = src[key];
  }
  out.settings = { ...empty.settings, ...(src.settings as AppData["settings"]) };
  if (src.promptTemplates && typeof src.promptTemplates === "object") {
    out.promptTemplates = src.promptTemplates as AppData["promptTemplates"];
  }
  if (typeof src.cryptoKeyMaterial === "string") out.cryptoKeyMaterial = src.cryptoKeyMaterial;
  if (src.reminders && typeof src.reminders === "object") out.reminders = src.reminders as AppData["reminders"];
  if (src.docRegions && typeof src.docRegions === "object") out.docRegions = src.docRegions as AppData["docRegions"];
  if (src.conversationsDocs && typeof src.conversationsDocs === "object") {
    out.conversationsDocs = src.conversationsDocs as AppData["conversationsDocs"];
  }
  return out;
}

export interface BackupZipResult {
  zip: JSZip;
  manifest: BackupManifest;
  assetFiles: number;
}

/** 组装备份 zip（manifest + data + README + assets/）；不含下载（可单测） */
export async function buildBackupZip(data: AppData, opts: BackupOptions = {}): Promise<BackupZipResult> {
  const zip = new JSZip();
  const manifest = buildBackupManifest(data, opts);
  zip.file("data.json", JSON.stringify(data), { compression: "DEFLATE" });
  zip.file("manifest.json", JSON.stringify(manifest, null, 2), { compression: "DEFLATE" });
  zip.file(
    "README.txt",
    [
      "AI 智能学习全量备份",
      `生成时间：${manifest.createdAt}`,
      `课程 ${manifest.counts.courses} / 知识点 ${manifest.counts.kps} / 题目 ${manifest.counts.questions}`,
      "",
      "恢复方式：插件「设置 → 备份与恢复 → 从备份恢复」，选择本 zip 文件。",
      "注意：恢复会覆盖当前全部数据（建议先用「导出全量备份」保底）。",
      manifest.options.apiKeys ? "本文件包含 API Key（加密存储但可被直接使用），请勿分享。" : "本文件不包含 API Key。",
      "",
    ].join("\n"),
    { compression: "DEFLATE" },
  );

  let assetFiles = 0;
  if (opts.includeAssets ?? true) {
    for (const m of data.materials) {
      // NAS 引用不复制副本（同端恢复仍指向原文件）；其余上传件打包
      if (m.source === "nas" || !m.assetPath) continue;
      if (!isValidAssetPath(m.assetPath)) continue;
      try {
        const res = await fetch(m.assetPath);
        if (!res.ok) continue;
        zip.file(`assets/${packageAssetRef(m)}`, await res.blob(), { compression: "STORE" });
        assetFiles += 1;
      } catch {
        // 读不到原始文件则跳过（正文已备份）
      }
    }
  }
  return { zip, manifest, assetFiles };
}

/** 校验并解析备份 zip（可单测） */
export async function parseBackupZip(zip: JSZip): Promise<{ manifest: BackupManifest; data: AppData }> {
  const manifestEntry = zip.file("manifest.json");
  if (!manifestEntry) throw new Error("不是有效的备份：缺少 manifest.json");
  const manifest = JSON.parse(await manifestEntry.async("string")) as Partial<BackupManifest>;
  if (manifest.format !== BACKUP_FORMAT) throw new Error("不是有效的备份：格式不符");
  if ((manifest.version ?? 0) > BACKUP_VERSION) {
    throw new Error("备份版本过新，请升级插件后重试");
  }
  const dataEntry = zip.file("data.json");
  if (!dataEntry) throw new Error("不是有效的备份：缺少 data.json");
  const data = normalizeBackupData(JSON.parse(await dataEntry.async("string")));
  const fullManifest: BackupManifest = {
    format: BACKUP_FORMAT,
    version: manifest.version ?? BACKUP_VERSION,
    createdAt: manifest.createdAt ?? "",
    host: manifest.host ?? "unknown",
    options: {
      assets: manifest.options?.assets ?? false,
      apiKeys: manifest.options?.apiKeys ?? false,
    },
    counts: manifest.counts ?? backupCounts(data),
    note: manifest.note ?? "",
  };
  return { manifest: fullManifest, data };
}

export interface ParsedBackup {
  fileName: string;
  manifest: BackupManifest;
  data: AppData;
  zip: JSZip;
}

export async function readBackupFile(file: File): Promise<ParsedBackup> {
  const zip = await JSZip.loadAsync(file);
  const { manifest, data } = await parseBackupZip(zip);
  return { fileName: file.name, manifest, data, zip };
}

export interface ExportBackupSummary {
  fileName: string;
  counts: BackupCounts;
  assetFiles: number;
  bytes: number;
}

/** 导出全量备份并触发浏览器下载（IO）；prefix 用于区分常规备份与恢复前兜底 */
export async function exportBackupZip(
  opts: BackupOptions = {},
  prefix = "aistudy-backup",
  onProgress?: (percent: number) => void,
): Promise<ExportBackupSummary> {
  const data = await getData();
  const exportData = buildBackupData(data, opts);
  const { zip, manifest, assetFiles } = await buildBackupZip(exportData, opts);
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" }, (meta) => {
    onProgress?.(meta.percent);
  });
  const fileName = `${prefix}-${stamp()}.zip`;
  downloadBlob(blob, fileName);
  return { fileName, counts: manifest.counts, assetFiles, bytes: blob.size };
}

/** 跨端是否保留宿主文档 / 资源绑定：仅同一宿主端保留 */
function keepsHostBindings(manifest: BackupManifest, host: string): boolean {
  return !!manifest.host && manifest.host !== "unknown" && manifest.host === host;
}

/** 覆盖恢复前的数据清洗：跨端剥离宿主绑定与失效资源路径；纯 */
export function prepareRestoreData(data: AppData, manifest: BackupManifest, host: string): AppData {
  const out = clone(data);
  if (keepsHostBindings(manifest, host)) return out;
  out.courses = out.courses.map((c) => ({ ...c, siyuanDocId: null }));
  out.chapters = out.chapters.map((c) => ({ ...c, siyuanBlockId: null }));
  out.knowledgePoints = out.knowledgePoints.map((k) => ({
    ...k,
    blockId: null,
    blockName: undefined,
  }));
  out.materials = out.materials.map((m) => ({ ...m, siyuanDocId: null, assetPath: "" }));
  out.settings = { ...out.settings, persistToSiyuan: false };
  delete out.conversationsDocs;
  delete out.docRegions;
  return out;
}

export interface AssetPlanItem {
  /** 目标数据中的资料 id */
  materialId: number;
  /** zip 内 assets/ 下的文件名 */
  ref: string;
}

function materialPlan(
  materials: Material[],
  targetIdOf: (m: Material) => number,
): AssetPlanItem[] {
  const plan: AssetPlanItem[] = [];
  for (const m of materials) {
    if (m.source === "nas" || !m.assetPath) continue;
    plan.push({ materialId: targetIdOf(m), ref: packageAssetRef(m) });
  }
  return plan;
}

async function uploadPlannedAssets(
  zip: JSZip,
  plan: AssetPlanItem[],
  data: AppData,
  manifest: BackupManifest,
  host: string,
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const sameHost = keepsHostBindings(manifest, host);
  const byId = new Map(data.materials.map((m) => [m.id, m]));
  let done = 0;
  let uploaded = 0;
  for (const item of plan) {
    done += 1;
    onProgress?.(done, plan.length);
    const material = byId.get(item.materialId);
    if (!material) continue;
    const entry = zip.file(`assets/${item.ref}`);
    if (!entry) {
      if (!sameHost) material.assetPath = "";
      continue;
    }
    try {
      const blob = await entry.async("blob");
      const cleanName = item.ref.replace(/^\d+-/, "") || "file";
      material.assetPath = await uploadAsset(new File([blob], cleanName, { type: blob.type || undefined }));
      uploaded += 1;
    } catch {
      if (!sameHost) material.assetPath = "";
    }
  }
  return uploaded;
}

export interface RestoreOutcome {
  mode: "replace" | "merge";
  counts: BackupCounts;
  assetFiles: number;
  skippedCourses?: number;
}

/** 覆盖恢复（IO）：先自动导出当前数据兜底，再清洗、上传资源、落盘 */
export async function restoreFromBackup(
  parsed: ParsedBackup,
  opts: { onProgress?: (done: number, total: number, phase: string) => void } = {},
): Promise<RestoreOutcome> {
  const host = currentHost();
  opts.onProgress?.(0, 1, "正在导出当前数据兜底…");
  await exportBackupZip({ includeAssets: false, includeApiKeys: true }, "aistudy-prerestore");

  const restored = prepareRestoreData(parsed.data, parsed.manifest, host);
  const plan = materialPlan(parsed.data.materials, (m) => m.id);
  const assetFiles = await uploadPlannedAssets(parsed.zip, plan, restored, parsed.manifest, host, (d, t) =>
    opts.onProgress?.(d, t, "正在恢复原始资料…"),
  );
  await saveData(restored);
  return { mode: "replace", counts: parsed.manifest.counts, assetFiles };
}

// ===== 整库合并 =====

export interface MergeStats extends BackupCounts {
  /** 因「同名 + 同创建时间」被视为重复而跳过的课程数 */
  skippedCourses: number;
}

export interface RestoreMergeResult {
  data: AppData;
  stats: MergeStats;
  assetPlan: AssetPlanItem[];
}

function allocateIds(ids: number[], base: number): Record<number, number> {
  const map: Record<number, number> = {};
  const sorted = [...new Set(ids)].sort((a, b) => a - b);
  sorted.forEach((id, i) => {
    map[id] = base + i;
  });
  return map;
}

function remapCsv(csv: string | undefined, map: Record<number, number>): string {
  if (!csv) return "";
  return csv
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0 && map[n] !== undefined)
    .map((n) => map[n])
    .join(",");
}

/** 把备份并入现有数据（纯）：只新增课程与学习数据，全局配置保持现状；外键整体重映射 */
export function mergeBackupIntoData(
  backup: AppData,
  existing: AppData,
  opts: { host: string; backupHost: string },
): RestoreMergeResult {
  const sameHost = !!opts.backupHost && opts.backupHost !== "unknown" && opts.backupHost === opts.host;
  const existingNames = new Set(existing.courses.map((c) => c.name));
  // 重复判定：同名同创建时间；也把此前合并时改名的「（导入N）」视为同一门（保证重复导入幂等）
  const isDuplicate = (c: Course) =>
    existing.courses.some(
      (e) => e.createTime === c.createTime && (e.name === c.name || e.name.startsWith(`${c.name}（导入`)),
    );
  const imported = backup.courses.filter((c) => !isDuplicate(c));
  const skippedCourses = backup.courses.length - imported.length;
  const importIds = new Set(imported.map((c) => c.id));

  const courseMap: Record<number, number> = {};
  const mergedNames = new Map<number, string>();
  let nextCourseId = nextId(existing.courses);
  for (const c of imported) {
    let name = c.name;
    let i = 1;
    while (existingNames.has(name)) {
      name = `${c.name}（导入${i > 1 ? i : ""}）`;
      i += 1;
    }
    existingNames.add(name);
    courseMap[c.id] = nextCourseId;
    mergedNames.set(c.id, name);
    nextCourseId += 1;
  }

  const take = <T extends { courseId: number }>(arr: T[]): T[] => arr.filter((x) => importIds.has(x.courseId));
  const chapters = take(backup.chapters);
  const kps = take(backup.knowledgePoints);
  const materials = take(backup.materials);
  const questions = take(backup.questions);
  const papers = take(backup.examPapers);
  const cards = take(backup.flashCards);
  const plans = take(backup.studyPlans);
  const explainRecords = take(backup.explainRecords);
  const questionAsks = take(backup.questionAsks);
  const studyLogs = take(backup.studyLogs);
  const monthlyLogs = take(backup.studyLogMonthly);
  const monthlyAnswers = take(backup.answerStatsMonthly);
  const tocMappings = take(backup.tocMappings);

  const qCourse = new Map(backup.questions.map((q) => [q.id, q.courseId]));
  const kpCourse = new Map(backup.knowledgePoints.map((k) => [k.id, k.courseId]));
  const cardCourse = new Map(backup.flashCards.map((c) => [c.id, c.courseId]));
  const questionIds = new Set(questions.map((q) => q.id));
  const answerRecords = backup.answerRecords.filter((r) => questionIds.has(r.qId));
  const wrongQuestions = backup.wrongQuestions.filter((w) => questionIds.has(w.qId));
  const planIds = new Set(plans.map((p) => p.id));
  const studyTasks = backup.studyTasks.filter((t) => planIds.has(t.planId));
  const reviewSchedules = backup.reviewSchedules.filter((s) => {
    const c =
      (s.kpId != null ? kpCourse.get(s.kpId) : undefined) ??
      (s.qId != null ? qCourse.get(s.qId) : undefined) ??
      (s.cardId != null ? cardCourse.get(s.cardId) : undefined);
    return c != null && importIds.has(c);
  });
  const materialIds = new Set(materials.map((m) => m.id));
  const materialChapters = backup.materialChapters.filter((mc) => materialIds.has(mc.materialId));

  const chapterMap = allocateIds(chapters.map((c) => c.id), nextId(existing.chapters));
  const kpMap = allocateIds(kps.map((k) => k.id), nextId(existing.knowledgePoints));
  const materialMap = allocateIds(materials.map((m) => m.id), nextId(existing.materials));
  const questionMap = allocateIds(questions.map((q) => q.id), nextId(existing.questions));
  const paperMap = allocateIds(papers.map((p) => p.id), nextId(existing.examPapers));
  const validCards = cards.filter((c) => kpMap[c.kpId] !== undefined);
  const cardMap = allocateIds(validCards.map((c) => c.id), nextId(existing.flashCards));
  const planMap = allocateIds(plans.map((p) => p.id), nextId(existing.studyPlans));
  const taskMap = allocateIds(studyTasks.map((t) => t.id), nextId(existing.studyTasks));
  const recordMap = allocateIds(answerRecords.map((r) => r.id), nextId(existing.answerRecords));
  const wrongMap = allocateIds(wrongQuestions.map((w) => w.id), nextId(existing.wrongQuestions));
  const explainMap = allocateIds(explainRecords.map((r) => r.id), nextId(existing.explainRecords));
  const askMap = allocateIds(questionAsks.map((a) => a.id), nextId(existing.questionAsks));
  const reviewMap = allocateIds(reviewSchedules.map((r) => r.id), nextId(existing.reviewSchedules));
  const tocMap = allocateIds(tocMappings.map((t) => t.id), nextId(existing.tocMappings));
  let nextMcId = nextId(existing.materialChapters);

  const newCourses: Course[] = imported.map((c) => ({
    ...c,
    id: courseMap[c.id],
    name: mergedNames.get(c.id) ?? c.name,
    siyuanDocId: sameHost ? c.siyuanDocId : null,
    modelId: null,
  }));

  const newChapters: Chapter[] = chapters.map((c) => ({
    ...c,
    id: chapterMap[c.id],
    courseId: courseMap[c.courseId],
    parentId: c.parentId != null && chapterMap[c.parentId] !== undefined ? chapterMap[c.parentId] : null,
    siyuanBlockId: sameHost ? c.siyuanBlockId : null,
  }));

  const newKps: KnowledgePoint[] = kps.map((k) => ({
    ...k,
    id: kpMap[k.id],
    courseId: courseMap[k.courseId],
    chapterId: k.chapterId != null && chapterMap[k.chapterId] !== undefined ? chapterMap[k.chapterId] : null,
    blockId: sameHost ? k.blockId : null,
    blockName: sameHost ? k.blockName : undefined,
    prevKpIds: remapCsv(k.prevKpIds, kpMap),
    sourceAssetIds: remapCsv(k.sourceAssetIds, materialMap),
  }));

  const newMaterials: Material[] = materials.map((m) => ({
    ...m,
    id: materialMap[m.id],
    courseId: courseMap[m.courseId],
    siyuanDocId: sameHost ? m.siyuanDocId : null,
    assetPath: sameHost ? m.assetPath : "",
  }));

  const newMaterialChapters: MaterialChapter[] = materialChapters
    .filter((mc) => materialMap[mc.materialId] !== undefined && chapterMap[mc.chapterId] !== undefined)
    .map((mc) => ({
      id: nextMcId++,
      materialId: materialMap[mc.materialId],
      chapterId: chapterMap[mc.chapterId],
    }));

  const newTocMappings: TocMapping[] = tocMappings
    .filter((t) => materialMap[t.materialId] !== undefined && chapterMap[t.chapterId] !== undefined)
    .map((t) => ({
      id: tocMap[t.id],
      materialId: materialMap[t.materialId],
      courseId: courseMap[t.courseId],
      materialPath: t.materialPath,
      chapterId: chapterMap[t.chapterId],
    }));

  const newQuestions: Question[] = questions.map((q) => ({
    ...q,
    id: questionMap[q.id],
    courseId: courseMap[q.courseId],
    paperId: q.paperId != null && paperMap[q.paperId] !== undefined ? paperMap[q.paperId] : null,
    kpIds: remapCsv(q.kpIds, kpMap),
  }));

  const newPapers: ExamPaper[] = papers.map((p) => ({
    ...p,
    id: paperMap[p.id],
    courseId: courseMap[p.courseId],
  }));

  const newCards: FlashCard[] = validCards.map((c) => ({
    ...c,
    id: cardMap[c.id],
    courseId: courseMap[c.courseId],
    kpId: kpMap[c.kpId],
  }));

  const newAnswerRecords: AnswerRecord[] = answerRecords.map((r) => ({
    ...r,
    id: recordMap[r.id],
    qId: questionMap[r.qId],
  }));

  const newWrongs: WrongQuestion[] = wrongQuestions.map((w) => ({
    ...w,
    id: wrongMap[w.id],
    qId: questionMap[w.qId],
    recordId: w.recordId != null && recordMap[w.recordId] !== undefined ? recordMap[w.recordId] : null,
  }));

  const newPlans: StudyPlan[] = plans.map((p) => ({
    ...p,
    id: planMap[p.id],
    courseId: courseMap[p.courseId],
  }));

  const newTasks: StudyTask[] = studyTasks.map((t) => ({
    ...t,
    id: taskMap[t.id],
    planId: planMap[t.planId],
    chapterId: t.chapterId != null && chapterMap[t.chapterId] !== undefined ? chapterMap[t.chapterId] : null,
    kpId: t.kpId != null && kpMap[t.kpId] !== undefined ? kpMap[t.kpId] : null,
  }));

  const newExplains: ExplainRecord[] = explainRecords
    .filter((r) => kpMap[r.kpId] !== undefined)
    .map((r) => ({
      ...r,
      id: explainMap[r.id],
      courseId: courseMap[r.courseId],
      kpId: kpMap[r.kpId],
    }));

  const newAsks: QuestionAsk[] = questionAsks
    .filter((a) => questionMap[a.qId] !== undefined)
    .map((a) => ({
      ...a,
      id: askMap[a.id],
      courseId: courseMap[a.courseId],
      qId: questionMap[a.qId],
    }));

  const newReviews: ReviewSchedule[] = reviewSchedules.map((s) => ({
    ...s,
    id: reviewMap[s.id],
    kpId: s.kpId != null && kpMap[s.kpId] !== undefined ? kpMap[s.kpId] : null,
    qId: s.qId != null && questionMap[s.qId] !== undefined ? questionMap[s.qId] : null,
    cardId: s.cardId != null && cardMap[s.cardId] !== undefined ? cardMap[s.cardId] : null,
  }));

  let nextLogId = nextId(existing.studyLogs);
  const newLogs: StudyLog[] = studyLogs.map((l) => ({
    ...l,
    id: nextLogId++,
    courseId: courseMap[l.courseId],
    kpId: l.kpId != null && kpMap[l.kpId] !== undefined ? kpMap[l.kpId] : null,
    taskId: l.taskId != null && taskMap[l.taskId] !== undefined ? taskMap[l.taskId] : null,
  }));

  const newMonthlyLogs: StudyLogMonthly[] = monthlyLogs.map((m) => ({
    ...m,
    courseId: courseMap[m.courseId],
  }));
  const newMonthlyAnswers: AnswerStatsMonthly[] = monthlyAnswers.map((m) => ({
    ...m,
    courseId: courseMap[m.courseId],
  }));

  // 学习对话落库文档：key 随课程/章节 id 重映射；跨端不保留文档绑定
  let newDocs: AppData["conversationsDocs"];
  if (sameHost && backup.conversationsDocs) {
    newDocs = {};
    for (const [key, val] of Object.entries(backup.conversationsDocs)) {
      let mapped: string | null = null;
      if (key.startsWith("course-")) {
        const oldId = Number(key.slice("course-".length));
        if (courseMap[oldId] !== undefined) mapped = `course-${courseMap[oldId]}`;
      } else {
        const oldId = Number(key);
        if (chapterMap[oldId] !== undefined) mapped = String(chapterMap[oldId]);
      }
      if (mapped) newDocs[mapped] = val;
    }
  }

  const merged: AppData = {
    ...existing,
    courses: [...existing.courses, ...newCourses],
    chapters: [...existing.chapters, ...newChapters],
    knowledgePoints: [...existing.knowledgePoints, ...newKps],
    materials: [...existing.materials, ...newMaterials],
    materialChapters: [...existing.materialChapters, ...newMaterialChapters],
    tocMappings: [...existing.tocMappings, ...newTocMappings],
    questions: [...existing.questions, ...newQuestions],
    examPapers: [...existing.examPapers, ...newPapers],
    flashCards: [...existing.flashCards, ...newCards],
    answerRecords: [...existing.answerRecords, ...newAnswerRecords],
    wrongQuestions: [...existing.wrongQuestions, ...newWrongs],
    studyPlans: [...existing.studyPlans, ...newPlans],
    studyTasks: [...existing.studyTasks, ...newTasks],
    explainRecords: [...existing.explainRecords, ...newExplains],
    questionAsks: [...existing.questionAsks, ...newAsks],
    reviewSchedules: [...existing.reviewSchedules, ...newReviews],
    studyLogs: [...existing.studyLogs, ...newLogs],
    studyLogMonthly: [...existing.studyLogMonthly, ...newMonthlyLogs],
    answerStatsMonthly: [...existing.answerStatsMonthly, ...newMonthlyAnswers],
    conversationsDocs: newDocs ? { ...(existing.conversationsDocs ?? {}), ...newDocs } : existing.conversationsDocs,
    docRegions: sameHost ? { ...(backup.docRegions ?? {}), ...(existing.docRegions ?? {}) } : existing.docRegions,
  };

  const stats: MergeStats = {
    courses: newCourses.length,
    chapters: newChapters.length,
    kps: newKps.length,
    materials: newMaterials.length,
    questions: newQuestions.length,
    examPapers: newPapers.length,
    cards: newCards.length,
    answerRecords: newAnswerRecords.length,
    wrongQuestions: newWrongs.length,
    reviewSchedules: newReviews.length,
    studyLogs: newLogs.length,
    explainRecords: newExplains.length,
    skippedCourses,
  };

  return {
    data: merged,
    stats,
    assetPlan: materialPlan(materials, (m) => materialMap[m.id]),
  };
}

/** 整库合并（IO）：重映射并把备份课程并入现有数据，上传其原始资料 */
export async function mergeFromBackup(
  parsed: ParsedBackup,
  opts: { onProgress?: (done: number, total: number, phase: string) => void } = {},
): Promise<RestoreOutcome> {
  const host = currentHost();
  const existing = await getData();
  const { data, stats, assetPlan } = mergeBackupIntoData(parsed.data, existing, {
    host,
    backupHost: parsed.manifest.host,
  });
  const assetFiles = await uploadPlannedAssets(parsed.zip, assetPlan, data, parsed.manifest, host, (d, t) =>
    opts.onProgress?.(d, t, "正在上传原始资料…"),
  );
  await saveData(data);
  return {
    mode: "merge",
    counts: stats,
    assetFiles,
    skippedCourses: stats.skippedCourses,
  };
}
