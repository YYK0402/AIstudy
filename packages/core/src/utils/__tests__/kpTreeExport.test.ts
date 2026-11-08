import { describe, expect, it } from "vitest";
import type { Chapter, KnowledgePoint, Mastery, Question, WrongQuestion } from "../../types/appData";
import { buildKpTreeMarkdown } from "../kpTreeExport";

function chapter(id: number, level: number, parentId: number | null, sort: number, name: string): Chapter {
  return { id, courseId: 1, parentId, siyuanBlockId: null, name, level, sort };
}

function kp(
  id: number,
  chapterId: number | null,
  mastery: Mastery,
  sort: number,
  name = `kp${id}`,
  content = "",
): KnowledgePoint {
  return {
    id,
    courseId: 1,
    chapterId,
    blockId: null,
    name,
    content,
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
  chapter(10, 1, null, 1, "第一章 存货"),
  chapter(11, 2, 10, 1, "第一节 存货计价"),
  chapter(20, 1, null, 2, "第二章 固定资产"),
];
const KPS = [
  kp(1, 10, "known", 1, "kp1", "第一段内容。\n\n第二段内容。"),
  kp(2, 11, "mastered", 1, "kp2", "单段内容"),
  kp(3, null, "unlearn", 1, "kp3"),
  kp(4, 999, "proficient", 1, "kp4"),
];

describe("buildKpTreeMarkdown（往返格式）", () => {
  it("说明头（course id + 使用说明）+ 章节/知识点带 ch/kp 标记 + 内容缩进导出", () => {
    const md = buildKpTreeMarkdown(COURSE, CHAPTERS, KPS, [], [], { date: "2026-11-03" });
    // 说明头：首行注释块，含课程身份锚点与不可导入检测文案（完整导出可导入）
    expect(md.startsWith("<!--\n")).toBe(true);
    expect(md).toContain("课程：财务管理学（course:1）");
    expect(md).toContain("身份锚点");
    expect(md).not.toContain("不可用于导入");
    // 标题与统计行（导入时忽略）
    expect(md).toContain("# 财务管理学 知识点树\n");
    expect(md).toContain("> 导出时间 2026-11-03 · 2 章 · 4 知识点（2 已掌握）\n");
    // 章节/小节标记（含导出添加的计数后缀）
    expect(md).toContain("# 第一章 存货（2） <!-- ch:10 -->\n");
    expect(md).toContain("## 第一节 存货计价（1） <!-- ch:11 -->\n");
    expect(md).toContain("# 第二章 固定资产（0） <!-- ch:20 -->\n");
    // 未归章是虚拟分组：无 ch 标记
    expect(md).toContain("# 未归章（2）\n");
    // 知识点标记 + 掌握度 + 内容缩进
    expect(md).toContain("- kp1 [了解] <!-- kp:1 -->\n  第一段内容。\n\n  第二段内容。\n");
    expect(md).toContain("- kp2 [掌握] <!-- kp:2 -->\n  单段内容\n");
    expect(md).toContain("- kp3 [未学习] <!-- kp:3 -->\n");
    expect(md).toContain("- kp4 [精通] <!-- kp:4 -->\n");
  });

  it("完整导出（非 onlyUnmastered）声明可往返导入", () => {
    const md = buildKpTreeMarkdown(COURSE, CHAPTERS, KPS, [], [], { date: "2026-11-03" });
    expect(md).toContain("可导回更新");
  });

  it("includeMastery=false 时不带掌握度 tag（标记仍在，可导入）", () => {
    const md = buildKpTreeMarkdown(COURSE, CHAPTERS, KPS, [], [], {
      date: "2026-11-03",
      includeMastery: false,
    });
    expect(md).toContain("- kp1 <!-- kp:1 -->\n");
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
    expect(md).toContain("- kp1 [了解]（2 错题） <!-- kp:1 -->");
    // 毕业错题（q102）不计
    expect(md).not.toContain("（3 错题）");
    expect(md).not.toContain("（1 错题）");
  });

  it("includeWrongCount 默认关闭：0 错题知识点不带后缀", () => {
    const md = buildKpTreeMarkdown(COURSE, CHAPTERS, KPS, [wrong(1, 101)], [question(101, "1")], {
      date: "2026-11-03",
    });
    expect(md).toContain("- kp1 [了解] <!-- kp:1 -->\n");
  });

  it("onlyUnmastered：只保留未学习/了解，统计行随之收窄，且声明不可导入", () => {
    const md = buildKpTreeMarkdown(COURSE, CHAPTERS, KPS, [], [], { date: "2026-11-03", onlyUnmastered: true });
    expect(md).toContain("> 导出时间 2026-11-03 · 2 章 · 2 知识点（0 已掌握）");
    expect(md).toContain("- kp1 [了解] <!-- kp:1 -->");
    expect(md).toContain("- kp3 [未学习] <!-- kp:3 -->");
    expect(md).not.toContain("- kp2 [掌握]");
    expect(md).not.toContain("- kp4 [精通]");
    // 过滤后第二章与未归章计数
    expect(md).toContain("# 第二章 固定资产（0） <!-- ch:20 -->");
    expect(md).toContain("# 未归章（1）\n");
    // 过滤版缺失已掌握知识点 → 导入会误删，必须声明不可导入
    expect(md).toContain("不可用于导入");
  });

  it("空内容知识点不产生缩进行；内容保留原始换行", () => {
    const md = buildKpTreeMarkdown(COURSE, CHAPTERS, KPS, [], [], { date: "2026-11-03" });
    // kp3 无内容：标记行后直接是下一行
    expect(md).toContain("- kp3 [未学习] <!-- kp:3 -->\n- kp4 [精通] <!-- kp:4 -->\n");
  });
});

describe("buildKpTreeMarkdown（N 级）", () => {
  const CH3 = [
    chapter(10, 1, null, 1, "第一章 存货"),
    chapter(11, 2, 10, 1, "第一节 计价"),
    chapter(12, 3, 11, 1, "1.1 方法"),
    chapter(13, 4, 12, 1, "1.1.1 细节"),
    chapter(14, 3, 11, 2, "1.2 计量"),
    chapter(20, 1, null, 2, "第二章 固定资产"),
  ];
  const KPS3 = [
    kp(1, 10, "known", 1, "kp1", "内容1"),
    kp(2, 11, "mastered", 1, "kp2"),
    kp(3, 12, "unlearn", 1, "kp3"),
    kp(4, 13, "known", 1, "kp4"),
    kp(5, 14, "mastered", 1, "kp5"),
    kp(6, 999, "proficient", 1, "kp6"),
  ];

  it("标题 # 数 = 节点层级（L3→###、L4→####），ch 标记保留；顶章计数=整棵子树、非顶=直属；L3/L4 KP 归所在节点", () => {
    const md = buildKpTreeMarkdown(COURSE, CH3, KPS3, [], [], { date: "2026-11-03" });
    expect(md).toContain("> 导出时间 2026-11-03 · 2 章 · 6 知识点（3 已掌握）\n");
    expect(md).toContain("# 第一章 存货（5） <!-- ch:10 -->\n");
    expect(md).toContain("## 第一节 计价（1） <!-- ch:11 -->\n");
    expect(md).toContain("### 1.1 方法（1） <!-- ch:12 -->\n");
    expect(md).toContain("#### 1.1.1 细节（1） <!-- ch:13 -->\n");
    expect(md).toContain("### 1.2 计量（1） <!-- ch:14 -->\n");
    expect(md).toContain("# 第二章 固定资产（0） <!-- ch:20 -->\n");
    expect(md).toContain("# 未归章（1）\n");
    // KP 紧跟其所在节点的标题行（L3/L4 归属正确，不再进「未归章」）
    expect(md).toContain("### 1.1 方法（1） <!-- ch:12 -->\n- kp3 [未学习] <!-- kp:3 -->\n");
    expect(md).toContain("#### 1.1.1 细节（1） <!-- ch:13 -->\n- kp4 [了解] <!-- kp:4 -->\n");
    expect(md).toContain("### 1.2 计量（1） <!-- ch:14 -->\n- kp5 [掌握] <!-- kp:5 -->\n");
  });

  it("两级课程导出与旧格式逐字节一致（向后兼容锁定）", () => {
    const md = buildKpTreeMarkdown(COURSE, CHAPTERS, KPS, [], [], { date: "2026-11-03" });
    expect(md).toBe(
      [
        "<!--",
        "【知识点树往返文件】课程：财务管理学（course:1）· 导出 2026-11-03",
        "本文件可导回更新：在编辑器中修改后，用「导入知识点树」选择本文件，应用先预览变更清单、确认后生效。",
        "使用说明：",
        "1. 结构：「# 章」/「## 节」/「- 知识点条目」；知识点内容写在条目下方缩进 2 空格，支持多段落（空行分段），可自由编辑。",
        "2. 章/条目行上的 ch:ID / kp:ID 注释标记是身份锚点：导入按 ID 匹配以保留掌握度与题目关联，请勿修改或删除。",
        "3. 重命名知识点/章节：直接改标记前的文字；导入按 ID 匹配，不会当成新建。",
        "4. 新增：加新条目或新章/节标题（不带标记）→ 导入时创建新知识点（默认「未学习」）/新章节，归入其在文件中的所在章节。",
        "5. 删除：整条删除（含其缩进内容）或整章/节删除 → 导入时删除对应知识点/章节（先经预览确认）；题库不删，仅失去该知识点绑定。",
        "6. 移动：把条目挪到其他章/节 = 变更归属；把小节挪到其他顶章下 = 变更小节归属。",
        "7. [掌握度] 与（N 错题）是参考标签：导入不会改动掌握度、错题、闪卡、复习排期与任何学习记录。",
        "8. 本注释块与文件顶部「导出时间」统计行在导入时自动忽略，可删除（删除后按一级标题「课程名 知识点树」校验课程）。",
        "-->",
        "",
        "# 财务管理学 知识点树",
        "",
        "> 导出时间 2026-11-03 · 2 章 · 4 知识点（2 已掌握）",
        "",
        "# 第一章 存货（2） <!-- ch:10 -->",
        "- kp1 [了解] <!-- kp:1 -->",
        "  第一段内容。",
        "",
        "  第二段内容。",
        "## 第一节 存货计价（1） <!-- ch:11 -->",
        "- kp2 [掌握] <!-- kp:2 -->",
        "  单段内容",
        "",
        "# 第二章 固定资产（0） <!-- ch:20 -->",
        "",
        "# 未归章（2）",
        "- kp3 [未学习] <!-- kp:3 -->",
        "- kp4 [精通] <!-- kp:4 -->",
        "",
      ].join("\n"),
    );
  });
});
