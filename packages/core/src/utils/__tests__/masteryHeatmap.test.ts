import { describe, expect, it } from "vitest";
import type { Chapter, KnowledgePoint, Mastery } from "../../types/appData";
import { buildMasteryHeatmap } from "../masteryHeatmap";

function kp(id: number, mastery: Mastery, chapterId: number | null, name = `kp${id}`): KnowledgePoint {
  return {
    id,
    courseId: 1,
    chapterId,
    blockId: null,
    name,
    content: "",
    mastery,
    sourceAssetIds: "",
    prevKpIds: "",
    chapterName: "",
    sort: id,
    createTime: "2026-11-01T00:00:00.000Z",
  };
}

function top(id: number, sort: number): Chapter {
  return { id, courseId: 1, parentId: null, siyuanBlockId: null, name: `章${id}`, level: 1, sort };
}

function unit(id: number, parentId: number, sort: number): Chapter {
  return { id, courseId: 1, parentId, siyuanBlockId: null, name: `节${id}`, level: 2, sort };
}

describe("buildMasteryHeatmap", () => {
  it("章/小节知识点归入所属顶层章，mastered 只计 mastered+proficient", () => {
    const chapters = [top(1, 1), unit(11, 1, 1)];
    const kps = [
      kp(1, "mastered", 1),
      kp(2, "proficient", 11),
      kp(3, "known", 1),
    ];
    const rows = buildMasteryHeatmap(kps, chapters);
    expect(rows).toHaveLength(1);
    expect(rows[0].chapterId).toBe(1);
    expect(rows[0].total).toBe(3);
    expect(rows[0].mastered).toBe(2);
    expect(rows[0].kps.map((c) => c.id).sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it("chapterId=null / 孤儿节点 / 空 chapters：归「未归章」末行", () => {
    const chapters = [top(1, 1), unit(99, 7, 1)]; // 99 的父 7 不存在 → 孤儿
    const kps = [
      kp(1, "mastered", null),
      kp(2, "known", 99),
      kp(3, "unlearn", 404),
      kp(4, "proficient", 1),
    ];
    const rows = buildMasteryHeatmap(kps, chapters);
    expect(rows).toHaveLength(2);
    const unassigned = rows[1];
    expect(unassigned.chapterId).toBeNull();
    expect(unassigned.name).toBe("未归章");
    expect(unassigned.total).toBe(3);
    expect(unassigned.mastered).toBe(1);
    expect(rows[0].total).toBe(1);
  });

  it("无未归章知识点时没有「未归章」行；空输入返回空", () => {
    expect(buildMasteryHeatmap([kp(1, "unlearn", 1)], [top(1, 1)])).toHaveLength(1);
    expect(buildMasteryHeatmap([], [top(1, 1)]).map((r) => r.total)).toEqual([0]);
    expect(buildMasteryHeatmap([], [])).toEqual([]);
  });
});
