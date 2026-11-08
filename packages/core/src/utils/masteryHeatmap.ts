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
 * 按顶层章（level===1，sort 序）分组：章下含其子树全部节点的知识点；
 * KP 归属 = 最近 level-1 祖先（parentId 链上溯；自身 level 1 取自身）；
 * chapterId 为 null、或链上无 level-1 祖先（链断/幽灵）时，归末尾「未归章」行。
 */
export function buildMasteryHeatmap(kps: KnowledgePoint[], chapters: Chapter[]): HeatmapRow[] {
  const tops = chapters
    .filter((c) => c.level === 1)
    .sort((a, b) => a.sort - b.sort);
  const byId = new Map(chapters.map((c) => [c.id, c]));

  const rows = new Map<number, HeatmapRow>();
  for (const t of tops) {
    rows.set(t.id, { chapterId: t.id, name: t.name, kps: [], mastered: 0, total: 0 });
  }
  const unassigned: HeatmapKpCell[] = [];
  for (const k of kps) {
    // 最近 level-1 祖先：沿 parentId 链上溯（自身 level 1 取自身）
    let cur: Chapter | undefined = k.chapterId === null ? undefined : byId.get(k.chapterId);
    let topId: number | null = null;
    let guard = 0;
    while (cur && guard++ < 16) {
      if (cur.level === 1) {
        topId = cur.id;
        break;
      }
      cur = cur.parentId === null ? undefined : byId.get(cur.parentId);
    }
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
