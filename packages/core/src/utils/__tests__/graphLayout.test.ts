import { describe, expect, it } from "vitest";
import { applySavedPositions, buildRelationView, clampPosition } from "../graphLayout";

const nodes = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];

describe("buildRelationView", () => {
  it("只保留边端点，其余计为孤立", () => {
    const { visibleIds, isolatedCount } = buildRelationView(nodes, [{ from: 1, to: 2 }]);
    expect([...visibleIds].sort()).toEqual([1, 2]);
    expect(isolatedCount).toBe(2);
  });

  it("无边时返回全部节点且孤立数为 0（页面用网格展示）", () => {
    const { visibleIds, isolatedCount } = buildRelationView(nodes, []);
    expect(visibleIds.size).toBe(4);
    expect(isolatedCount).toBe(0);
  });

  it("忽略引用已删除节点的边", () => {
    const { visibleIds, isolatedCount } = buildRelationView(nodes, [{ from: 1, to: 99 }]);
    expect([...visibleIds]).toEqual([1]);
    expect(isolatedCount).toBe(3);
  });
});

describe("applySavedPositions", () => {
  it("有保存坐标时覆盖，缺失时保持原样", () => {
    const laid = [
      { id: 1, x: 10, y: 20 },
      { id: 2, x: 30, y: 40 },
    ];
    const out = applySavedPositions(laid, { "1": { x: 100, y: 200 } }, (n) => n.id);
    expect(out[0]).toMatchObject({ x: 100, y: 200 });
    expect(out[1]).toMatchObject({ x: 30, y: 40 });
  });
});

describe("clampPosition", () => {
  it("限制在画布边界内", () => {
    expect(clampPosition({ x: -50, y: 999 }, 400, 300)).toEqual({ x: 20, y: 280 });
  });
});
