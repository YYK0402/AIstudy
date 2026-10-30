// 课程包导出 / 导入（第 0 步：本地点对点分享，无后端）
// 设计：build 产出「干净、可移植」的课程包（剔除个人学习状态与本地思源绑定）；
//       remap 在导入时把包内 id 重映射到接收方数据，重写所有外键。
// 纯函数（build/remap/apply）可单测；IO 封装在 exportCourseZip / importCourseZip。
import JSZip from "jszip";
import type {
  AppData,
  Chapter,
  Course,
  ExamPaper,
  FlashCard,
  KnowledgePoint,
  Material,
  MaterialChapter,
  Question,
} from "../types/appData";
import { nextId, now } from "./format";
import { getData, saveData } from "./storage";
import { uploadAsset } from "./material";

export const PACKAGE_FORMAT = "ai-study-course";
export const PACKAGE_VERSION = 1;

export interface CoursePackageOptions {
  /** 含题库 + 试卷；默认 true */
  includeQuestions?: boolean;
  /** 含闪卡；默认 false */
  includeCards?: boolean;
  /** 含原始资料文件（打包进 assets/）；默认 false */
  includeAssets?: boolean;
}

/** 课程包数据（内部 id 原样保留，导入时再重映射） */
export interface CoursePackageData {
  course: Course;
  chapters: Chapter[];
  knowledgePoints: KnowledgePoint[];
  materials: Material[];
  materialChapters: MaterialChapter[];
  questions: Question[];
  examPapers: ExamPaper[];
  flashCards: FlashCard[];
}

export interface RemappedCoursePackage {
  courseId: number;
  course: Course;
  chapters: Chapter[];
  knowledgePoints: KnowledgePoint[];
  materials: Material[];
  materialChapters: MaterialChapter[];
  questions: Question[];
  examPapers: ExamPaper[];
  flashCards: FlashCard[];
}

/** 包内资产文件名：id 前缀 + 安全化 basename（导入时据此在 assets/ 定位） */
export function packageAssetRef(m: Material): string {
  let base = m.name;
  const slash = Math.max(base.lastIndexOf("/"), base.lastIndexOf("\\"));
  if (slash >= 0) base = base.slice(slash + 1);
  const safe = base.replace(/[\\/:*?"<>|]/g, "_").trim();
  return `${m.id}-${safe || "file"}`;
}

/** 构建课程包：仅取目标课程、剔除个人学习状态与本地思源绑定（纯） */
export function buildCoursePackageData(data: AppData, courseId: number, opts: CoursePackageOptions = {}): CoursePackageData {
  const course = data.courses.find((c) => c.id === courseId);
  if (!course) throw new Error(`课程不存在（id=${courseId}）`);

  const includeQuestions = opts.includeQuestions ?? true;
  const includeCards = opts.includeCards ?? false;
  const includeAssets = opts.includeAssets ?? false;

  const chapters: Chapter[] = data.chapters
    .filter((c) => c.courseId === courseId)
    .map((c) => ({ ...c, siyuanBlockId: null }));
  const knowledgePoints: KnowledgePoint[] = data.knowledgePoints
    .filter((k) => k.courseId === courseId)
    .map((k) => ({
      ...k,
      blockId: null,
      blockName: undefined,
      mastery: "unlearn",
      askPrompt: undefined,
      askPromptContent: undefined,
    }));
  const materials: Material[] = data.materials
    .filter((m) => m.courseId === courseId)
    .map((m) => ({
      ...m,
      assetPath: includeAssets ? packageAssetRef(m) : "",
      siyuanDocId: null,
      status: "ok",
    }));

  const chapterIds = new Set(chapters.map((c) => c.id));
  const materialIds = new Set(materials.map((m) => m.id));
  const materialChapters: MaterialChapter[] = data.materialChapters.filter(
    (mc) => chapterIds.has(mc.chapterId) && materialIds.has(mc.materialId),
  );

  const questions: Question[] = includeQuestions
    ? data.questions.filter((q) => q.courseId === courseId)
    : [];
  const examPapers: ExamPaper[] = includeQuestions
    ? data.examPapers.filter((p) => p.courseId === courseId)
    : [];
  const flashCards: FlashCard[] = includeCards
    ? data.flashCards.filter((c) => c.courseId === courseId)
    : [];

  return {
    course: { ...course, siyuanDocId: null, modelId: null },
    chapters,
    knowledgePoints,
    materials,
    materialChapters,
    questions,
    examPapers,
    flashCards,
  };
}

/** 由一组原始 id 与起始 base 生成 旧id→新id 映射（升序稳定分配，均 > base-1 故不与现有冲突） */
function buildIdMap(ids: number[], base: number): Record<number, number> {
  const map: Record<number, number> = {};
  const sorted = [...new Set(ids)].sort((a, b) => a - b);
  sorted.forEach((id, i) => {
    map[id] = base + i;
  });
  return map;
}

/** CSV id 列表按映射重写；映射不到的悬挂引用丢弃 */
function remapCsv(csv: string, map: Record<number, number>): string {
  if (!csv) return "";
  return csv
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0 && map[n] !== undefined)
    .map((n) => map[n])
    .join(",");
}

/** 重映射：分配新 id、重写所有外键、规避同名（纯，接收方数据为 existing） */
export function remapCoursePackage(pkg: CoursePackageData, existing: AppData): RemappedCoursePackage {
  const courseId = nextId(existing.courses);
  const chapterIdMap = buildIdMap(pkg.chapters.map((c) => c.id), nextId(existing.chapters));
  const kpIdMap = buildIdMap(pkg.knowledgePoints.map((k) => k.id), nextId(existing.knowledgePoints));
  const materialIdMap = buildIdMap(pkg.materials.map((m) => m.id), nextId(existing.materials));
  const questionIdMap = buildIdMap(pkg.questions.map((q) => q.id), nextId(existing.questions));
  const paperIdMap = buildIdMap(pkg.examPapers.map((p) => p.id), nextId(existing.examPapers));
  const cardIdMap = buildIdMap(pkg.flashCards.map((c) => c.id), nextId(existing.flashCards));

  // 同名课程自动加「（导入）」后缀，必要时追加序号
  let name = pkg.course.name;
  let i = 1;
  while (existing.courses.some((c) => c.name === name)) {
    name = `${pkg.course.name}（导入${i > 1 ? i : ""}）`;
    i += 1;
  }

  const course: Course = { ...pkg.course, id: courseId, name, siyuanDocId: null, modelId: null };
  const chapters: Chapter[] = pkg.chapters.map((c) => ({
    ...c,
    id: chapterIdMap[c.id],
    courseId,
    parentId: c.parentId != null ? chapterIdMap[c.parentId] : null,
    siyuanBlockId: null,
  }));
  const knowledgePoints: KnowledgePoint[] = pkg.knowledgePoints.map((k) => ({
    ...k,
    id: kpIdMap[k.id],
    courseId,
    chapterId: k.chapterId != null ? chapterIdMap[k.chapterId] : null,
    prevKpIds: remapCsv(k.prevKpIds, kpIdMap),
    sourceAssetIds: remapCsv(k.sourceAssetIds, materialIdMap),
    blockId: null,
    blockName: undefined,
    mastery: "unlearn",
    askPrompt: undefined,
    askPromptContent: undefined,
  }));
  const materials: Material[] = pkg.materials.map((m) => ({
    ...m,
    id: materialIdMap[m.id],
    courseId,
    siyuanDocId: null,
    // assetPath 保留包内资产引用，由导入 IO 层解析/上传后替换
  }));
  const materialChapters: MaterialChapter[] = pkg.materialChapters.map((mc, idx) => ({
    id: nextId(existing.materialChapters) + idx,
    materialId: materialIdMap[mc.materialId],
    chapterId: chapterIdMap[mc.chapterId],
  }));
  const questions: Question[] = pkg.questions.map((q) => ({
    ...q,
    id: questionIdMap[q.id],
    courseId,
    paperId: q.paperId != null ? paperIdMap[q.paperId] : null,
    kpIds: remapCsv(q.kpIds, kpIdMap),
  }));
  const examPapers: ExamPaper[] = pkg.examPapers.map((p) => ({
    ...p,
    id: paperIdMap[p.id],
    courseId,
  }));
  const flashCards: FlashCard[] = pkg.flashCards.map((c) => ({
    ...c,
    id: cardIdMap[c.id],
    courseId,
    kpId: kpIdMap[c.kpId],
  }));

  return { courseId, course, chapters, knowledgePoints, materials, materialChapters, questions, examPapers, flashCards };
}

/** 把重映射结果并入现有数据，返回新的合并视图（纯） */
export function applyImportToData(existing: AppData, r: RemappedCoursePackage): AppData {
  return {
    ...existing,
    courses: [...existing.courses, r.course],
    chapters: [...existing.chapters, ...r.chapters],
    knowledgePoints: [...existing.knowledgePoints, ...r.knowledgePoints],
    materials: [...existing.materials, ...r.materials],
    materialChapters: [...existing.materialChapters, ...r.materialChapters],
    questions: [...existing.questions, ...r.questions],
    examPapers: [...existing.examPapers, ...r.examPapers],
    flashCards: [...existing.flashCards, ...r.flashCards],
  };
}

/** 包内统计（manifest 与 UI 汇总共用） */
export function packageCounts(pkg: CoursePackageData): {
  chapters: number;
  kps: number;
  materials: number;
  questions: number;
  cards: number;
} {
  return {
    chapters: pkg.chapters.length,
    kps: pkg.knowledgePoints.length,
    materials: pkg.materials.length,
    questions: pkg.questions.length,
    cards: pkg.flashCards.length,
  };
}

export interface CoursePackageManifest {
  format: string;
  version: number;
  createdAt: string;
  courseName: string;
  counts: ReturnType<typeof packageCounts>;
  note: string;
}

/** 组装课程包 zip（manifest + data + README + assets/）；不含下载（可单测） */
export async function buildCoursePackageZip(
  pkg: CoursePackageData,
  data: AppData,
  opts: CoursePackageOptions,
): Promise<{ zip: JSZip; manifest: CoursePackageManifest; assetFiles: number }> {
  const zip = new JSZip();
  zip.file("data.json", JSON.stringify(pkg, null, 2));
  const manifest: CoursePackageManifest = {
    format: PACKAGE_FORMAT,
    version: PACKAGE_VERSION,
    createdAt: now(),
    courseName: pkg.course.name,
    counts: packageCounts(pkg),
    note: "本课程包仅供学习交流，请仅分享你原创或有权分享的资料。",
  };
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  zip.file(
    "README.txt",
    `课程包：${pkg.course.name}\n由思源插件「AI 智能学习」生成\n\n导入方式：在插件首页点「导入课程包」选择本文件。\n\n注意：请仅分享你原创或有权分享的资料，尊重原始版权。`,
  );

  let assetFiles = 0;
  if (opts.includeAssets) {
    for (const m of pkg.materials) {
      if (!m.assetPath) continue; // 纯文本资料，无原始文件
      const orig = data.materials.find((x) => x.id === m.id);
      if (!orig?.assetPath) continue;
      try {
        const res = await fetch(orig.assetPath);
        if (!res.ok) continue;
        zip.file(`assets/${m.assetPath}`, await res.blob());
        assetFiles += 1;
      } catch {
        // 读不到原始文件则跳过（保留文本）
      }
    }
  }
  return { zip, manifest, assetFiles };
}

/** 校验并解析课程包 zip → 包数据（可单测） */
export async function parseCoursePackageZip(zip: JSZip): Promise<CoursePackageData> {
  const manifestEntry = zip.file("manifest.json");
  if (!manifestEntry) throw new Error("不是有效的课程包：缺少 manifest.json");
  const manifest = JSON.parse(await manifestEntry.async("string")) as { format?: string; version?: number };
  if (manifest.format !== PACKAGE_FORMAT) throw new Error("不是有效的课程包：格式不符");
  if ((manifest.version ?? 0) > PACKAGE_VERSION) throw new Error("课程包版本过新，请升级插件后重试");

  const dataEntry = zip.file("data.json");
  if (!dataEntry) throw new Error("不是有效的课程包：缺少 data.json");
  return JSON.parse(await dataEntry.async("string")) as CoursePackageData;
}

export interface ExportSummary {
  fileName: string;
  counts: ReturnType<typeof packageCounts>;
  /** 实际打包进 assets/ 的原始资料文件数 */
  assetFiles: number;
}

/** 导出课程包为 .zip 并触发浏览器下载（IO） */
export async function exportCourseZip(courseId: number, opts: CoursePackageOptions = {}): Promise<ExportSummary> {
  const data = await getData();
  const pkg = buildCoursePackageData(data, courseId, opts);
  const { zip, manifest, assetFiles } = await buildCoursePackageZip(pkg, data, opts);

  const blob = await zip.generateAsync({ type: "blob" });
  const safeName = pkg.course.name.replace(/[\\/:*?"<>|]/g, "_").trim() || "课程";
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const fileName = `${safeName}-AI研习课程-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.zip`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);

  return { fileName, counts: manifest.counts, assetFiles };
}

export interface ImportResult {
  courseId: number;
  courseName: string;
  counts: ReturnType<typeof packageCounts>;
  /** 成功上传的原始资料文件数 */
  assetFiles: number;
}

/** 导入课程包 .zip：校验 → 重映射 → 上传资产 → 落盘（IO） */
export async function importCourseZip(file: File): Promise<ImportResult> {
  const zip = await JSZip.loadAsync(file);
  const pkg = await parseCoursePackageZip(zip);

  const existing = await getData();
  const remapped = remapCoursePackage(pkg, existing);

  // 上传原始资料（若包内带 assets/）；失败则保留文本、清空 assetPath
  let assetFiles = 0;
  for (const m of remapped.materials) {
    if (!m.assetPath) continue;
    const entry = zip.file(`assets/${m.assetPath}`);
    if (!entry) {
      m.assetPath = "";
      continue;
    }
    try {
      const blob = await entry.async("blob");
      const cleanName = m.assetPath.replace(/^\d+-/, "") || "file";
      const newPath = await uploadAsset(new File([blob], cleanName, { type: blob.type || undefined }));
      m.assetPath = newPath;
      assetFiles += 1;
    } catch {
      m.assetPath = "";
    }
  }

  await saveData(applyImportToData(existing, remapped));

  return {
    courseId: remapped.courseId,
    courseName: remapped.course.name,
    counts: packageCounts(remapped),
    assetFiles,
  };
}
