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
  return { id, courseId: 1, parentId: null, siyuanBlockId: null, name, level: 1, sort };
}

function unit(id: number, parentId: number | null, sort: number, name = `节${id}`): Chapter {
  return { id, courseId: 1, parentId, siyuanBlockId: null, name, level: 2, sort };
}

function sub(id: number, parentId: number, sort: number, name = `目${id}`): Chapter {
  return { id, courseId: 1, parentId, siyuanBlockId: null, name, level: 3, sort };
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
    expect(ch1.children.map((u) => u.id)).toEqual([12, 11]);
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

  it("chapterId=null / 幽灵章节 id 归 unassigned；孤儿节点 KP 直属该节点（提升顶层）；无则 null", () => {
    const chapters = [top(1, 1), unit(99, null, 1)]; // 孤儿小节：parentId null → buildChapterTreeFlat 提升顶层
    const kps = [kp(1, "mastered", null), kp(2, "known", 99), kp(3, "known", 404), kp(4, "unlearn", 1)];
    const tree = buildMasteryTree(kps, chapters);
    // 仅 null / 幽灵归未归章；kp2 直属孤儿节点 99
    expect(tree.unassigned?.kps.sort((a, b) => a - b)).toEqual([1, 3]);
    expect(tree.chapters[0].total).toBe(1);
    expect(tree.chapters[1].id).toBe(99);
    expect(tree.chapters[1].kps).toEqual([2]);
    const none = buildMasteryTree([kp(1, "mastered", 1)], [top(1, 1)]);
    expect(none.unassigned).toBeNull();
  });

  it("无知识点章节：level 未学习、children 空", () => {
    const tree = buildMasteryTree([], [top(1, 1), unit(11, 1, 1)]);
    expect(tree.chapters[0].total).toBe(0);
    expect(tree.chapters[0].level).toBe("unlearn");
    expect(tree.chapters[0].children).toHaveLength(1);
    expect(tree.chapters[0].children[0].total).toBe(0);
  });

  it("L3 用例：L1→L2→L3 各挂 KP，L3 行现于 L2 children，L2/L1 计数含 L3 KP 不重复计，幽灵归未归章", () => {
    const chapters = [top(1, 1), unit(11, 1, 1), sub(111, 11, 1)];
    const kps = [
      kp(1, "mastered", 1), // L1 直属
      kp(2, "proficient", 11), // L2 直属
      kp(3, "known", 111), // L3 直属
      kp(4, "unlearn", 404), // 幽灵章节
    ];
    const tree = buildMasteryTree(kps, chapters);
    const ch1 = tree.chapters[0];
    const u11 = ch1.children.find((c) => c.id === 11)!;
    const s111 = u11.children.find((c) => c.id === 111)!;
    // L3 行出现于 L2 children
    expect(s111.total).toBe(1);
    expect(s111.kps).toEqual([3]);
    expect(s111.mastered).toBe(0); // known 不计入 mastered
    // L2 = 直属 kp2 + 后代 kp3（L3 KP 计一次，不重复）
    expect(u11.kps.sort((a, b) => a - b)).toEqual([2, 3]);
    expect(u11.total).toBe(2);
    expect(u11.mastered).toBe(1); // kp2 proficient
    // L1 = 直属 kp1 + 后代 kp2 + 后代 kp3（L3 KP 只计一次）
    expect(ch1.kps.sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(ch1.total).toBe(3);
    expect(ch1.mastered).toBe(2); // kp1 mastered + kp2 proficient
    expect(ch1.level).toBe("mastered"); // 2/3 ≈ 0.67 ≥ 0.6
    // 幽灵 404 归未归章
    expect(tree.unassigned?.kps).toEqual([4]);
  });
});
