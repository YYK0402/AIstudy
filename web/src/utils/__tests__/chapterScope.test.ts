import { describe, it, expect } from "vitest";
import { expandChapterNodeIds, kpsOfChapter, kpCountByNode } from "../chapterScope";
import type { Chapter, KnowledgePoint } from "../../api";

const ch1: Chapter = { id: 1, courseId: 1, level: "chapter", parentId: null, name: "一章", siyuanBlockId: null, sort: 1 };
const ch2: Chapter = { id: 2, courseId: 1, level: "chapter", parentId: null, name: "二章", siyuanBlockId: null, sort: 2 };
const u11: Chapter = { id: 11, courseId: 1, level: "unit", parentId: 1, name: "一节", siyuanBlockId: null, sort: 1 };
const u12: Chapter = { id: 12, courseId: 1, level: "unit", parentId: 1, name: "二节", siyuanBlockId: null, sort: 2 };
const u21: Chapter = { id: 21, courseId: 1, level: "unit", parentId: 2, name: "三节", siyuanBlockId: null, sort: 1 };

function kp(id: number, chapterId: number | null): KnowledgePoint {
  return {
    id,
    courseId: 1,
    chapterId,
    blockId: null,
    name: `KP${id}`,
    content: "",
    mastery: "unlearn",
    sourceAssetIds: "",
    prevKpIds: "",
    chapterName: "",
    sort: 0,
    createTime: "",
  };
}

describe("expandChapterNodeIds", () => {
  it("章 = 自身 + 其小节；小节 = 自身", () => {
    const chapters = [ch1, ch2, u11, u12, u21];
    expect(expandChapterNodeIds(chapters, 1)).toEqual(new Set([1, 11, 12]));
    expect(expandChapterNodeIds(chapters, 11)).toEqual(new Set([11]));
  });
});

describe("kpCountByNode", () => {
  it("章行含小节、小节行仅自身、未分配不计", () => {
    const chapters = [ch1, ch2, u11, u12, u21];
    const kps = [kp(1, 1), kp(2, 11), kp(3, 12), kp(4, 12), kp(5, 21), kp(6, null), kp(7, 999)];
    const counts = kpCountByNode(chapters, kps);
    expect(counts.get(1)).toBe(4); // 章一：直属 1 + 小节 2+3+4
    expect(counts.get(11)).toBe(1);
    expect(counts.get(12)).toBe(2);
    expect(counts.get(2)).toBe(1);
    expect(counts.get(21)).toBe(1);
  });

  it("与逐节点 expand+filter 口径一致", () => {
    const chapters = [ch1, ch2, u11, u12, u21];
    const kps = [kp(1, 1), kp(2, 11), kp(3, 12), kp(4, 21), kp(5, 12)];
    const counts = kpCountByNode(chapters, kps);
    for (const c of chapters) {
      const ids = expandChapterNodeIds(chapters, c.id);
      const expected = kps.filter((k) => k.chapterId !== null && ids.has(k.chapterId)).length;
      expect(counts.get(c.id) ?? 0).toBe(expected);
    }
  });
});
