// Markdown 真题导入解析（纯函数，便于单测）
// 约定格式（每块一题，块间用独占一行的 --- 分隔）：
//   题干文字（可多行，首行可带「1. 」编号或「题干：」前缀）
//   A. 选项A
//   B. 选项B
//   答案: B                （单选=字母/选项文本；多选=A,B 或 AB；判断=正确/错误；简答=参考答案文本）
//   解析: …                （可选）
//   难度: 中等             （可选，简单/中等/困难，默认中等）
//   题型: 单选             （可选，单选/多选/判断/简答，缺省自动推断）
//   知识点: 知识点甲, 知识点乙  （可选，按名称匹配本课程知识点）
import type { KnowledgePoint, QuestionType, QuestionDifficulty } from "../api";

export interface ImportedQuestionDraft {
  title: string;
  options: string[];
  answer: string;
  analysis: string;
  qType: QuestionType;
  difficulty: QuestionDifficulty;
  kpIds: number[];
  /** 未能匹配到课程知识点的名称（仅提示，不阻断导入） */
  unmatchedKpNames: string[];
}

export interface ImportError {
  /** 该题块首行行号（1 起） */
  line: number;
  reason: string;
}

export interface ImportParseResult {
  drafts: ImportedQuestionDraft[];
  errors: ImportError[];
  /** 解析到的试卷名称（来自 markdown 头部） */
  paperName?: string;
  /** 解析到的年份（来自 markdown 头部） */
  paperYear?: number;
}

const QTYPE_MAP: Record<string, QuestionType> = {
  single: "single", 单选: "single",
  multiple: "multiple", 多选: "multiple",
  judge: "judge", 判断: "judge",
  essay: "essay", 简答: "essay", 问答: "essay",
  cloze: "cloze", 填空: "cloze",
  translation: "translation", 翻译: "translation",
};

const DIFF_MAP: Record<string, QuestionDifficulty> = {
  easy: "easy", 简单: "easy", 易: "easy",
  medium: "medium", 中等: "medium", 中: "medium",
  hard: "hard", 困难: "hard", 难: "hard",
};

const JUDGE_RIGHT = new Set(["正确", "对", "√", "right", "true"]);
const JUDGE_WRONG = new Set(["错误", "错", "×", "✗", "wrong", "false"]);

const QTYPE_LABELS: Record<string, string> = {
  essay: "简答",
  cloze: "填空",
  translation: "翻译",
};
function getQuestionTypeName(qt: string): string {
  return QTYPE_LABELS[qt] ?? qt;
}

const isContentLine = (l: string) => {
  const t = l.trim();
  return t !== "" && !/^(#{1,6}\s|>)/.test(t);
};

function splitBlocks(lines: string[]): Array<{ start: number; lines: string[] }> {
  const blocks: Array<{ start: number; lines: string[] }> = [];
  let cur: string[] = [];
  let start = 1;
  lines.forEach((raw, i) => {
    if (/^\s*-{3,}\s*$/.test(raw)) {
      if (cur.some(isContentLine)) blocks.push({ start, lines: cur });
      cur = [];
      start = i + 2;
    } else {
      if (cur.length === 0 && isContentLine(raw)) start = i + 1;
      cur.push(raw);
    }
  });
  if (cur.some(isContentLine)) blocks.push({ start, lines: cur });
  return blocks;
}

function parseBlock(
  blockLines: string[],
  startLine: number,
  kpByName: Map<string, KnowledgePoint>,
): { draft?: ImportedQuestionDraft; error?: string } {
  let title = "";
  const options: string[] = [];
  let answerRaw = "";
  let hasAnswer = false;
  let analysis = "";
  let qType: QuestionType | null = null;
  let difficulty: QuestionDifficulty = "medium";
  const kpNames: string[] = [];

  for (const raw of blockLines) {
    const line = raw.trim();
    if (!line) continue;
    // 标题行与引用行视为元信息（导出文件头部）
    if (/^#{1,6}\s/.test(line) || line.startsWith(">")) continue;
    let m = line.match(/^(?:[-*]\s*)?(?:正确答案|答案)\s*[:：]\s*(.*)$/);
    if (m) { answerRaw = m[1].trim(); hasAnswer = true; continue; }
    m = line.match(/^(?:[-*]\s*)?解析\s*[:：]\s*(.*)$/);
    if (m) { analysis = m[1].trim(); continue; }
    m = line.match(/^(?:[-*]\s*)?难度\s*[:：]\s*(.*)$/);
    if (m) {
      const key = m[1].trim();
      const d = DIFF_MAP[key] ?? DIFF_MAP[key.toLowerCase()];
      if (d) difficulty = d;
      continue;
    }
    m = line.match(/^(?:[-*]\s*)?题型\s*[:：]\s*(.*)$/);
    if (m) {
      const key = m[1].trim();
      const t = QTYPE_MAP[key] ?? QTYPE_MAP[key.toLowerCase()];
      if (t) qType = t;
      continue;
    }
    m = line.match(/^(?:[-*]\s*)?知识点\s*[:：]\s*(.*)$/);
    if (m) {
      for (const part of m[1].split(/[,，、;；/]/)) {
        const name = part.trim();
        if (name) kpNames.push(name);
      }
      continue;
    }
    // 来源等未知键忽略
    m = line.match(/^(?:[-*]\s*)?来源\s*[:：]\s*(.*)$/);
    if (m) continue;
    m = line.match(/^([A-Ha-h])\s*[.、．:：]\s*(.+)$/);
    if (m) { options.push(m[2].trim()); continue; }
    if (!title) {
      title = line.replace(/^#{1,6}\s*/, "").replace(/^题干\s*[:：]\s*/, "").replace(/^\d+\s*[.、)]\s*/, "");
    } else {
      title += "\n" + line;
    }
  }

  if (!title) return { error: "缺少题干" };

  const isJudgeWord = (s: string) => JUDGE_RIGHT.has(s) || JUDGE_WRONG.has(s);
  // 题型推断：无选项=简答；固定两项判断词=判断；否则按答案字母数
  let tokens = answerRaw.split(/[,，、;；\s]+/).filter(Boolean);
  const letterTokens = tokens.filter((t) => /^[A-Ha-h]$/.test(t));
  if (!qType) {
    if (options.length === 0) {
      qType = "essay";
    } else if (options.length === 2 && options.every((o) => JUDGE_RIGHT.has(o) || JUDGE_WRONG.has(o))) {
      qType = "judge";
    } else if (tokens.length === 1 && isJudgeWord(tokens[0]) && options.length >= 2) {
      qType = "judge";
    } else if (tokens.length >= 2) {
      qType = "multiple";
    } else {
      qType = "single";
    }
  }

  // 选项规整
  let finalOptions = options;
  if (qType === "judge") {
    finalOptions = options.length === 2 ? options : ["正确", "错误"];
  } else if (qType === "essay" || qType === "cloze" || qType === "translation") {
    finalOptions = [];
  } else if (options.length < 2) {
    return { error: qType === "single" ? "单选题至少需要 2 个选项" : "多选题至少需要 2 个选项" };
  }

  // 答案解析
  let answer = "";
  if (qType === "essay" || qType === "cloze" || qType === "translation") {
    if (!hasAnswer || !answerRaw) return { error: getQuestionTypeName(qType) + "题缺少参考答案" };
    answer = answerRaw;
  } else if (qType === "judge") {
    const w = (tokens[0] ?? answerRaw).trim();
    const idx = JUDGE_RIGHT.has(w) ? 0 : JUDGE_WRONG.has(w) ? 1 : finalOptions.findIndex((o) => o === answerRaw);
    if (idx < 0) return { error: "判断题答案无法识别（应为 正确/错误）" };
    answer = finalOptions[idx];
  } else {
    const idxs: number[] = [];
    for (const t of tokens) {
      if (/^[A-Ha-h]$/.test(t)) {
        const idx = t.toUpperCase().charCodeAt(0) - 65;
        if (idx >= finalOptions.length) return { error: `答案「${t}」超出选项范围` };
        idxs.push(idx);
      } else {
        const idx = finalOptions.findIndex((o) => o === t);
        if (idx < 0) return { error: `答案「${t}」与任何选项都不匹配` };
        idxs.push(idx);
      }
    }
    if (idxs.length === 0) return { error: "答案无法解析（如 B 或 A,B）" };
    if (qType === "single" && idxs.length > 1) return { error: "单选题答案应为单个选项" };
    answer = [...new Set(idxs)].sort((a, b) => a - b).map((i) => finalOptions[i]).join(",");
  }

  // 知识点匹配
  const kpIds: number[] = [];
  const unmatchedKpNames: string[] = [];
  for (const name of kpNames) {
    const kp = kpByName.get(name);
    if (kp) {
      if (!kpIds.includes(kp.id)) kpIds.push(kp.id);
    } else {
      unmatchedKpNames.push(name);
    }
  }

  return {
    draft: {
      title,
      options: finalOptions,
      answer,
      analysis,
      qType,
      difficulty,
      kpIds,
      unmatchedKpNames,
    },
  };
}

export function parseQuestionsMarkdown(
  text: string,
  knowledgePoints: KnowledgePoint[],
): ImportParseResult {
  const kpByName = new Map(knowledgePoints.map((k) => [k.name, k]));
  const drafts: ImportedQuestionDraft[] = [];
  const errors: ImportError[] = [];

  // 解析头部元数据（试卷名称/年份）
  const lines = text.split(/\r?\n/);
  let paperName: string | undefined;
  let paperYear: number | undefined;
  for (const line of lines) {
    const t = line.trim();
    // 试卷名称：首行的标题
    if (!paperName && /^#{1,6}\s+(.+)$/.test(t)) {
      paperName = t.replace(/^#{1,6}\s+/, "").trim();
    }
    // 年份
    if (!paperYear) {
      const ym = t.match(/^(?:年份|year)\s*[:：]\s*(\d{4})/i);
      if (ym) paperYear = Number(ym[1]);
      // 从试卷名中提取年份，如 "2024考研政治真题"
      const nm = paperName?.match(/(\d{4})/);
      if (nm) paperYear = Number(nm[1]);
    }
  }

  for (const block of splitBlocks(lines)) {
    const { draft, error } = parseBlock(block.lines, block.start, kpByName);
    if (draft) drafts.push(draft);
    else errors.push({ line: block.start, reason: error ?? "无法解析" });
  }
  return { drafts, errors, paperName, paperYear };
}

export const IMPORT_SAMPLE = `# 2024考研政治真题
1. 下列对货币时间价值理解正确的是？
A. 资金的现值
B. 资金随时间推移产生的增值
C. 未来资金的折现
D. 风险报酬
答案: B
解析: 货币时间价值是指资金在投资过程中随时间推移产生的增值。
难度: 中等
题型: 单选
知识点: 货币时间价值, 货币政策
---
下列属于货币政策工具的有？
A. 存款准备金率
B. 公开市场操作
C. 再贴现率
D. 税收政策
答案: A,B
难度: 困难
---
中央银行是商业银行。
答案: 错误
解析: 中央银行是政府的银行，不是商业银行。
题型: 判断
---
货币的时间价值是指资金在______过程中产生的增值。
答案: 投资
题型: 填空
---
翻译：The monetary policy refers to the policies formulated by the central bank.
答案: 货币政策是指由中央银行制定的政策。
题型: 翻译
`;
