// 学习计划列表视图 N 级分组：章 → 节 → … → 知识点（教材序）
import type { Chapter } from "../api";
import { buildChapterTreeFlat, type NestedChapter } from "./outline";

export interface PlanKpLine {
  kpId: number;
  chapterId: number | null;
  sort: number;
}

export type PlanGroupRow<T extends PlanKpLine> =
  | { kind: "chapter" | "unit"; label: string }
  | { kind: "kp"; line: T };

/**
 * KP 行按章节 N 级分组：子节点先、节点直属 KP 最后（与旧两级「节先、章直属最后」序一致）；
 * 节点行仅在其子树有 KP 时出现；chapterId 悬空/为空的行置末尾裸行。
 * 孤儿章（parentId 指向已删节点）提升顶层（buildChapterTreeFlat 同口径）。
 */
export function groupKpLines<T extends PlanKpLine>(lines: T[], chapters: Chapter[]): PlanGroupRow<T>[] {
  const roots = buildChapterTreeFlat(chapters);
  const linesByChapter = new Map<number, T[]>();
  for (const l of lines) {
    if (l.chapterId == null) continue;
    const list = linesByChapter.get(l.chapterId) ?? [];
    list.push(l);
    linesByChapter.set(l.chapterId, list);
  }
  for (const list of linesByChapter.values()) list.sort((a, b) => a.sort - b.sort);
  // 子树是否含 KP（后序一次遍历；必须计算全部子节点，不能短路——每个节点都要有判定结果）
  const hasContent = new Map<number, boolean>();
  const compute = (node: NestedChapter): boolean => {
    let v = (linesByChapter.get(node.chapter.id)?.length ?? 0) > 0;
    for (const child of node.children) {
      if (compute(child)) v = true;
    }
    hasContent.set(node.chapter.id, v);
    return v;
  };
  for (const root of roots) compute(root);
  const rows: PlanGroupRow<T>[] = [];
  const walk = (node: NestedChapter): void => {
    if (!hasContent.get(node.chapter.id)) return;
    rows.push({ kind: node.chapter.level === 1 ? "chapter" : "unit", label: node.chapter.name });
    for (const child of node.children) walk(child);
    for (const l of linesByChapter.get(node.chapter.id) ?? []) rows.push({ kind: "kp", line: l });
  };
  for (const root of roots) walk(root);
  const placed = new Set<number>();
  for (const r of rows) if (r.kind === "kp") placed.add(r.line.kpId);
  for (const l of lines.filter((x) => !placed.has(x.kpId)).sort((a, b) => a.sort - b.sort)) {
    rows.push({ kind: "kp", line: l });
  }
  return rows;
}

export interface CoverageKpLike {
  id: number;
  chapterId: number | null;
  sort: number;
}

export interface CoverageGroupRow<T extends CoverageKpLike> {
  /** 节标题：仅在该节点首行 KP 上显示（顶层节点不带，分组 label 即标题） */
  unit?: string;
  kp: T;
}

export interface CoverageGroup<T extends CoverageKpLike> {
  label: string;
  rows: CoverageGroupRow<T>[];
}

/**
 * 覆盖卡 KP 按章节 N 级分组：子节点先、节点直属 KP 最后（旧两级序）；
 * 节点标题绑在其首行直属 KP 上（无直属 KP 的节点不占标题行）；
 * chapterId 悬空/为空的 KP 归 ungrouped。孤儿章提升顶层自成分组。
 */
export function groupCoverageKps<T extends CoverageKpLike>(
  kps: T[],
  chapters: Chapter[],
): { groups: CoverageGroup<T>[]; ungrouped: T[] } {
  const roots = buildChapterTreeFlat(chapters);
  const kpsByChapter = new Map<number, T[]>();
  for (const kp of kps) {
    if (kp.chapterId == null) continue;
    const list = kpsByChapter.get(kp.chapterId) ?? [];
    list.push(kp);
    kpsByChapter.set(kp.chapterId, list);
  }
  for (const list of kpsByChapter.values()) list.sort((a, b) => a.sort - b.sort);
  const groups: CoverageGroup<T>[] = [];
  const placed = new Set<number>();
  for (const root of roots) {
    const rows: CoverageGroupRow<T>[] = [];
    const walk = (node: NestedChapter, isTop: boolean): void => {
      for (const child of node.children) walk(child, false);
      const own = kpsByChapter.get(node.chapter.id) ?? [];
      own.forEach((kp, i) => {
        rows.push({ unit: isTop ? undefined : i === 0 ? node.chapter.name : undefined, kp });
        placed.add(kp.id);
      });
    };
    walk(root, true);
    if (rows.length) groups.push({ label: root.chapter.name, rows });
  }
  const ungrouped = kps.filter((k) => !placed.has(k.id)).sort((a, b) => a.sort - b.sort);
  return { groups, ungrouped };
}
