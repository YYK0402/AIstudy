import type { Question } from "../types/appData";
import { formatPassageAnswer } from "./passage";

/** 答题卡作答状态（整卷模式草稿与交卷判定统一结构） */
export interface AnswerState {
  /** 单选/判断：所选选项文本 */
  single: string | null;
  /** 多选：所选选项 */
  multi: string[];
  /** 简答/翻译/无空位填空：文本作答 */
  text: string;
  /** 文章题：空位编号 → 用户填写值/所选字母 */
  passage: Record<number, string>;
}

function parseBlanks(q: Pick<Question, "blanks">): Array<{ no: number }> | null {
  if (!q.blanks) return null;
  try {
    const v = JSON.parse(q.blanks);
    return Array.isArray(v) ? (v as Array<{ no: number }>) : null;
  } catch {
    return null;
  }
}

/** 按题型判断一道题是否已作答（整卷交卷时逐题检查） */
export function isQuizAnswered(q: Pick<Question, "qType" | "blanks">, s: AnswerState): boolean {
  switch (q.qType) {
    case "single":
    case "judge":
      return s.single != null;
    case "multiple":
      return s.multi.length > 0;
    case "fill":
    case "banked":
    case "cloze": {
      const blanks = parseBlanks(q);
      if (blanks && blanks.length > 0) {
        return blanks.every((b) => (s.passage[b.no] ?? "").trim() !== "");
      }
      return s.text.trim() !== "";
    }
    default:
      return s.text.trim() !== "";
  }
}

/** 把作答状态解析为提交给判分的答案串（与逐题提交时的 userAnswer 格式一致） */
export function resolveAnswerText(q: Pick<Question, "qType" | "blanks">, s: AnswerState): string {
  if (q.qType === "single" || q.qType === "judge") return s.single ?? "";
  if (q.qType === "multiple") return s.multi.join(",");
  const blanks = parseBlanks(q);
  if (blanks && blanks.length > 0) {
    return formatPassageAnswer(blanks.map((b) => [b.no, (s.passage[b.no] ?? "").trim()] as [number, string]));
  }
  return s.text.trim();
}
