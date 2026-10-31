/**
 * 文章题（fill 词形/单空、banked 选择填空、cloze 完形）纯函数：
 * 空位解析、「no:答案」串解析/格式化、逐空判分。
 * 数据约定：
 * - 空位标记（按优先级）：`__41__`、`__41__ (learner)`（括号内为所给原形词）、
 *   `____`（3+ 下划线）、`__ (word)`、裸 `__`
 * - 答案串：`41:learners|42:enable`（按空位编号；完形题值为选项字母）
 * - 判分：逐空归一化比较（trim + 大小写不敏感），全对才算对；score=正确率百分数
 */

export interface PassageBlank {
  no: number;
  hint?: string;
}

const BLANK_RE = /__(\d+)__(?:\s*[(（]([^)）]*)[)）])?|_{3,}|__\s*[(（]([^)）]*)[)）]|__/g;

/** 按出现顺序解析题干中的空位标记；未编号空位按出现顺序记为 1、2、… */
export function parsePassageBlanks(title: string): PassageBlank[] {
  const out: PassageBlank[] = [];
  let seq = 0;
  BLANK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BLANK_RE.exec(title)) !== null) {
    if (m[1] !== undefined) {
      out.push({ no: Number(m[1]), hint: m[2] ? m[2].trim() : undefined });
    } else if (m[3] !== undefined) {
      seq += 1;
      out.push({ no: seq, hint: m[3].trim() });
    } else {
      seq += 1;
      out.push({ no: seq });
    }
  }
  return out;
}

/** 解析文章题答案串 `41:a|42:b`；非该形态（无 `no:` 前缀）返回空 */
export function parsePassageAnswer(s: string): Map<number, string> {
  const map = new Map<number, string>();
  if (!s) return map;
  const parts = s.split("|").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return map;
  for (const p of parts) {
    const i = p.indexOf(":");
    if (i <= 0) return map; // 非「no:值」形态（如单空填空题的纯文本答案）
    const no = Number(p.slice(0, i).trim());
    if (!Number.isInteger(no) || no <= 0) return map;
    map.set(no, p.slice(i + 1).trim());
  }
  return map;
}

/** 格式化文章题答案串（按空位编号升序） */
export function formatPassageAnswer(entries: Array<[number, string]>): string {
  return [...entries]
    .sort((a, b) => a[0] - b[0])
    .map(([no, v]) => `${no}:${v}`)
    .join("|");
}

/** 归一化单个空位的作答/答案：trim + 小写（选项字母同样适用） */
export function normalizeBlank(s: string): string {
  return s.trim().toLowerCase();
}

export interface PassageGrade {
  perBlank: Array<{ no: number; user: string; correct: string; right: boolean }>;
  correctCount: number;
  total: number;
  /** 正确率百分数（整数），如 "80" */
  score: string;
  /** 全空正确才算对 */
  isCorrect: boolean;
}

/** 逐空解析串「41:xxx|42:yyy」→ 逐行「41：xxx」；非该形态原样返回 */
export function formatPassageAnalysis(s: string): string {
  const m = parsePassageAnswer(s);
  if (m.size === 0) return s;
  return [...m.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([no, v]) => `${no}：${v}`)
    .join("\n");
}

/** 逐空判分：以正确答案串的空位为基准；用户未填的空按错计 */
export function gradePassage(userAnswer: string, correctAnswer: string): PassageGrade {
  const correct = parsePassageAnswer(correctAnswer);
  const user = parsePassageAnswer(userAnswer);
  const perBlank = [...correct.keys()]
    .sort((a, b) => a - b)
    .map((no) => {
      const c = correct.get(no) ?? "";
      const u = user.get(no) ?? "";
      return { no, user: u, correct: c, right: u !== "" && normalizeBlank(u) === normalizeBlank(c) };
    });
  const correctCount = perBlank.filter((p) => p.right).length;
  const total = perBlank.length;
  const score = total > 0 ? String(Math.round((correctCount / total) * 100)) : "0";
  return { perBlank, correctCount, total, score, isCorrect: total > 0 && correctCount === total };
}
