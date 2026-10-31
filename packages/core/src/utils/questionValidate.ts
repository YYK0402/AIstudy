import type { QuestionType } from "../api/constants";

export type QuestionAnswerValidation =
  | { ok: true; /** 建议落库的归一化答案（命中选项文本，保证与判分比对一致） */ answer: string }
  | { ok: false; reason: string };

const JUDGE_TRUE = new Set(["对", "正确", "是", "true", "right", "correct", "yes", "√", "✓", "t"]);
const JUDGE_FALSE = new Set(["错", "错误", "否", "false", "wrong", "no", "×", "✕", "x", "f"]);

function judgeValue(s: string): "true" | "false" | null {
  const t = s.trim().toLowerCase().replace(/[。.!！?？\s]/g, "");
  if (JUDGE_TRUE.has(t)) return "true";
  if (JUDGE_FALSE.has(t)) return "false";
  return null;
}

/** 单个答案元素匹配选项：文本精确一致 / 选项前缀字母（A. / A、）/ 字母按序号回退（A→第 1 项） */
function matchOption(options: string[], part: string): string | null {
  const t = part.trim();
  if (!t) return null;
  for (const opt of options) {
    if (opt.trim() === t) return opt;
  }
  const m = t.match(/^([A-Ha-h])$/);
  if (m) {
    const letter = m[1].toUpperCase();
    for (const opt of options) {
      const om = opt.trim().match(/^([A-Ha-h])\s*[.、．:：]\s*/);
      if (om && om[1].toUpperCase() === letter) return opt;
    }
    const idx = letter.charCodeAt(0) - 65;
    if (idx < options.length) return options[idx];
  }
  return null;
}

/**
 * 校验题目答案与选项的一致性（AI 出题/导入共用的纯函数）：
 * - single：选项非空，答案须命中一个选项
 * - multiple：选项非空，答案各元素（逗号分隔，或 2-8 位连续字母拆分）须命中互不重复的选项
 * - judge：答案须可识别为对/错；存在同义选项时归一化为该选项文本
 * - essay/translation/cloze：不校验（自由作答）
 */
export function validateQuestionAnswer(
  qType: QuestionType,
  options: string[],
  answer: string,
): QuestionAnswerValidation {
  const opts = options.map((o) => o.trim()).filter(Boolean);
  if (qType === "single") {
    if (opts.length === 0) return { ok: false, reason: "缺少选项" };
    const hit = matchOption(opts, answer);
    if (!hit) return { ok: false, reason: `答案「${answer}」不在选项中` };
    return { ok: true, answer: hit };
  }
  if (qType === "multiple") {
    if (opts.length === 0) return { ok: false, reason: "缺少选项" };
    let parts = answer
      .split(/[,，、;；\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    // 连续字母答案（"AB" / "ABC"）按字母拆分
    if (parts.length === 1 && /^[A-Ha-h]{2,8}$/.test(parts[0])) {
      parts = parts[0].toUpperCase().split("");
    }
    if (parts.length === 0) return { ok: false, reason: "答案为空" };
    const hits: string[] = [];
    for (const p of parts) {
      const hit = matchOption(opts, p);
      if (!hit) return { ok: false, reason: `答案元素「${p}」不在选项中` };
      if (hits.includes(hit)) return { ok: false, reason: `答案元素「${p}」重复` };
      hits.push(hit);
    }
    return { ok: true, answer: hits.join(",") };
  }
  if (qType === "judge") {
    const v = judgeValue(answer);
    if (v == null) return { ok: false, reason: `判断答案「${answer}」无法识别` };
    if (opts.length > 0) {
      const hit = opts.find((o) => judgeValue(o) === v);
      if (!hit) return { ok: false, reason: `选项中无「${v === "true" ? "正确" : "错误"}」答案` };
      return { ok: true, answer: hit };
    }
    return { ok: true, answer: v === "true" ? "对" : "错" };
  }
  return { ok: true, answer };
}
