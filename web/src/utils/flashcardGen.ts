// T3.4 闪卡 AI 输出解析：把 AI 返回的 {index, front, back} 数组解析为闪卡
// 约定：index = 输入知识点列表序号（0 起）；防御 markdown 围栏 / 前后说明文字 / 坏数据
import { extractJsonCandidates, parseJsonCandidates } from "./aiJson";

export interface ParsedFlashcard {
  /** 输入知识点列表中的序号（0 起） */
  index: number;
  front: string;
  back: string;
}

export interface ParseFlashcardsResult {
  items: ParsedFlashcard[];
  /** 解析级错误（空输出/无 JSON 数组/JSON 解析失败/非数组）；非空时 items 为空 */
  errors: string[];
  /** 因单项问题被剔除的条数（index 越界/非整数/正反面为空/重复/非对象项） */
  skipped: number;
}

type ExtractedArray = { kind: "array"; value: unknown[] } | { kind: "error"; message: string };

/** 从原始输出中提取 JSON 数组：候选（围栏 > 裸原文 > 贪婪截取）按序解析，见 utils/aiJson */
function extractJsonArray(raw: string): ExtractedArray {
  if (!raw.trim()) return { kind: "error", message: "AI 输出为空" };
  const candidates = extractJsonCandidates(raw, "array");
  if (candidates.length === 0) return { kind: "error", message: "AI 输出中未找到 JSON 数组" };
  const parsed = parseJsonCandidates(candidates);
  if (Array.isArray(parsed)) return { kind: "array", value: parsed };
  return { kind: "error", message: "AI 输出不是 JSON 数组" };
}

export function parseFlashcardsJson(raw: string, kpCount: number): ParseFlashcardsResult {
  const extracted = extractJsonArray(raw);
  if (extracted.kind === "error") {
    return { items: [], errors: [extracted.message], skipped: 0 };
  }
  const parsed = extracted.value;
  const items: ParsedFlashcard[] = [];
  const used = new Set<number>();
  let skipped = 0;
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      skipped++;
      continue;
    }
    const rec = entry as Record<string, unknown>;
    const { index, front, back } = rec;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= kpCount) {
      skipped++;
      continue;
    }
    if (used.has(index)) {
      skipped++;
      continue;
    }
    if (typeof front !== "string" || typeof back !== "string" || !front.trim() || !back.trim()) {
      skipped++;
      continue;
    }
    used.add(index);
    items.push({ index, front: front.trim(), back: back.trim() });
  }
  return { items, errors: [], skipped };
}
