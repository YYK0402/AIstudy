import { getData, saveData } from "./storage";
import {
  applyKpTreeDiff,
  computeKpTreeDiff,
  effectiveNodeOf,
  parseKpTreeMarkdown,
  type KpTreeDiff,
  type ParsedKpTree,
} from "../utils/kpTreeImport";
import { scheduleKpRegionSync, syncChapterStructure } from "./kpDocSync";

export interface KpTreeImportPreview {
  tree: ParsedKpTree;
  diff: KpTreeDiff;
  /** false = 说明头与一级标题均缺失、课程身份无法校验，UI 需警示用户 */
  courseVerified: boolean;
  fileName: string;
}

/** 解析并校验导入文件，计算变更清单（不落盘） */
export async function previewKpTreeImport(file: File, courseId: number): Promise<KpTreeImportPreview> {
  const text = await file.text();
  const res = parseKpTreeMarkdown(text);
  if (!res.ok) throw new Error(`解析失败（第 ${res.line} 行）：${res.error}`);
  const tree = res.tree;
  if (!tree.importable) {
    throw new Error("该文件是「仅导出未掌握知识点」的过滤导出，不可用于导入。请取消过滤重新导出完整知识点树后再导入。");
  }

  const data = await getData();
  const course = data.courses.find((c) => c.id === courseId);
  if (!course) throw new Error("课程不存在，请刷新后重试");

  // 课程身份校验：优先说明头 course:ID；说明头被删时按一级标题课程名兜底
  if (tree.courseId !== null) {
    if (tree.courseId !== courseId) {
      const other = data.courses.find((c) => c.id === tree.courseId);
      throw new Error(`课程不匹配：文件属于「${other?.name ?? `课程 ${tree.courseId}`}」，当前为「${course.name}」`);
    }
  } else if (tree.courseName && !tree.courseName.includes(course.name) && !course.name.includes(tree.courseName)) {
    throw new Error(`课程不匹配：文件标题为「${tree.courseName}」，当前课程为「${course.name}」`);
  }

  const chapters = data.chapters.filter((c) => c.courseId === courseId);
  const kps = data.knowledgePoints.filter((k) => k.courseId === courseId);
  // md 文件位置即归属（N 级往返）：按全深度章节 id 比较
  const diff = computeKpTreeDiff(tree, chapters, kps, { nodeGranularity: "full" });
  return { tree, diff, courseVerified: tree.courseId !== null || tree.courseName !== null, fileName: file.name };
}

/** 确认导入：应用变更并落盘；思源端顺带同步章文档（建/删/改名/移动）与知识点区 */
export async function confirmKpTreeImport(courseId: number, preview: KpTreeImportPreview): Promise<void> {
  const data = await getData();
  const chapters = data.chapters.filter((c) => c.courseId === courseId);
  const oldMaxKp = data.knowledgePoints.reduce((m, k) => Math.max(m, k.id), 0);
  const oldMaxCh = data.chapters.reduce((m, c) => Math.max(m, c.id), 0);
  const affected = new Set<string>();
  const mark = (node: number | null): void => {
    affected.add(node === null ? "course" : String(node));
  };
  // 旧节点（落盘前口径）
  for (const u of preview.diff.updated) {
    const k = data.knowledgePoints.find((x) => x.id === u.id);
    if (k) mark(effectiveNodeOf(k, chapters));
  }
  for (const r of preview.diff.removed) {
    const k = data.knowledgePoints.find((x) => x.id === r.id);
    if (k) mark(effectiveNodeOf(k, chapters));
  }

  const nextData = applyKpTreeDiff(data, courseId, preview.tree, preview.diff);
  await saveData(nextData);

  // 新节点（落盘后口径）：updated 新归属 + 新增 KP + 新建章节
  const newChapters = nextData.chapters.filter((c) => c.courseId === courseId);
  const addedChapters = nextData.chapters.filter((c) => c.courseId === courseId && c.id > oldMaxCh);
  for (const u of preview.diff.updated) {
    const k = nextData.knowledgePoints.find((x) => x.id === u.id);
    if (k) mark(effectiveNodeOf(k, newChapters));
  }
  for (const k of nextData.knowledgePoints) {
    if (k.courseId === courseId && k.id > oldMaxKp) mark(effectiveNodeOf(k, newChapters));
  }
  for (const c of addedChapters) mark(c.id);

  // 章节结构变更 → 思源章文档操作（await，聚合提示）；再调度知识点区写回
  if (
    addedChapters.length > 0 ||
    preview.diff.chaptersRemoved.length > 0 ||
    preview.diff.chaptersUpdated.length > 0
  ) {
    await syncChapterStructure(courseId, preview.diff, addedChapters);
  }
  for (const key of affected) {
    void scheduleKpRegionSync(courseId, key === "course" ? null : Number(key));
  }
}
