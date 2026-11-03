import { getData, saveData } from "./storage";
import {
  applyKpTreeDiff,
  computeKpTreeDiff,
  parseKpTreeMarkdown,
  type KpTreeDiff,
  type ParsedKpTree,
} from "../utils/kpTreeImport";

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
  const diff = computeKpTreeDiff(tree, chapters, kps);
  return { tree, diff, courseVerified: tree.courseId !== null || tree.courseName !== null, fileName: file.name };
}

/** 确认导入：应用变更并落盘 */
export async function confirmKpTreeImport(courseId: number, preview: KpTreeImportPreview): Promise<void> {
  const data = await getData();
  await saveData(applyKpTreeDiff(data, courseId, preview.tree, preview.diff));
}
