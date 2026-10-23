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
