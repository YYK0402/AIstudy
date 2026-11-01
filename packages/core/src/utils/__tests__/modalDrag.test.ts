import { describe, expect, it } from "vitest";
import { clampDragOffset } from "../modalDrag";

/**
 * 可拖动弹窗位移约束：按真实基准位 origin（偏移为零时窗口左上角相对容器左上角）
 * 约束窗口边缘不越过容器边界（留 margin）。
 */
const CENTER = { x: 350, y: 100 }; // 容器 1200x800、窗口 500x600 的居中基准位
const BOTTOM_RIGHT = { x: 1200 - 24 - 500, y: 800 - 20 - 600 }; // 右下角基准（right:24 bottom:20）

describe("clampDragOffset", () => {
  it("位移在范围内：原样返回", () => {
    expect(clampDragOffset(50, -30, { w: 500, h: 600 }, { w: 1200, h: 800 }, CENTER, 16)).toEqual({
      dx: 50,
      dy: -30,
    });
  });

  it("向右越界：拉回右边缘", () => {
    // 右边界 dx = 1200-500-16-350 = 334
    const r = clampDragOffset(400, 0, { w: 500, h: 600 }, { w: 1200, h: 800 }, CENTER, 16);
    expect(r.dx).toBe(334);
    expect(r.dy).toBe(0);
  });

  it("向左越界：拉回左边缘", () => {
    // 左边界 dx = 16-350 = -334
    const r = clampDragOffset(-400, 0, { w: 500, h: 600 }, { w: 1200, h: 800 }, CENTER, 16);
    expect(r.dx).toBe(-334);
  });

  it("向下越界：拉回下边缘", () => {
    // 下边界 dy = 800-600-16-100 = 84
    const r = clampDragOffset(0, 200, { w: 500, h: 600 }, { w: 1200, h: 800 }, CENTER, 16);
    expect(r.dy).toBe(84);
  });

  it("向上越界：拉回上边缘", () => {
    // 上边界 dy = 16-100 = -84
    const r = clampDragOffset(0, -200, { w: 500, h: 600 }, { w: 1200, h: 800 }, CENTER, 16);
    expect(r.dy).toBe(-84);
  });

  it("右下角基准：可一路拖到左边缘 / 上边缘，右侧只留定位边距", () => {
    // origin.x = 676：向左可动 16-676 = -660；向右仅 1200-500-16-676 = 8
    const left = clampDragOffset(-900, 0, { w: 500, h: 600 }, { w: 1200, h: 800 }, BOTTOM_RIGHT, 16);
    expect(left.dx).toBe(-660);
    const up = clampDragOffset(0, -900, { w: 500, h: 600 }, { w: 1200, h: 800 }, BOTTOM_RIGHT, 16);
    expect(up.dy).toBe(-164);
    const right = clampDragOffset(200, 0, { w: 500, h: 600 }, { w: 1200, h: 800 }, BOTTOM_RIGHT, 16);
    expect(right.dx).toBe(8);
  });

  it("窗口比容器还宽：取水平中点（对称越界）", () => {
    // min = 16-350 = -334, max = 1100-1200-16-350 = -466 → 中点 -400
    const r = clampDragOffset(100, 0, { w: 1200, h: 300 }, { w: 1100, h: 800 }, CENTER, 16);
    expect(r.dx).toBe(-400);
  });

  it("窗口比容器还高：取垂直中点", () => {
    // min = 16-100 = -84, max = 800-900-16-100 = -216 → 中点 -150
    const r = clampDragOffset(0, 100, { w: 300, h: 900 }, { w: 1100, h: 800 }, CENTER, 16);
    expect(r.dy).toBe(-150);
  });

  it("容器恰好容下窗口（不留边距空间）：位移归零", () => {
    // origin = (16,16)：min = max = 0
    const r = clampDragOffset(50, 50, { w: 500, h: 600 }, { w: 532, h: 632 }, { x: 16, y: 16 }, 16);
    expect(r).toEqual({ dx: 0, dy: 0 });
  });
});
