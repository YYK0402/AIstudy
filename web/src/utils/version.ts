/** 语义化版本比较（X.Y.Z，缺位段按 0 补齐，按数值而非字典序比较） */

function toParts(v: string): number[] {
  return v
    .split(".")
    .map((seg) => {
      const n = parseInt(seg, 10);
      return Number.isFinite(n) ? n : 0;
    });
}

/** a 高于 b 返回 1，相等 0，低于 -1 */
export function compareVersions(a: string, b: string): number {
  const pa = toParts(a);
  const pb = toParts(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/** current 是否高于 seen（用于判断插件是否更新过） */
export function isNewerVersion(current: string, seen: string): boolean {
  return compareVersions(current, seen) > 0;
}
