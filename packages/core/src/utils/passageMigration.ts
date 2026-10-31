/**
 * 文章题一次性迁移（幂等）：
 * 1. 旧词形填空组（qType='cloze'，同篇文章拆成 N 道、题干末尾带「第 N 题：…」行）
 *    合并为一道文章题：题干=纯文章，blanks=[{no,hint}]，answer/analysis 按空位编号串；
 *    关联记录（answerRecords/wrongQuestions/questionAsks/reviewSchedules）重映射到新题 id 并去重。
 * 2. 其余旧 qType='cloze'（单空自由填空，options 为空）→ 'fill'，补 blanks 字段。
 * 新版四选完形（qType='cloze' 但 options 含每空选项）原样保留，不参与迁移。
 */
import type { CourseData, Question } from "../types/appData";
import { parsePassageBlanks, formatPassageAnswer, type PassageBlank } from "./passage";

/** 结尾行：「第 41 题：用所给单词 learner 的适当形式填空」（冒号全/半角皆可） */
const TRAIL_RE = /\n+\s*第\s*(\d+)\s*题\s*[:：]\s*(?:用所给单词\s*(\S+)\s*[^\n]*)?/;

interface LegacyMember {
  q: Question;
  no: number;
  hint?: string;
}

function parseTrail(title: string): { passage: string; no: number; hint?: string } | null {
  const m = TRAIL_RE.exec(title);
  if (!m) return null;
  const passage = title.slice(0, m.index).replace(/\s+$/, "");
  return { passage, no: Number(m[1]), hint: m[2]?.trim() || undefined };
}

/** 是否新版四选完形（options 含每空选项数组） */
function isNewCloze(q: Question): boolean {
  const t = q.options.trim();
  return t !== "" && t !== "[]";
}

const DIFF_ORDER = ["easy", "medium", "hard"];

function maxDifficulty(ds: string[]): string {
  let best = -1;
  for (const d of ds) {
    const i = DIFF_ORDER.indexOf(d);
    if (i > best) best = i;
  }
  return best >= 0 ? DIFF_ORDER[best] : "medium";
}

/** 合并一组同文章的旧词形填空题 → 一篇文章题 */
export function mergePassageGroup(members: LegacyMember[], newId: number): Question {
  const first = members[0].q;
  const passage = parseTrail(first.title)!.passage;
  const blanks: PassageBlank[] = [...members]
    .sort((a, b) => a.no - b.no)
    .map((m) => {
      // hint 优先取结尾行，回退取文章内 `__41__ (word)` 标注
      const fromPassage = parsePassageBlanks(passage).find((b) => b.no === m.no)?.hint;
      return { no: m.no, hint: m.hint || fromPassage };
    });
  const answerEntries: Array<[number, string]> = members.map((m) => [m.no, m.q.answer.trim()]);
  const analysisEntries: Array<[number, string]> = members
    .filter((m) => m.q.analysis.trim() !== "")
    .map((m) => [m.no, m.q.analysis.trim()]);
  const kpSet = new Set<string>();
  for (const m of members) {
    for (const k of m.q.kpIds.split(",").map((s) => s.trim()).filter(Boolean)) kpSet.add(k);
  }
  return {
    id: newId,
    courseId: first.courseId,
    kpIds: [...kpSet].sort((a, b) => a.localeCompare(b, "zh-Hans-CN", { numeric: true })).join(","),
    title: passage,
    options: "[]",
    answer: formatPassageAnswer(answerEntries),
    analysis: analysisEntries.length > 0 ? formatPassageAnswer(analysisEntries) : "",
    qType: "fill",
    difficulty: maxDifficulty(members.map((m) => m.q.difficulty)),
    source: members.map((m) => m.q.source).find((s) => s) ?? "manual",
    paperId: members.map((m) => m.q.paperId).find((p) => p != null) ?? null,
    createTime: members.map((m) => m.q.createTime).sort()[0],
    blanks: JSON.stringify(blanks),
  };
}

export interface PassageMigrationResult {
  cd: CourseData;
  /** 是否有改动（决定是否写盘） */
  changed: boolean;
  /** 旧题 id → 合并后题 id（未迁移的题自映射，便于排查） */
  qIdMap: Map<number, number>;
}

/** 对单课程数据做文章题迁移（幂等：无可迁移项时原样返回） */
export function migratePassageQuestions(cd: CourseData): PassageMigrationResult {
  const qIdMap = new Map<number, number>();
  const trailMembers = new Map<string, LegacyMember[]>();
  const singles: Question[] = [];

  for (const q of cd.questions) {
    if (q.qType !== "cloze" || isNewCloze(q)) continue;
    const t = parseTrail(q.title);
    if (t) {
      const arr = trailMembers.get(t.passage) ?? [];
      arr.push({ q, no: t.no, hint: t.hint });
      trailMembers.set(t.passage, arr);
    } else {
      singles.push(q);
    }
  }

  // 同文章 >=2 题合并；只有 1 题的残缺组按单空题改名处理
  const groups = [...trailMembers.values()].filter((g) => g.length >= 2);
  for (const g of [...trailMembers.values()].filter((x) => x.length === 1)) singles.push(g[0].q);
  if (groups.length === 0 && singles.length === 0) return { cd, changed: false, qIdMap };

  let nextId = cd.questions.reduce((m, q) => Math.max(m, q.id), 0) + 1;
  const removedIds = new Set<number>();
  const newQuestions: Question[] = [];

  for (const g of groups) {
    const merged = mergePassageGroup(g, nextId++);
    for (const m of g) {
      qIdMap.set(m.q.id, merged.id);
      removedIds.add(m.q.id);
    }
    newQuestions.push(merged);
  }

  // 仅恰好 1 个空位的题补 blanks 并把答案写成 `1:值`（走逐空判分）；
  // 0 个或多个空位（含答案已嵌题干的重复题）保持原样，走单输入整串判分
  const renamedSingles = singles.map((q) => {
    const parsed = parsePassageBlanks(q.title);
    const out: Question = { ...q, qType: "fill" };
    if (parsed.length === 1) {
      out.blanks = JSON.stringify(parsed);
      out.answer = `${parsed[0].no}:${q.answer.trim()}`;
    }
    qIdMap.set(q.id, q.id);
    return out;
  });

  cd.questions = [
    ...cd.questions.filter((q) => !removedIds.has(q.id) && !singles.includes(q)),
    ...renamedSingles,
    ...newQuestions,
  ];

  // 记录重映射：answerRecords 全部保留（作答历史）；
  // wrongQuestions/questionAsks/reviewSchedules 每题唯一，重映射后按题去重
  const mapQ = (qId: number): number => qIdMap.get(qId) ?? qId;
  cd.answerRecords = cd.answerRecords.map((r) =>
    removedIds.has(r.qId) ? { ...r, qId: mapQ(r.qId) } : r,
  );

  {
    const seen = new Set<number>();
    cd.wrongQuestions = cd.wrongQuestions
      .map((w) => (removedIds.has(w.qId) ? { ...w, qId: mapQ(w.qId) } : w))
      .filter((w) => {
        if (seen.has(w.qId)) return false;
        seen.add(w.qId);
        return true;
      });
  }
  {
    const remapped = cd.questionAsks.map((a) =>
      removedIds.has(a.qId) ? { ...a, qId: mapQ(a.qId) } : a,
    );
    const best = new Map<number, number>(); // qId → 保留项下标（updateTime 最新）
    for (let i = 0; i < remapped.length; i++) {
      const cur = best.get(remapped[i].qId);
      if (cur === undefined || remapped[cur].updateTime < remapped[i].updateTime) best.set(remapped[i].qId, i);
    }
    cd.questionAsks = remapped.filter((_, i) => best.get(remapped[i].qId) === i);
  }
  {
    const seen = new Set<number>();
    cd.reviewSchedules = cd.reviewSchedules
      .map((s) => (s.qId != null && removedIds.has(s.qId) ? { ...s, qId: mapQ(s.qId) } : s))
      .filter((s) => {
        if (s.qId == null) return true;
        if (seen.has(s.qId)) return false;
        seen.add(s.qId);
        return true;
      });
  }

  return { cd, changed: true, qIdMap };
}
