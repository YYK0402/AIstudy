// 树形掌握等级图：N 级章节树（递归嵌套）的掌握度聚合 + 等级
// 等级规则：已掌握占比 r = (mastered+proficient)/total；r≥1 精通 / ≥0.6 掌握 / ≥0.3 了解 / 其余未学习；无知识点=未学习
import type { Chapter, KnowledgePoint, Mastery } from "../api";
import { buildChapterTreeFlat, type NestedChapter } from "./outline";

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
  /** 子章节节点（递归，任意深度） */
  children: MasteryTreeChapter[];
}

export interface MasteryTree {
  chapters: MasteryTreeChapter[];
  /** 未归入任何章节的知识点（chapterId 为空/幽灵章节）；无则 null */
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

/** 节点某档占比（% 一位小数）；0 知识点节点全空条 */
export function nodeDistPct(n: MasteryTreeNode, m: Mastery): number {
  return n.total ? Math.round((n.dist[m] / n.total) * 1000) / 10 : 0;
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
 * 构建 N 级章节掌握树：树结构走 buildChapterTreeFlat（同级 sort 序、孤儿提升顶层）；
 * 知识点按 k.chapterId 直属分组（存在性判定 chapterById）；每节点计数 = 直属 + 全部后代递归聚合；
 * chapterId 为 null 或幽灵（chapterById 无此 id）→ unassigned。
 */
export function buildMasteryTree(kps: KnowledgePoint[], chapters: Chapter[]): MasteryTree {
  const chapterById = new Map(chapters.map((c) => [c.id, c]));

  // 按章节节点 id 直属分组知识点
  const byNode = new Map<number, KnowledgePoint[]>();
  const unassignedKps: KnowledgePoint[] = [];
  for (const k of kps) {
    if (k.chapterId === null || !chapterById.has(k.chapterId)) {
      unassignedKps.push(k);
    } else {
      const arr = byNode.get(k.chapterId);
      if (arr) arr.push(k);
      else byNode.set(k.chapterId, [k]);
    }
  }

  // 自底向上递归：节点 = 直属 + 全部后代（子树 KP 汇总，每 KP 在每层恰好计一次）
  const subtreeKps = new Map<number, KnowledgePoint[]>();
  const walk = (nc: NestedChapter): MasteryTreeChapter => {
    const children = nc.children.map(walk);
    const all = [...(byNode.get(nc.chapter.id) ?? [])];
    for (const c of children) all.push(...(subtreeKps.get(c.id) ?? []));
    subtreeKps.set(nc.chapter.id, all);
    return { ...toNode(nc.chapter.id, nc.chapter.name, all), children };
  };

  const chaptersOut = buildChapterTreeFlat(chapters).map(walk);
  const unassigned = unassignedKps.length > 0 ? toNode(-1, "未归章", unassignedKps) : null;
  return { chapters: chaptersOut, unassigned };
}
