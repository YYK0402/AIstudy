import type { Chapter } from "../types/appData";

export function normalizeKpName(s: string): string {
  return s.toLowerCase().replace(/[\s、，。；：（）()【】\[\]'"“”‘’·\-—/\\,.]/g, "");
}

/** 归一化章节引用：在去空白标点的基础上，再剥掉开头的编号前缀（如「第一章」「1.2」「第3节」） */
export function normalizeChapterRef(s: string): string {
  const n = normalizeKpName(s);
  return n.replace(/^(第[0-9一二三四五六七八九十百零两]+[章节部分讲单元]|[0-9]+(\.[0-9]+)*[、.]?)+/, "");
}

/** 按标题找章节：归一化后精确匹配优先；否则双向包含（短侧 ≥2 字）且取章节名最长者 */
export function findChapterByTitle(chapters: Chapter[], title: string): Chapter | undefined {
  const t = normalizeChapterRef(title);
  if (!t) return undefined;
  const exact = chapters.find((c) => normalizeChapterRef(c.name) === t);
  if (exact) return exact;
  let best: Chapter | undefined;
  for (const c of chapters) {
    const cn = normalizeChapterRef(c.name);
    if (!cn || cn.length < 2) continue;
    const hit = cn.includes(t) || t.includes(cn);
    if (hit && (!best || cn.length > normalizeChapterRef(best.name).length)) best = c;
  }
  return best;
}
