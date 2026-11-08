import type { Chapter } from "../api";
import { isDescendant } from "./outline";

export type DropPos = "before" | "after" | "inside";

/**
 * 计算拖拽移动后的章节列表（sort/parentId/level 已更新）。N 级规则：
 * - 节点行中部拖放 = 挂为该节点直接子节点（任意深度）
 * - 节点行上/下沿 = 插入该节点所在同级列表的对应位置（可跨父）
 * - 落点在拖拽节点自身子树内 → null
 * - 拖拽子树按新深度重算 level（恢复「level === 实际深度」不变量：
 *   doc 同步消费方 effectiveNodeOf/nodeDocTarget 按 level 两级判断）
 */
export function computeChapterMove(all: Chapter[], dragId: number, targetId: number, pos: DropPos): Chapter[] | null {
  if (dragId === targetId) return null;
  const next = all.map((c) => ({ ...c }));
  const byId = (id: number) => next.find((c) => c.id === id);
  const dragCopy = byId(dragId);
  const targetCopy = byId(targetId);
  if (!dragCopy || !targetCopy) return null;
  const oldParentId = dragCopy.parentId;

  const newParentId = pos === "inside" ? targetId : targetCopy.parentId;
  if (newParentId === dragId) return null;
  if (newParentId !== null && isDescendant(next, dragId, newParentId)) return null;

  dragCopy.parentId = newParentId;
  // 拖拽子树按新深度重算 level：drag 本身 = 新父 level+1（新父缺失视为顶层→2），后代 DFS 顺延
  dragCopy.level = newParentId === null ? 1 : (byId(newParentId)?.level ?? 1) + 1;
  const childrenOf = new Map<number, Chapter[]>();
  for (const c of next) {
    if (c.parentId === null) continue;
    const list = childrenOf.get(c.parentId);
    if (list) list.push(c);
    else childrenOf.set(c.parentId, [c]);
  }
  const stack: Chapter[] = [dragCopy];
  while (stack.length > 0) {
    const cur = stack.pop() as Chapter;
    for (const child of childrenOf.get(cur.id) ?? []) {
      child.level = cur.level + 1;
      stack.push(child);
    }
  }
  const siblings = next
    .filter((c) => c.parentId === newParentId && c.id !== dragId)
    .sort((a, b) => a.sort - b.sort);
  if (pos === "inside") {
    siblings.push(dragCopy);
  } else {
    const ti = siblings.findIndex((c) => c.id === targetId);
    if (ti < 0) return null;
    siblings.splice(pos === "before" ? ti : ti + 1, 0, dragCopy);
  }
  siblings.forEach((c, i) => { c.sort = i + 1; });
  if (oldParentId !== null && oldParentId !== newParentId) {
    next
      .filter((c) => c.parentId === oldParentId)
      .sort((a, b) => a.sort - b.sort)
      .forEach((c, i) => { c.sort = i + 1; });
  }
  return next;
}
