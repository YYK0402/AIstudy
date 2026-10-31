// AI 输出统一解析工具：JSON 候选提取 + 思考块剥离
// 出题/闪卡/抽取/讲解/目录矫正/文档梳理六处解析的差异点收敛于此；
// 各项的字段校验（必填/越界/去重）仍留在各业务模块。

/**
 * 有序候选（按可信度）：代码围栏内容 > 裸原文（以开括号开头）> 贪婪括号截取。
 * 去重后按序返回；无可提取候选时返回空数组。
 */
export function extractJsonCandidates(raw: string, kind: "array" | "object"): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim() ?? null;
  const open = kind === "array" ? "[" : "{";
  const greedyRe = kind === "array" ? /(\[[\s\S]*\])/ : /(\{[\s\S]*\})/;
  const greedy = trimmed.match(greedyRe)?.[1] ?? null;
  const whole = trimmed.startsWith(open) ? trimmed : null;
  const out: string[] = [];
  for (const c of [fence, whole, greedy]) {
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

/** 按顺序取第一个可解析的候选；全部失败返回 null（救援/回退由调用方决定） */
export function parseJsonCandidates(candidates: string[]): unknown | null {
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      // 尝试下一个候选
    }
  }
  return null;
}

/** 部分模型用对象包装数组（如 {"questions": [...]}）：提取第一个约定字段；非数组返回 null */
export function unwrapArray(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    for (const key of ["questions", "items", "data", "list"]) {
      if (Array.isArray(obj[key])) return obj[key];
    }
  }
  return null;
}

/**
 * 推理模型思考块剥离：content 混入思考文本时，取最后一个结束标记之后的正文；
 * 无闭合标记时回退取最后一个 "Let's xxx." 过渡句之后的正文。
 */
export function stripThinkBlocks(text: string): string {
  const thinkEndTag = "</" + "think>";
  const thinkStartTag = "<" + "think" + ">";
  let t = text;
  const thinkEnd = t.lastIndexOf(thinkEndTag);
  if (thinkEnd >= 0) {
    t = t.slice(thinkEnd + thinkEndTag.length);
  } else if (t.includes(thinkStartTag)) {
    let cut = -1;
    // 过渡句可能是多词（如 "Let's analyze the document."），按词序列匹配到句末句号
    const re = /\bLet's [a-zA-Z][a-zA-Z' ]*\.\s*/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t)) !== null) cut = m.index + m[0].length;
    if (cut > 0) t = t.slice(cut);
  }
  return t.trim();
}
