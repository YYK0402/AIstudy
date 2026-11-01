import { describe, expect, it } from "vitest";
import type { Chapter, KnowledgePoint, Mastery } from "../../types/appData";
import { buildMasteryTree, levelOf } from "../masteryTree";

function kp(id: number, mastery: Mastery, chapterId: number | null = null): KnowledgePoint {
  return {
    id,
    courseId: 1,
    chapterId,
    blockId: null,
    name: `kp${id}`,
    content: "",
    mastery,
    sourceAssetIds: "",
    prevKpIds: "",
    chapterName: "",
    sort: id,
    createTime: "2026-11-01T00:00:00.000Z",
  };
}

function top(id: number, sort: number, name = `章${id}`): Chapter {
  return { id, courseId: 1, parentId: null, siyuanBlockId: null, name, level: "chapter", sort };
}

function unit(id: number, parentId: number | null, sort: number, name = `节${id}`): Chapter {
  return { id, courseId: 1, parentId, siyuanBlockId: null, name, level: "unit", sort };
}

describe("levelOf", () => {
  it("total=0：未学习", () => {
    expect(levelOf(0, 0)).toBe("unlearn");
  });

  it("r 阈值边界：0.29 未学习 / 0.3 了解 / 0.59 了解 / 0.6 掌握 / 1 精通 / 0.99 掌握", () => {
    expect(levelOf(29, 100)).toBe("unlearn");
    expect(levelOf(30, 100)).toBe("known");
    expect(levelOf(59, 100)).toBe("known");
    expect(levelOf(60, 100)).toBe("mastered");
    expect(levelOf(100, 100)).toBe("proficient");
    expect(levelOf(99, 100)).toBe("mastered");
  });

  it("非整百分比边界：3/5=0.6 掌握、2/5 了解", () => {
    expect(levelOf(3, 5)).toBe("mastered");
    expect(levelOf(2, 5)).toBe("known");
  });
});

describe("buildMasteryTree", () => {
  it("章/小节按 sort 排序，知识点挂小节聚合进章", () => {
    const chapters = [top(2, 2), top(1, 1), unit(11, 1, 2), unit(12, 1, 1)];
    const kps = [kp(1, "mastered", 1), kp(2, "proficient", 12), kp(3, "known", 11)];
    const tree = buildMasteryTree(kps, chapters);
    expect(tree.chapters.map((c) => c.id)).toEqual([1, 2]);
    const ch1 = tree.chapters[0];
    expect(ch1.units.map((u) => u.id)).toEqual([12, 11]);
    // 章直属 1 个 + 小节 2 个 = 3
    expect(ch1.total).toBe(3);
    expect(ch1.mastered).toBe(2);
    expect(ch1.level).toBe("mastered"); // 2/3 ≈ 0.67 ≥ 0.6
  });

  it("空 chapters：全部归 unassigned", () => {
    const kps = [kp(1, "mastered", 99), kp(2, "unlearn", null)];
    const tree = buildMasteryTree(kps, []);
    expect(tree.chapters).toEqual([]);
    expect(tree.unassigned?.total).toBe(2);
    expect(tree.unassigned?.kps).toEqual([1, 2]);
  });

  it("chapterId=null / 孤儿小节 / 幽灵章节 id 均归 unassigned；无则 null", () => {
    const chapters = [top(1, 1), unit(99, null, 1)]; // 孤儿小节：parentId null
    const kps = [kp(1, "mastered", null), kp(2, "known", 99), kp(3, "known", 404), kp(4, "unlearn", 1)];
    const tree = buildMasteryTree(kps, chapters);
    expect(tree.unassigned?.kps.sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(tree.chapters[0].total).toBe(1);
    const none = buildMasteryTree([kp(1, "mastered", 1)], [top(1, 1)]);
    expect(none.unassigned).toBeNull();
  });

  it("无知识点章节：level 未学习、units 空", () => {
    const tree = buildMasteryTree([], [top(1, 1), unit(11, 1, 1)]);
    expect(tree.chapters[0].total).toBe(0);
    expect(tree.chapters[0].level).toBe("unlearn");
    expect(tree.chapters[0].units).toHaveLength(1);
    expect(tree.chapters[0].units[0].total).toBe(0);
  });
});
