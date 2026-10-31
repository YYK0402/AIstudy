export interface Size {
  w: number;
  h: number;
}

/**
 * 可拖动弹窗位移约束：弹窗以容器中心为基准偏移 (dx, dy)，
 * 保证弹窗边缘不越过容器边界（留 margin）；该方向无活动空间时归零。
 */
export function clampDragOffset(
  dx: number,
  dy: number,
  modal: Size,
  container: Size,
  margin = 16,
): { dx: number; dy: number } {
  const clampAxis = (v: number, space: number): number => {
    const max = space / 2 - margin;
    const min = margin - space / 2;
    if (max < min) return 0;
    return Math.min(max, Math.max(min, v));
  };
  return {
    dx: clampAxis(dx, container.w - modal.w),
    dy: clampAxis(dy, container.h - modal.h),
  };
}
