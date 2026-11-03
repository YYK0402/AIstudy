import type { Chapter, Course, KnowledgePoint, Mastery, Question, WrongQuestion } from "../types/appData";
import { formatLocalDate } from "../api/format";

export interface KpTreeExportOptions {
  /** 含掌握度 tag（默认 true） */
  includeMastery?: boolean;
  /** 含错题数（默认 false；只计在管错题，经题目 kpIds 绑定） */
  includeWrongCount?: boolean;
  /** 仅导出未掌握（unlearn/known；mastered/proficient 剔除）（默认 false） */
  onlyUnmastered?: boolean;
  /** 统计行导出日期（默认今天，本地日期） */
  date?: string;
}

const MASTERY_LABEL: Record<Mastery, string> = {
  unlearn: "[未学习]",
  known: "[了解]",
  mastered: "[掌握]",
  proficient: "[精通]",
};

/**
 * 知识点树导出 Markdown（课程级）：
 * 顶章 H1 → 小节 H2 → 知识点 bullet（章直属知识点列在小节前）。
 * 孤儿（chapterId 空）与幽灵（chapterId 指向不存在节点）知识点归末尾「未归章」。
 */
export function buildKpTreeMarkdown(
  course: Pick<Course, "id" | "name">,
  chapters: Chapter[],
  knowledgePoints: KnowledgePoint[],
  wrongQuestions: WrongQuestion[],
  questions: Question[],
  opts: KpTreeExportOptions = {},
): string {
  const includeMastery = opts.includeMastery !== false;
  const includeWrongCount = opts.includeWrongCount === true;
  const date = opts.date ?? formatLocalDate();

  const kps = opts.onlyUnmastered === true
    ? knowledgePoints.filter((k) => k.mastery === "unlearn" || k.mastery === "known")
    : knowledgePoints;

  const wrongByKp = new Map<number, number>();
  if (includeWrongCount) {
    const qById = new Map(questions.map((q) => [q.id, q]));
    for (const w of wrongQuestions) {
      if (w.status === "graduated" || w.qId == null) continue;
      const q = qById.get(w.qId);
      if (!q) continue;
      for (const raw of q.kpIds.split(",")) {
        const id = Number(raw.trim());
        if (!id) continue;
        wrongByKp.set(id, (wrongByKp.get(id) ?? 0) + 1);
      }
    }
  }

  const sortByIds = (list: KnowledgePoint[]) => [...list].sort((a, b) => a.sort - b.sort);
  const tops = chapters.filter((c) => c.level === "chapter").sort((a, b) => a.sort - b.sort);
  const topIds = new Set(tops.map((t) => t.id));
  const unitsOf = (topId: number): Chapter[] =>
    chapters.filter((c) => c.level === "unit" && c.parentId === topId).sort((a, b) => a.sort - b.sort);

  // KP 归属节点：顶章直属 / 小节 / 未归章（空 chapterId 或指向不存在节点）
  const unitById = new Map(chapters.filter((c) => c.level === "unit").map((c) => [c.id, c]));
  function nodeOf(k: KnowledgePoint): number | null {
    if (k.chapterId === null) return null;
    if (topIds.has(k.chapterId)) return k.chapterId;
    const unit = unitById.get(k.chapterId);
    if (unit && unit.parentId !== null && topIds.has(unit.parentId)) return unit.id;
    return null;
  }

  const line = (k: KnowledgePoint): string => {
    let s = `- ${k.name}`;
    if (includeMastery) s += ` ${MASTERY_LABEL[k.mastery]}`;
    if (includeWrongCount) {
      const n = wrongByKp.get(k.id) ?? 0;
      if (n > 0) s += `（${n} 错题）`;
    }
    return s;
  };

  const masteredCount = kps.filter((k) => k.mastery === "mastered" || k.mastery === "proficient").length;
  const out: string[] = [
    `# ${course.name} 知识点树`,
    "",
    `> 导出时间 ${date} · ${tops.length} 章 · ${kps.length} 知识点（${masteredCount} 已掌握）`,
  ];
  for (const t of tops) {
    const direct = sortByIds(kps.filter((k) => nodeOf(k) === t.id));
    const units = unitsOf(t.id);
    const underTop = direct.length + units.reduce((n, u) => n + kps.filter((k) => nodeOf(k) === u.id).length, 0);
    out.push("", `# ${t.name}（${underTop}）`, ...direct.map(line));
    for (const u of units) {
      const ukps = sortByIds(kps.filter((k) => nodeOf(k) === u.id));
      out.push(`## ${u.name}（${ukps.length}）`, ...ukps.map(line));
    }
  }
  const unassigned = sortByIds(kps.filter((k) => nodeOf(k) === null));
  if (unassigned.length > 0) {
    out.push("", `# 未归章（${unassigned.length}）`, ...unassigned.map(line));
  }
  return out.join("\n") + "\n";
}
