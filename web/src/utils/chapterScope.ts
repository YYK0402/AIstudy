// 章节作用域：章 → 章下小节的节点展开 + 知识点归属
import type { Chapter, KnowledgePoint } from "../api";

/** 某章节节点下的全部章节节点 id（章节行 = 自身 + 其小节；小节行 = 自身） */
export function expandChapterNodeIds(chapters: Chapter[], chapterId: number): Set<number> {
  const ids = new Set<number>([chapterId]);
  const ch = chapters.find((c) => c.id === chapterId);
  if (ch && ch.level === "chapter") {
    for (const u of chapters) {
      if (u.level === "unit" && u.parentId === chapterId) ids.add(u.id);
    }
  }
  return ids;
}

/** 某章节（含其小节）下的全部知识点 */
export function kpsOfChapter(kps: KnowledgePoint[], chapters: Chapter[], chapterId: number): KnowledgePoint[] {
  const ids = expandChapterNodeIds(chapters, chapterId);
  return kps.filter((k) => k.chapterId !== null && ids.has(k.chapterId));
}

/**
 * 批量预计算：每个章节节点下的知识点数量（章行含其小节，小节行仅自身）。
 * O(chapters + kps)，替代模板行级「expand + filter」的 O(chapters × kps) 热点。
 */
export function kpCountByNode(chapters: Chapter[], kps: KnowledgePoint[]): Map<number, number> {
  const byId = new Map(chapters.map((c) => [c.id, c]));
  const counts = new Map<number, number>();
  for (const k of kps) {
    if (k.chapterId == null) continue;
    counts.set(k.chapterId, (counts.get(k.chapterId) ?? 0) + 1);
    const node = byId.get(k.chapterId);
    if (node?.level === "unit" && node.parentId != null) {
      counts.set(node.parentId, (counts.get(node.parentId) ?? 0) + 1);
    }
  }
  return counts;
}
