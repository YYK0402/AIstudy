// 树形掌握等级图：两级章节树（chapter→unit）的掌握度聚合 + 等级
// 等级规则：已掌握占比 r = (mastered+proficient)/total；r≥1 精通 / ≥0.6 掌握 / ≥0.3 了解 / 其余未学习；无知识点=未学习
import type { Chapter, KnowledgePoint, Mastery } from "../api";

export interface MasteryDist {
  unlearn: number;
  known: number;
  mastered: number;
  proficient: number;
}

export interface MasteryTreeNode {
  id: number;
  name: string;
  dist: MasteryDist;
  total: number;
  /** mastered + proficient 数量 */
  mastered: number;
  level: Mastery;
  kps: number[];
}

export interface MasteryTreeChapter extends MasteryTreeNode {
  units: MasteryTreeNode[];
}

export interface MasteryTree {
  chapters: MasteryTreeChapter[];
  /** 未归入任何顶层章的知识点（chapterId 为空/孤儿小节/幽灵章节）；无则 null */
  unassigned: MasteryTreeNode | null;
}

export const emptyDist = (): MasteryDist => ({ unlearn: 0, known: 0, mastered: 0, proficient: 0 });

function countDist(kps: KnowledgePoint[]): { dist: MasteryDist; mastered: number } {
  const dist = emptyDist();
  for (const k of kps) dist[k.mastery]++;
  return { dist, mastered: dist.mastered + dist.proficient };
}

/** 掌握度等级：r = mastered/total（mastered 已含 proficient） */
export function levelOf(mastered: number, total: number): Mastery {
  if (total === 0) return "unlearn";
  const r = mastered / total;
  if (r >= 1) return "proficient";
  if (r >= 0.6) return "mastered";
  if (r >= 0.3) return "known";
  return "unlearn";
}

function toNode(id: number, name: string, kps: KnowledgePoint[]): MasteryTreeNode {
  const { dist, mastered } = countDist(kps);
  return {
    id,
    name,
    dist,
    total: kps.length,
    mastered,
    level: levelOf(mastered, kps.length),
    kps: kps.map((k) => k.id),
  };
}

/**
 * 构建两级章节掌握树：顶层章（sort 序）→ 其小节（sort 序）。
 * 知识点归属与 masteryHeatmap 同口径：直接挂章 / 挂其小节；其余归 unassigned。
 */
export function buildMasteryTree(kps: KnowledgePoint[], chapters: Chapter[]): MasteryTree {
  const tops = chapters
    .filter((c) => c.level === "chapter")
    .sort((a, b) => a.sort - b.sort);
  const topIds = new Set(tops.map((t) => t.id));
  const unitOfTop = new Map<number, number>();
  for (const u of chapters) {
    if (u.level === "unit" && u.parentId !== null && topIds.has(u.parentId)) {
      unitOfTop.set(u.id, u.parentId);
    }
  }

  // 按章节节点 id 分组知识点
  const byNode = new Map<number, KnowledgePoint[]>();
  const unassignedKps: KnowledgePoint[] = [];
  for (const k of kps) {
    // 直接挂章 / 挂其小节 → 该节点本身；其余 → 未归章
    const nodeId =
      k.chapterId === null || (!topIds.has(k.chapterId) && !unitOfTop.has(k.chapterId)) ? null : k.chapterId;
    if (nodeId === null) {
      unassignedKps.push(k);
    } else {
      const arr = byNode.get(nodeId);
      if (arr) arr.push(k);
      else byNode.set(nodeId, [k]);
    }
  }

  const chaptersOut = tops.map((t) => {
    const units = chapters
      .filter((c) => c.level === "unit" && c.parentId === t.id)
      .sort((a, b) => a.sort - b.sort)
      .map((u) => toNode(u.id, u.name, byNode.get(u.id) ?? []));
    // 章节点 = 章直属 + 全部小节
    const chapterKps = [...(byNode.get(t.id) ?? [])];
    for (const u of units) {
      chapterKps.push(...(byNode.get(u.id) ?? []));
    }
    return { ...toNode(t.id, t.name, chapterKps), units };
  });

  const unassigned = unassignedKps.length > 0 ? toNode(-1, "未归章", unassignedKps) : null;
  return { chapters: chaptersOut, unassigned };
}
