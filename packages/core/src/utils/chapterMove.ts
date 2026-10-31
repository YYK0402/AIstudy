import type { Chapter } from "../api";

export type DropPos = "before" | "after" | "inside";

/**
 * 计算拖拽移动后的章节列表（sort/parentId 已更新）。
 * 规则：
 * - 章节仅顶层：在章节行上/下沿拖放 = 顶层换序
 * - 单元挂章节下：在小节行上/下沿 = 插入该小节所在章节的对应位置（可跨章）；在章节行中部 = 追加到该章节末尾
 * - 章节不可放入章节下、不可放在小节行上/下沿
 * 非法落点返回 null。
 */
export function computeChapterMove(all: Chapter[], dragId: number, targetId: number, pos: DropPos): Chapter[] | null {
  const drag = all.find((c) => c.id === dragId);
  const target = all.find((c) => c.id === targetId);
  if (!drag || !target || dragId === targetId) return null;

  const next = all.map((c) => ({ ...c }));
  const byId = (id: number) => next.find((c) => c.id === id);
  const dragCopy = byId(dragId);
  const targetCopy = byId(targetId);
  if (!dragCopy || !targetCopy) return null;
  const oldParentId = dragCopy.parentId;

  let newParentId: number | null;
  if (pos === "inside") {
    if (targetCopy.level !== "chapter" || dragCopy.level !== "unit") return null;
    newParentId = targetId;
  } else if (targetCopy.level === "chapter") {
    if (dragCopy.level !== "chapter") return null;
    newParentId = null;
  } else {
    if (dragCopy.level !== "unit") return null;
    newParentId = targetCopy.parentId;
  }

  dragCopy.parentId = newParentId;

  if (dragCopy.level === "chapter") {
    let top = next.filter((c) => c.level === "chapter" && c.parentId === null).sort((a, b) => a.sort - b.sort);
    top = top.filter((c) => c.id !== dragId);
    const ti = top.findIndex((c) => c.id === targetId);
    if (ti < 0) return null;
    top.splice(pos === "before" ? ti : ti + 1, 0, dragCopy);
    top.forEach((c, i) => {
      c.sort = i + 1;
    });
  } else {
    const pid = newParentId;
    if (pid === null) return null;
    const list = next
      .filter((c) => c.level === "unit" && c.parentId === pid)
      .filter((c) => c.id !== dragId)
      .sort((a, b) => a.sort - b.sort);
    if (pos === "inside") {
      list.push(dragCopy);
    } else {
      const ti = list.findIndex((c) => c.id === targetId);
      if (ti < 0) return null;
      list.splice(pos === "before" ? ti : ti + 1, 0, dragCopy);
    }
    list.forEach((c, i) => {
      c.sort = i + 1;
    });
    // 旧父级（若不同）小节序号重排
    if (oldParentId !== null && oldParentId !== newParentId) {
      next
        .filter((c) => c.level === "unit" && c.parentId === oldParentId)
        .sort((a, b) => a.sort - b.sort)
        .forEach((c, i) => {
          c.sort = i + 1;
        });
    }
  }

  return next;
}
