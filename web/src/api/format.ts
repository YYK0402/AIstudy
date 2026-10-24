import type { KnowledgePoint, Question } from "../types/appData";

export function nextId(list: Array<{ id: number }>): number {
  return list.reduce((max, item) => Math.max(max, item.id), 0) + 1;
}

export function now(): string {
  return new Date().toISOString();
}

export function truncateText(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

/** 按本地时区格式化为 YYYY-MM-DD，避免 toISOString 的 UTC 偏移导致跨时区错一天 */
export function formatLocalDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function shuffleList<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function parseQuestionOptions(question: Question): string[] {
  try {
    const parsed = JSON.parse(question.options);
    if (Array.isArray(parsed)) {
      return parsed.filter((o): o is string => typeof o === "string");
    }
  } catch {
    // ignore
  }
  return [];
}

export function parseQuestionKpIds(question: Question): number[] {
  return question.kpIds
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

export function parseKpPrevIds(kp: KnowledgePoint): number[] {
  return kp.prevKpIds
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}
