/** 从逗号分隔的 id 字符串中移除 ids 命中的 id（纯函数，容忍空白与空段） */
export function removeCsvIds(csv: string, ids: ReadonlySet<number>): string {
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !ids.has(Number(s)))
    .join(",");
}
