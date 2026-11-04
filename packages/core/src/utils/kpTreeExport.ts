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

export const MASTERY_LABEL: Record<Mastery, string> = {
  unlearn: "[未学习]",
  known: "[了解]",
  mastered: "[掌握]",
  proficient: "[精通]",
};

/** 说明头（往返文件）：课程身份锚点 + 编辑/导入使用说明；过滤版声明不可导入 */
function buildHeader(course: Pick<Course, "id" | "name">, date: string, filtered: boolean): string[] {
  return [
    "<!--",
    `【知识点树往返文件】课程：${course.name}（course:${course.id}）· 导出 ${date}`,
    filtered
      ? "⚠ 本文件为过滤导出（仅未掌握），不可用于导入——应用会拒绝。如需导回更新，请取消勾选「仅导出未掌握知识点」后重新导出。"
      : "本文件可导回更新：在编辑器中修改后，用「导入知识点树」选择本文件，应用先预览变更清单、确认后生效。",
    "使用说明：",
    "1. 结构：「# 章」/「## 节」/「- 知识点条目」；知识点内容写在条目下方缩进 2 空格，支持多段落（空行分段），可自由编辑。",
    "2. 章/条目行上的 ch:ID / kp:ID 注释标记是身份锚点：导入按 ID 匹配以保留掌握度与题目关联，请勿修改或删除。",
    "3. 重命名知识点/章节：直接改标记前的文字；导入按 ID 匹配，不会当成新建。",
    "4. 新增：加新条目或新章/节标题（不带标记）→ 导入时创建新知识点（默认「未学习」）/新章节，归入其在文件中的所在章节。",
    "5. 删除：整条删除（含其缩进内容）或整章/节删除 → 导入时删除对应知识点/章节（先经预览确认）；题库不删，仅失去该知识点绑定。",
    "6. 移动：把条目挪到其他章/节 = 变更归属；把小节挪到其他顶章下 = 变更小节归属。",
    "7. [掌握度] 与（N 错题）是参考标签：导入不会改动掌握度、错题、闪卡、复习排期与任何学习记录。",
    "8. 本注释块与文件顶部「导出时间」统计行在导入时自动忽略，可删除（删除后按一级标题「课程名 知识点树」校验课程）。",
    "-->",
  ];
}

/**
 * 知识点树导出 Markdown（课程级，往返安全）：
 * 说明头（身份锚点+使用说明）→ 顶章 H1 → 小节 H2 → 知识点 bullet（章直属列在小节前），
 * 章节/条目带 ch/kp 身份标记，知识点内容缩进导出（多段落保留）。
 * 孤儿（chapterId 空）与幽灵（chapterId 指向不存在节点）知识点归末尾「未归章」（虚拟分组，无标记）。
 * 过滤导出（onlyUnmastered）在说明头声明不可导入，防止已掌握知识点被误删。
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

  const line = (k: KnowledgePoint): string[] => {
    let s = `- ${k.name}`;
    if (includeMastery) s += ` ${MASTERY_LABEL[k.mastery]}`;
    if (includeWrongCount) {
      const n = wrongByKp.get(k.id) ?? 0;
      if (n > 0) s += `（${n} 错题）`;
    }
    s += ` <!-- kp:${k.id} -->`;
    // 内容缩进 2 空格导出（空行保持，段落结构可往返）
    const content = k.content ? k.content.split("\n").map((l) => (l === "" ? "" : `  ${l}`)) : [];
    return [s, ...content];
  };

  const masteredCount = kps.filter((k) => k.mastery === "mastered" || k.mastery === "proficient").length;
  const out: string[] = [
    ...buildHeader(course, date, opts.onlyUnmastered === true),
    "",
    `# ${course.name} 知识点树`,
    "",
    `> 导出时间 ${date} · ${tops.length} 章 · ${kps.length} 知识点（${masteredCount} 已掌握）`,
  ];
  for (const t of tops) {
    const direct = sortByIds(kps.filter((k) => nodeOf(k) === t.id));
    const units = unitsOf(t.id);
    const underTop = direct.length + units.reduce((n, u) => n + kps.filter((k) => nodeOf(k) === u.id).length, 0);
    out.push("", `# ${t.name}（${underTop}） <!-- ch:${t.id} -->`, ...direct.flatMap(line));
    for (const u of units) {
      const ukps = sortByIds(kps.filter((k) => nodeOf(k) === u.id));
      out.push(`## ${u.name}（${ukps.length}） <!-- ch:${u.id} -->`, ...ukps.flatMap(line));
    }
  }
  const unassigned = sortByIds(kps.filter((k) => nodeOf(k) === null));
  if (unassigned.length > 0) {
    out.push("", `# 未归章（${unassigned.length}）`, ...unassigned.flatMap(line));
  }
  return out.join("\n") + "\n";
}
