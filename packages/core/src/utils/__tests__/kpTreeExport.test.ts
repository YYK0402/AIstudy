import { describe, expect, it } from "vitest";
import type { Chapter, KnowledgePoint, Mastery, Question, WrongQuestion } from "../../types/appData";
import { buildKpTreeMarkdown } from "../kpTreeExport";

function chapter(id: number, level: "chapter" | "unit", parentId: number | null, sort: number, name: string): Chapter {
  return { id, courseId: 1, parentId, siyuanBlockId: null, name, level, sort };
}

function kp(id: number, chapterId: number | null, mastery: Mastery, sort: number, name = `kp${id}`): KnowledgePoint {
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
    sort,
    createTime: "2026-11-01T00:00:00.000Z",
  };
}

function question(id: number, kpIds: string): Question {
  return {
    id,
    courseId: 1,
    kpIds,
    title: `q${id}`,
    options: "",
    answer: "A",
    analysis: "",
    qType: "single",
    difficulty: "medium",
    source: "ai",
    paperId: null,
    createTime: "2026-11-01T00:00:00.000Z",
  };
}

function wrong(id: number, qId: number, status: "active" | "graduated" = "active"): WrongQuestion {
  return {
    id,
    recordId: null,
    qId,
    reviewTimes: 0,
    createTime: "2026-11-01T00:00:00.000Z",
    status,
  };
}

const COURSE = { id: 1, name: "财务管理学" };
const CHAPTERS = [
  chapter(10, "chapter", null, 1, "第一章 存货"),
  chapter(11, "unit", 10, 1, "第一节 存货计价"),
  chapter(20, "chapter", null, 2, "第二章 固定资产"),
];
const KPS = [
  kp(1, 10, "known", 1),
  kp(2, 11, "mastered", 1),
  kp(3, null, "unlearn", 1),
  kp(4, 999, "proficient", 1),
];

describe("buildKpTreeMarkdown", () => {
  it("章节树结构：顶章 H1 + 小节 H2 + 孤儿/幽灵归未归章 + 统计行", () => {
    const md = buildKpTreeMarkdown(COURSE, CHAPTERS, KPS, [], [], { date: "2026-11-03" });
    expect(md).toBe(
      [
        "# 财务管理学 知识点树",
        "",
        "> 导出时间 2026-11-03 · 2 章 · 4 知识点（2 已掌握）",
        "",
        "# 第一章 存货（2）",
        "- kp1 [了解]",
        "## 第一节 存货计价（1）",
        "- kp2 [掌握]",
        "",
        "# 第二章 固定资产（0）",
        "",
        "# 未归章（2）",
        "- kp3 [未学习]",
        "- kp4 [精通]",
        "",
      ].join("\n"),
    );
  });

  it("includeMastery=false 时不带掌握度 tag", () => {
    const md = buildKpTreeMarkdown(COURSE, CHAPTERS, KPS, [], [], {
      date: "2026-11-03",
      includeMastery: false,
    });
    expect(md).toContain("- kp1\n");
    expect(md).not.toContain("[了解]");
    expect(md).not.toContain("[掌握]");
  });

  it("includeWrongCount：只计在管错题，经题目 kpIds 绑定到知识点；毕业错题不计", () => {
    const md = buildKpTreeMarkdown(
      COURSE,
      CHAPTERS,
      KPS,
      [wrong(1, 101), wrong(2, 101), wrong(3, 102, "graduated")],
      [question(101, "1,5"), question(102, "1")],
      { date: "2026-11-03", includeWrongCount: true },
    );
    expect(md).toContain("- kp1 [了解]（2 错题）");
    // 毕业错题（q102）不计
    expect(md).not.toContain("（3 错题）");
    expect(md).not.toContain("（1 错题）");
  });

  it("includeWrongCount 默认关闭：0 错题知识点不带后缀", () => {
    const md = buildKpTreeMarkdown(COURSE, CHAPTERS, KPS, [wrong(1, 101)], [question(101, "1")], {
      date: "2026-11-03",
    });
    expect(md).toContain("- kp1 [了解]\n");
  });

  it("onlyUnmastered：只保留未学习/了解，统计行随之收窄", () => {
    const md = buildKpTreeMarkdown(COURSE, CHAPTERS, KPS, [], [], { date: "2026-11-03", onlyUnmastered: true });
    expect(md).toContain("> 导出时间 2026-11-03 · 2 章 · 2 知识点（0 已掌握）");
    expect(md).toContain("- kp1 [了解]");
    expect(md).toContain("- kp3 [未学习]");
    expect(md).not.toContain("- kp2 [掌握]");
    expect(md).not.toContain("- kp4 [精通]");
    // 过滤后第二章与未归章计数
    expect(md).toContain("# 第二章 固定资产（0）");
    expect(md).toContain("# 未归章（1）");
  });
});
