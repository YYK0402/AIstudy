// 章节作用域：节点 → 其全部后代节点的展开 + 知识点归属（N 级树）
import type { Chapter, KnowledgePoint } from "../api";

/** 某章节节点下的全部章节节点 id（自身 + 任意深度的全部后代） */
export function expandChapterNodeIds(chapters: Chapter[], chapterId: number): Set<number> {
  const children = new Map<number, number[]>();
  for (const c of chapters) {
    if (c.parentId === null) continue;
    const list = children.get(c.parentId);
    if (list) list.push(c.id);
    else children.set(c.parentId, [c.id]);
  }
  const ids = new Set<number>([chapterId]);
  const stack: number[] = [chapterId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    for (const cid of children.get(id) ?? []) {
      if (!ids.has(cid)) {
        ids.add(cid);
        stack.push(cid);
      }
    }
  }
  return ids;
}

/** 某章节（含其全部后代）下的全部知识点 */
export function kpsOfChapter(kps: KnowledgePoint[], chapters: Chapter[], chapterId: number): KnowledgePoint[] {
  const ids = expandChapterNodeIds(chapters, chapterId);
  return kps.filter((k) => k.chapterId !== null && ids.has(k.chapterId));
}

/**
 * 批量预计算：每个章节节点下的知识点数量（节点行 = 自身 + 全部后代）。
 * O(chapters + kps × 深度)，替代模板行级「expand + filter」的 O(chapters × kps) 热点。
 */
export function kpCountByNode(chapters: Chapter[], kps: KnowledgePoint[]): Map<number, number> {
  const byId = new Map(chapters.map((c) => [c.id, c]));
  const counts = new Map<number, number>();
  for (const k of kps) {
    if (k.chapterId == null) continue;
    // 沿祖先链逐级计入（seen 防脏数据成环）
    let cur: Chapter | undefined = byId.get(k.chapterId);
    const seen = new Set<number>();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      counts.set(cur.id, (counts.get(cur.id) ?? 0) + 1);
      cur = cur.parentId === null ? undefined : byId.get(cur.parentId);
    }
  }
  return counts;
}
