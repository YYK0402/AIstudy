// 掌握度热力图：按顶层章分组的知识点矩阵（报告页热力图 / 后续树形掌握等级图可复用）
import type { Chapter, KnowledgePoint, Mastery } from "../api";

export interface HeatmapKpCell {
  id: number;
  name: string;
  mastery: Mastery;
}

export interface HeatmapRow {
  /** 顶层章 id；未归章行为 null */
  chapterId: number | null;
  name: string;
  kps: HeatmapKpCell[];
  /** 已掌握数（mastered + proficient） */
  mastered: number;
  total: number;
}

function countMastered(kps: HeatmapKpCell[]): number {
  return kps.filter((k) => k.mastery === "mastered" || k.mastery === "proficient").length;
}

/**
 * 按顶层章（level=chapter，sort 序）分组：章下含其小节（unit）的全部知识点；
 * 知识点 chapterId 为 null、或指向不属于任何顶层章的节点时，归末尾「未归章」行。
 */
export function buildMasteryHeatmap(kps: KnowledgePoint[], chapters: Chapter[]): HeatmapRow[] {
  const tops = chapters
    .filter((c) => c.level === "chapter")
    .sort((a, b) => a.sort - b.sort);
  const topIds = new Set(tops.map((t) => t.id));
  // 小节 → 所属顶层章
  const unitOfTop = new Map<number, number>();
  for (const u of chapters) {
    if (u.level === "unit" && u.parentId !== null && topIds.has(u.parentId)) {
      unitOfTop.set(u.id, u.parentId);
    }
  }

  const rows = new Map<number, HeatmapRow>();
  for (const t of tops) {
    rows.set(t.id, { chapterId: t.id, name: t.name, kps: [], mastered: 0, total: 0 });
  }
  const unassigned: HeatmapKpCell[] = [];
  for (const k of kps) {
    // 直接挂顶层章，或挂其小节
    const topId =
      k.chapterId === null
        ? null
        : topIds.has(k.chapterId)
          ? k.chapterId
          : unitOfTop.get(k.chapterId) ?? null;
    const row = topId !== null ? rows.get(topId) : null;
    const cell: HeatmapKpCell = { id: k.id, name: k.name, mastery: k.mastery };
    if (row) {
      row.kps.push(cell);
    } else {
      unassigned.push(cell);
    }
  }
  const sortZh = (a: HeatmapKpCell, b: HeatmapKpCell) => a.name.localeCompare(b.name, "zh-Hans-CN");
  for (const row of rows.values()) {
    row.kps.sort(sortZh);
    row.total = row.kps.length;
    row.mastered = countMastered(row.kps);
  }
  if (unassigned.length > 0) {
    unassigned.sort(sortZh);
    rows.set(-1, { chapterId: null, name: "未归章", kps: unassigned, total: unassigned.length, mastered: countMastered(unassigned) });
  }
  return tops.map((t) => rows.get(t.id)!).concat(unassigned.length > 0 ? [rows.get(-1)!] : []);
}
