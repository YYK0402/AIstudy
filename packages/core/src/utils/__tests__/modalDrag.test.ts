import { describe, expect, it } from "vitest";
import { clampDragOffset } from "../modalDrag";

/**
 * 可拖动弹窗位移约束：弹窗以容器中心为基准偏移 (dx, dy)，
 * 约束弹窗边缘不越过容器边界（留 margin），越界时拉回。
 */
describe("clampDragOffset", () => {
  it("位移在范围内：原样返回", () => {
    expect(clampDragOffset(50, -30, { w: 500, h: 600 }, { w: 1200, h: 800 }, 16)).toEqual({ dx: 50, dy: -30 });
  });

  it("向右越界：拉回右边缘", () => {
    // 右边界 maxX = (1200-500)/2 - 16 = 334
    const r = clampDragOffset(400, 0, { w: 500, h: 600 }, { w: 1200, h: 800 }, 16);
    expect(r.dx).toBe(334);
    expect(r.dy).toBe(0);
  });

  it("向左越界：拉回左边缘", () => {
    // 左边界 minX = 16 - (1200-500)/2 = -334
    const r = clampDragOffset(-400, 0, { w: 500, h: 600 }, { w: 1200, h: 800 }, 16);
    expect(r.dx).toBe(-334);
  });

  it("向下越界：拉回下边缘", () => {
    // 下边界 maxY = (800-600)/2 - 16 = 84
    const r = clampDragOffset(0, 200, { w: 500, h: 600 }, { w: 1200, h: 800 }, 16);
    expect(r.dy).toBe(84);
  });

  it("向上越界：拉回上边缘", () => {
    // 上边界 minY = 16 - (800-600)/2 = -84
    const r = clampDragOffset(0, -200, { w: 500, h: 600 }, { w: 1200, h: 800 }, 16);
    expect(r.dy).toBe(-84);
  });

  it("弹窗比容器还宽：水平无法移动，归零", () => {
    const r = clampDragOffset(100, 0, { w: 1200, h: 300 }, { w: 1100, h: 800 }, 16);
    expect(r.dx).toBe(0);
  });

  it("弹窗比容器还高：垂直无法移动，归零", () => {
    const r = clampDragOffset(0, 100, { w: 300, h: 900 }, { w: 1100, h: 800 }, 16);
    expect(r.dy).toBe(0);
  });

  it("容器恰好容下弹窗（不留边距空间）：位移归零", () => {
    const r = clampDragOffset(50, 50, { w: 500, h: 600 }, { w: 532, h: 632 }, 16);
    expect(r).toEqual({ dx: 0, dy: 0 });
  });
});
