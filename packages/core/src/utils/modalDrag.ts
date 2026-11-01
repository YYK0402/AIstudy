export interface Size {
  w: number;
  h: number;
}

export interface Origin {
  x: number;
  y: number;
}

/**
 * 可拖动弹窗位移约束：窗口在偏移 (dx, dy) 为零时，左上角位于容器内的 origin 处
 * （基准位由 CSS 决定，如 right/bottom 定位，不假设居中）。
 * 约束窗口边缘不越过容器边界（留 margin）；该方向无活动空间时归零，
 * 窗口比容器还大时取中点（两侧对称越界最小化）。
 */
export function clampDragOffset(
  dx: number,
  dy: number,
  modal: Size,
  container: Size,
  origin: Origin,
  margin = 16,
): { dx: number; dy: number } {
  const clampAxis = (v: number, start: number, size: number, space: number): number => {
    const min = margin - start;
    const max = space - size - margin - start;
    if (max < min) return Math.round((min + max) / 2);
    return Math.min(max, Math.max(min, v));
  };
  return {
    dx: clampAxis(dx, origin.x, modal.w, container.w),
    dy: clampAxis(dy, origin.y, modal.h, container.h),
  };
}
