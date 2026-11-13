// 整卷智能切题（纯函数，便于单测）
// 适用：未排版的原始试卷粘贴文本——题干连续（大题标题 + 行首题号）、选项每行一个或单行多个、
// 答案集中在文末答案区（【参考答案】/参考答案：）。行级状态机分题，答案区按题号逆向缝合。
// 结构化格式（--- 分隔 + 每题「答案:」行）不在此处理，走 questionImport.parseQuestionsMarkdown 的既有路径。

export interface SegmentedQuestion {
  /** 试卷上的题号（1 起） */
  num: number;
  /** 题干起始行号（1 起，报错定位用） */
  line: number;
  title: string;
  options: string[];
  /** 答案区缝合到的答案（空串=答案区缺失该题） */
  answer: string;
  /** 答案区缝合到的解析（可空） */
  analysis: string;
  /** 所属大题标题（如「单选题（每题 2 分，共 10 分）」），供题型提示 */
  sectionName: string;
}

export interface SegmentResult {
  questions: SegmentedQuestion[];
  warnings: string[];
  paperName?: string;
  paperYear?: number;
}

interface AnswerDraft {
  answer: string;
  analysis: string;
}

/** 行首大题标题：一、单选题… / 第一部分 xx / Section I: xx / 裸题型词（带括号说明） */
function matchSection(m: string): string | null {
  const patterns: Array<RegExp> = [
    /^[一二三四五六七八九十]+\s*[、.．:：]\s*(.{2,40})$/,
    /^第\s*[一二三四五六七八九十\d]+\s*部分\s*[、.．:：]?\s*(.{2,40})$/,
    /^Section\s+[IVX\d]+\s*[:：]?\s*(.{2,60})$/i,
    /^(单项选择题|单选题|多项选择题|多选题|判断题|填空题|简答题|论述题|名词解释|翻译题|完形填空|选择题)\s*[（(].{1,40}[)）]\s*$/,
    /^(单项选择题|单选题|多项选择题|多选题|判断题|填空题|简答题|论述题|名词解释|翻译题|完形填空|选择题)\s*$/,
  ];
  for (const re of patterns) {
    const s = m.match(re);
    if (s) return s[1].trim();
  }
  return null;
}

/** 行首题号：`1.` / `1、` / `1)`；小数（1.5）不是题号；OCR 自愈 l/I→1（仅题号 1 未出现时） */
function matchQuestionStart(m: string, seenNums: Set<number>): { num: number; rest: string } | null {
  const raw = m.match(/^(\d{1,3})\s*[.、．)）]\s*(.*)$/);
  if (raw) {
    const afterNum = m.slice(raw[1].length);
    // 小数自查：数字紧跟「.数字」且中间无空白（如 1.5倍），不是题号
    if (/^\.\d/.test(afterNum)) return null;
    return { num: Number(raw[1]), rest: raw[2] };
  }
  if (!seenNums.has(1)) {
    const ocr = m.match(/^[lI]\s*[.、．)）]\s*(.*)$/);
    if (ocr) return { num: 1, rest: ocr[1] };
  }
  return null;
}

/** 选项行：行首 A. / A、/ A：；单行多选项（A. 甲 B. 乙）按升序字母拆分。返回 null=非选项行。
 * 多选项拆分条件不满足时降级为「行首单选项」整行取内容（正文里的 B. 不拆）。 */
function splitOptionLine(m: string): string[] | null {
  const marks: Array<{ idx: number; letter: string }> = [];
  const re = /([A-H])(?=\s*[.、．:：])/g;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(m)) !== null) marks.push({ idx: mm.index, letter: mm[1] });
  if (marks.length === 0 || marks[0].idx !== 0) return null;
  const singleContent = (): string[] | null => {
    const delimMatch = m.slice(1).match(/^\s*[.、．:：]\s*/);
    const content = m.slice(1 + (delimMatch ? delimMatch[0].length : 0)).trim();
    return content ? [content] : null;
  };
  if (marks.length === 1) return singleContent();
  // 字母必须严格连续升序（A,B,C…），否则行首单选项
  for (let k = 1; k < marks.length; k++) {
    if (marks[k].letter.charCodeAt(0) !== marks[k - 1].letter.charCodeAt(0) + 1) return singleContent();
  }
  const out: string[] = [];
  for (let k = 0; k < marks.length; k++) {
    const start = marks[k].idx;
    const delimMatch = m.slice(start + 1).match(/^\s*[.、．:：]\s*/);
    const contentStart = start + 1 + (delimMatch ? delimMatch[0].length : 0);
    const contentEnd = k + 1 < marks.length ? marks[k + 1].idx : m.length;
    if (k + 1 < marks.length) {
      const prev = m[contentEnd - 1];
      if (prev !== " " && prev !== "\t") return singleContent(); // 下一选项前须有空白，否则是正文
    }
    out.push(m.slice(contentStart, contentEnd).trim());
  }
  return out;
}

/** 结构匹配用的行归一化：全角数字/字母/标点转半角（仅用于匹配，不改写入题干） */
function normalizeForMatch(line: string): string {
  return line
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xff10 + 0x30))
    .replace(/[Ａ-Ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[ａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[．]/g, ".")
    .replace(/[:：]/g, ":")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")");
}

/** 答案区起始行（完整标记，绝不作单题内联）：【参考答案】/参考答案：/答案与解析 等（可带同行内容） */
const ZONE_FULL_RE =
  /^【\s*(?:参考答案|标准答案|答案与解析|答案解析|答案)\s*】\s*[:：]?\s*(.*)$|^(?:参考答案|标准答案|答案与解析|答案解析)\s*[:：]?\s*(.*)$/;
/** 裸「答案：」行：可能是答案区头（内容为空或题号开头），也可能是单题内联答案（选项字母/短文） */
const ZONE_BARE_ANSWER_RE = /^答案\s*[:：]\s*(.*)$/;
/** 内联答案区内容特征：密集矩阵「1-5: …」或逐题编号「1. …」 */
const ZONE_LIKE_CONTENT_RE = /^\d{1,3}\s*([-–—~至]\s*\d{1,3}|[.、．)）])\s*/;

export function segmentExamPaper(rawText: string): SegmentResult {
  const rawLines = rawText.split(/\r?\n/);
  const warnings: string[] = [];
  let paperName = "";
  let paperYear: number | undefined;
  const questions: SegmentedQuestion[] = [];
  const byNum = new Map<number, SegmentedQuestion>();
  const seenNums = new Set<number>();
  const answerDrafts = new Map<number, AnswerDraft>();
  // 答案区游标：最近一次命中的题号 + 当前开放的是答案续行还是解析续行
  let zone: { num: number; answerOpen: boolean; analysisOpen: boolean } | null = null;
  let cur: SegmentedQuestion | null = null;
  let sectionName = "";
  let inAnswerZone = false;

  const ensureDraft = (num: number): AnswerDraft => {
    let d = answerDrafts.get(num);
    if (!d) {
      d = { answer: "", analysis: "" };
      answerDrafts.set(num, d);
    }
    return d;
  };

  const processAnswerLine = (m: string, content: string): void => {
    // 1) 密集矩阵：1-5: BACDA / 1-5 B A C D A（容忍空格）
    const dense = m.match(/^(\d{1,3})\s*[-–—~至]\s*(\d{1,3})\s*[:：]?\s*([A-H√×对错](?:\s*[A-H√×对错])*)/);
    if (dense) {
      const from = Number(dense[1]);
      const to = Number(dense[2]);
      const chars = dense[3].split(/\s+/).filter(Boolean);
      if (to - from + 1 === chars.length) {
        let last = from;
        for (let k = 0; k < chars.length; k++) {
          ensureDraft(from + k).answer = chars[k];
          last = from + k;
        }
        zone = { num: last, answerOpen: true, analysisOpen: false };
      } else {
        warnings.push(`答案区「${content}」字符数与题号范围不一致，未采用`);
      }
      return;
    }
    // 2) 编号答案（一行可多个）：1. B / 1、B 2. C / 1. 解析：…
    const numMarks: Array<{ num: number; start: number; end: number }> = [];
    // (?<!\d)：数字前不得再是数字，避免「1949.」被拆出「949.」
    const numRe = /(?<!\d)(\d{1,3})\s*[.、．)）]\s*/g;
    let mm: RegExpExecArray | null;
    while ((mm = numRe.exec(m)) !== null) {
      numMarks.push({ num: Number(mm[1]), start: mm.index + mm[0].length, end: mm.index });
    }
    if (numMarks.length > 0) {
      // 一行多答案只接受短答案间隔；间隔过长视为简答答案正文里的数字（如 1949.），按单题处理
      let multi = true;
      for (let k = 1; k < numMarks.length; k++) {
        if (m.slice(numMarks[k - 1].start, numMarks[k].end).length > 20) {
          multi = false;
          break;
        }
      }
      const marks = multi ? numMarks : numMarks.slice(0, 1);
      for (let k = 0; k < marks.length; k++) {
        const end = k + 1 < marks.length ? marks[k + 1].end : m.length;
        const ans = m.slice(marks[k].start, end).trim();
        if (!ans) continue;
        const d = ensureDraft(marks[k].num);
        const pm = ans.match(/^【?解析】?\s*[:：]?\s*(.*)$/);
        if (pm) {
          d.analysis = pm[1];
          zone = { num: marks[k].num, answerOpen: false, analysisOpen: true };
        } else {
          d.answer = ans;
          zone = { num: marks[k].num, answerOpen: true, analysisOpen: false };
        }
      }
      return;
    }
    // 3) 解析块标记：解析：… / 【解析】…（归属当前游标题号）
    const pm = m.match(/^【?解析】?\s*[:：]?\s*(.*)$/);
    if (pm) {
      if (!zone) {
        warnings.push(`答案区第 ${content} 行的解析无法定位题号，已忽略`);
        return;
      }
      if (pm[1]) {
        const d = ensureDraft(zone.num);
        d.analysis += (d.analysis ? " " : "") + pm[1];
      }
      zone.analysisOpen = true;
      zone.answerOpen = false;
      return;
    }
    // 4) 无编号续行：解析块开放→追加解析；否则视为简答题多行参考答案续行
    if (!zone) return;
    const t = content.trim();
    if (!t) return;
    const d = ensureDraft(zone.num);
    if (zone.analysisOpen) d.analysis += (d.analysis ? " " : "") + t;
    else if (zone.answerOpen) d.answer += (d.answer ? " " : "") + t;
  };

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i].trim();
    if (!line) continue;
    const m = normalizeForMatch(line);

    if (inAnswerZone) {
      processAnswerLine(m, line);
      continue;
    }

    // 卷首标题（首个 markdown 标题）
    if (!paperName && /^#{1,6}\s+(.+)$/.test(line)) {
      paperName = line.replace(/^#{1,6}\s+/, "").trim();
      continue;
    }
    // 年份行
    const ym = line.match(/^(?:年份|year)\s*[:：]\s*(\d{4})/i);
    if (ym && paperYear === undefined) {
      paperYear = Number(ym[1]);
      continue;
    }
    // 答案区起始（完整标记）
    const zoneStart = m.match(ZONE_FULL_RE);
    if (zoneStart) {
      inAnswerZone = true;
      const rest = (zoneStart[1] ?? zoneStart[2] ?? "").trim();
      if (rest) processAnswerLine(normalizeForMatch(rest), rest);
      continue;
    }
    // 裸「答案：」：内容像答案区头（空/题号开头）或尚无当前题→答案区；否则单题内联答案
    const bareAnswer = m.match(ZONE_BARE_ANSWER_RE);
    if (bareAnswer) {
      const rest = (bareAnswer[1] ?? "").trim();
      if (rest !== "" && !ZONE_LIKE_CONTENT_RE.test(rest) && cur) {
        cur.answer = rest;
      } else {
        inAnswerZone = true;
        if (rest) processAnswerLine(normalizeForMatch(rest), rest);
      }
      continue;
    }
    // 单题内联「正确答案：」
    const inlineAnswer = m.match(/^正确答案\s*[:：]\s*(.+)$/);
    if (inlineAnswer && cur) {
      cur.answer = inlineAnswer[1].trim();
      continue;
    }
    // 大题标题
    const sec = matchSection(m);
    if (sec) {
      sectionName = sec;
      cur = null;
      continue;
    }
    // 题号
    const qm = matchQuestionStart(m, seenNums);
    if (qm) {
      if (byNum.has(qm.num)) warnings.push(`题号 ${qm.num} 重复，沿用后出现的题干`);
      cur = {
        num: qm.num,
        line: i + 1,
        title: qm.rest.trim(),
        options: [],
        answer: "",
        analysis: "",
        sectionName,
      };
      questions.push(cur);
      byNum.set(cur.num, cur);
      seenNums.add(cur.num);
      continue;
    }
    // 选项行（含单行多选项）
    const opts = splitOptionLine(m);
    if (opts && cur) {
      for (const o of opts) {
        if (o && cur.options.length < 8) cur.options.push(o);
      }
      continue;
    }
    // 单题内联解析：解析：xxx
    const inlineAnalysis = m.match(/^解析\s*[:：]\s*(.*)$/);
    if (inlineAnalysis && cur) {
      const t = inlineAnalysis[1].trim();
      if (t) cur.analysis = (cur.analysis ? cur.analysis + " " : "") + t;
      continue;
    }
    // 续行：有选项→粘连末选项；否则并入题干（含 (1) 子小问）
    if (cur) {
      if (cur.options.length > 0) {
        const last = cur.options[cur.options.length - 1];
        cur.options[cur.options.length - 1] = last ? `${last} ${line}` : line;
      } else {
        cur.title += (cur.title ? "\n" : "") + line;
      }
      continue;
    }
    // 首个题号之前的卷首说明：丢弃
  }

  // 缝合：答案区优先于单题内联答案
  const usedNums = new Set<number>();
  for (const q of questions) {
    const d = answerDrafts.get(q.num);
    if (d) {
      if (d.answer.trim()) q.answer = d.answer.trim();
      if (d.analysis.trim()) q.analysis = d.analysis.trim();
      usedNums.add(q.num);
    }
    if (!q.answer) warnings.push(`第 ${q.num} 题（第 ${q.line} 行）未找到答案（答案区与单题内联均缺失）`);
  }
  for (const num of answerDrafts.keys()) {
    if (!usedNums.has(num)) warnings.push(`答案区第 ${num} 题答案无对应题干，已忽略`);
  }

  // 年份兜底：卷名中的四位数字
  if (paperYear === undefined) {
    const nm = paperName.match(/(19|20)\d{2}/);
    if (nm) paperYear = Number(nm[0]);
  }

  return { questions, warnings, paperName: paperName || undefined, paperYear };
}
