import type { Chapter } from "../types/appData";

export function normalizeKpName(s: string): string {
  return s.toLowerCase().replace(/[\s、，。；：（）()【】\[\]'"“”‘’·\-—/\\,.]/g, "");
}

// 归一化知识点名：小写、去掉空白与标点，用于本地去重
// 本地判断两个知识点名是否重复（精确/归一化后相同，或相互包含）
export function isDuplicateKpName(a: string, b: string): boolean {
  const na = normalizeKpName(a);
  const nb = normalizeKpName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 2 && nb.length >= 2 && (na.includes(nb) || nb.includes(na))) return true;
  return false;
}

/** 归一化章节引用：在去空白标点的基础上，再剥掉开头的编号前缀（如「第一章」「1.2」「第3节」） */
export function normalizeChapterRef(s: string): string {
  const n = normalizeKpName(s);
  return n.replace(/^(第[0-9一二三四五六七八九十百零两]+[章节部分讲单元]|[0-9]+(\.[0-9]+)*[、.]?)+/, "");
}

/** 候选中取层级最深者（level 越大层级越深，归属更精确）；同级取先出现者 */
export function pickDeepestChapter(candidates: Chapter[]): Chapter | undefined {
  let best: Chapter | undefined;
  for (const c of candidates) {
    if (!best || c.level > best.level) best = c;
  }
  return best;
}

/** 按标题找章节（N 级）：归一化后精确匹配取最深者；否则双向包含（短侧 ≥2 字），最深优先、同级取章节名最长者 */
export function findDeepestChapterByTitle(chapters: Chapter[], title: string): Chapter | undefined {
  const t = normalizeChapterRef(title);
  if (!t) return undefined;
  const exact = chapters.filter((c) => normalizeChapterRef(c.name) === t);
  if (exact.length > 0) return pickDeepestChapter(exact);
  let best: Chapter | undefined;
  for (const c of chapters) {
    const cn = normalizeChapterRef(c.name);
    if (!cn || cn.length < 2) continue;
    const hit = cn.includes(t) || t.includes(cn);
    if (!hit) continue;
    if (
      !best ||
      c.level > best.level ||
      (c.level === best.level && cn.length > normalizeChapterRef(best.name).length)
    ) {
      best = c;
    }
  }
  return best;
}
