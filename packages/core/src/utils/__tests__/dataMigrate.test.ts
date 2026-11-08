import { describe, expect, it } from "vitest";
import type { AppData } from "../../types/appData";
import { createEmptyData } from "../../types/appData";
import { normalizeAppDataShape } from "../dataMigrate";

function seed(): AppData {
  const d = createEmptyData();
  d.chapters = [
    { id: 1, courseId: 1, parentId: null, siyuanBlockId: null, name: "第一章", level: "chapter" as unknown as number, sort: 1 },
    { id: 2, courseId: 1, parentId: 1, siyuanBlockId: null, name: "1.1 节", level: "unit" as unknown as number, sort: 1 },
  ];
  return d;
}

describe("normalizeAppDataShape", () => {
  it("旧版 level 字符串升为数字", () => {
    const d = seed();
    normalizeAppDataShape(d);
    expect(d.chapters[0].level).toBe(1);
    expect(d.chapters[1].level).toBe(2);
  });
  it("幂等：数字 level 与已有 tocMappings 不被破坏", () => {
    const d = seed();
    d.tocMappings = [{ id: 9, materialId: 5, courseId: 1, materialPath: "第一章", chapterId: 1 }];
    normalizeAppDataShape(d);
    normalizeAppDataShape(d);
    expect(d.chapters[0].level).toBe(1);
    expect(d.tocMappings).toHaveLength(1);
    expect(d.tocMappings[0].id).toBe(9);
  });
  it("缺失 tocMappings 时补空数组", () => {
    const d = createEmptyData();
    delete (d as { tocMappings?: unknown }).tocMappings;
    normalizeAppDataShape(d);
    expect(d.tocMappings).toEqual([]);
  });
});
