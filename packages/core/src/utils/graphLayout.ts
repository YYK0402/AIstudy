export interface PositionPoint {
  x: number;
  y: number;
}

/**
 * 关系视图：只保留有前置关系的节点（边端点），其余计为孤立节点。
 * 无边时返回全部节点（页面改用网格展示），避免空白。
 */
export function buildRelationView<T extends { id: number }>(
  nodes: T[],
  edges: Array<{ from: number; to: number }>,
): { visibleIds: Set<number>; isolatedCount: number } {
  const ids = new Set(nodes.map((n) => n.id));
  if (edges.length === 0) return { visibleIds: ids, isolatedCount: 0 };
  const linked = new Set<number>();
  for (const e of edges) {
    if (ids.has(e.from)) linked.add(e.from);
    if (ids.has(e.to)) linked.add(e.to);
  }
  return { visibleIds: linked, isolatedCount: nodes.length - linked.size };
}

/** 用持久化坐标覆盖布局坐标；缺失的节点保持原位置 */
export function applySavedPositions<T extends { x: number; y: number }>(
  nodes: T[],
  saved: Record<string, PositionPoint>,
  getId: (node: T) => number,
): T[] {
  return nodes.map((n) => {
    const p = saved[String(getId(n))];
    return p ? { ...n, x: p.x, y: p.y } : n;
  });
}

/** 拖动坐标限制在画布内，避免拖出 viewBox 后消失 */
export function clampPosition(p: PositionPoint, width: number, height: number, padding = 20): PositionPoint {
  return {
    x: Math.max(padding, Math.min(width - padding, p.x)),
    y: Math.max(padding, Math.min(height - padding, p.y)),
  };
}
