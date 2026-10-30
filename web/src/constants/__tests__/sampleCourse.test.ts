import { describe, expect, it } from "vitest";
import { SAMPLE_COURSE } from "../sampleCourse";

describe("SAMPLE_COURSE 数据完整性", () => {
  it("不含任何原始资料（IP 安全）", () => {
    expect(SAMPLE_COURSE.materials).toEqual([]);
    expect(SAMPLE_COURSE.materialChapters).toEqual([]);
    for (const k of SAMPLE_COURSE.knowledgePoints) {
      expect(k.sourceAssetIds).toBe("");
    }
  });

  it("章节全部属于本课程且为 chapter 级（用于章末测评排期）", () => {
    const cid = SAMPLE_COURSE.course.id;
    for (const c of SAMPLE_COURSE.chapters) {
      expect(c.courseId).toBe(cid);
      expect(c.level).toBe("chapter");
    }
  });

  it("知识点 chapterId 均指向存在的章节，courseId 正确", () => {
    const chIds = new Set(SAMPLE_COURSE.chapters.map((c) => c.id));
    const cid = SAMPLE_COURSE.course.id;
    for (const k of SAMPLE_COURSE.knowledgePoints) {
      expect(k.courseId).toBe(cid);
      expect(k.chapterId).not.toBeNull();
      expect(chIds.has(k.chapterId!)).toBe(true);
    }
  });

  it("题目 kpIds 均指向存在的知识点，courseId 正确", () => {
    const kpIds = new Set(SAMPLE_COURSE.knowledgePoints.map((k) => k.id));
    const cid = SAMPLE_COURSE.course.id;
    for (const q of SAMPLE_COURSE.questions) {
      expect(q.courseId).toBe(cid);
      const refs = q.kpIds.split(",").map((s) => Number(s.trim())).filter((n) => n > 0);
      expect(refs.length).toBeGreaterThan(0);
      for (const n of refs) expect(kpIds.has(n)).toBe(true);
    }
  });

  it("题目 paperId 均指向存在的试卷（或 null）", () => {
    const paperIds = new Set(SAMPLE_COURSE.examPapers.map((p) => p.id));
    for (const q of SAMPLE_COURSE.questions) {
      if (q.paperId != null) expect(paperIds.has(q.paperId)).toBe(true);
    }
  });

  it("闪卡 kpId 均指向存在的知识点，courseId 正确", () => {
    const kpIds = new Set(SAMPLE_COURSE.knowledgePoints.map((k) => k.id));
    const cid = SAMPLE_COURSE.course.id;
    for (const c of SAMPLE_COURSE.flashCards) {
      expect(c.courseId).toBe(cid);
      expect(kpIds.has(c.kpId)).toBe(true);
    }
  });

  it("数量符合中规模约定（4 章 / 12 知识点 / 20 题 / 10 闪卡）", () => {
    expect(SAMPLE_COURSE.chapters).toHaveLength(4);
    expect(SAMPLE_COURSE.knowledgePoints).toHaveLength(12);
    expect(SAMPLE_COURSE.questions).toHaveLength(20);
    expect(SAMPLE_COURSE.flashCards).toHaveLength(10);
  });

  it("课程状态为 active（可学习，非归档）", () => {
    expect(SAMPLE_COURSE.course.status).toBe("active");
  });
});
