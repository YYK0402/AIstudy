import { describe, expect, it } from "vitest";
import type { AppData, Chapter, KnowledgePoint, Mastery } from "../../types/appData";
import { createEmptyData } from "../../types/appData";
import { buildKpTreeMarkdown } from "../kpTreeExport";
import { applyKpTreeDiff, computeKpTreeDiff, effectiveNodeOf, parseKpTreeMarkdown } from "../kpTreeImport";

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
  tags?: string[],
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
    ...(tags ? { tags } : {}),
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

function makeData(): AppData {
  const data = createEmptyData();
  data.courses = [{ id: 1, siyuanDocId: null, name: "财务管理学", description: "", target: "", totalCycle: "", status: "active", createTime: "2026-01-01T00:00:00Z" }];
  data.chapters = [...CHAPTERS];
  data.knowledgePoints = [...KPS];
  return data;
}

/** 导出 → 解析（往返链路） */
function roundTrip(tree?: string) {
  const md = tree ?? buildKpTreeMarkdown(COURSE, CHAPTERS, KPS, [], [], { date: "2026-11-03" });
  const res = parseKpTreeMarkdown(md);
  if (!res.ok) throw new Error(res.error);
  return res.tree;
}

describe("parseKpTreeMarkdown", () => {
  it("解析完整导出：courseId/可导入/章节（含标记）/未归章/KP（名称去显示标签、多段落内容还原）", () => {
    const tree = roundTrip();
    expect(tree.importable).toBe(true);
    expect(tree.courseId).toBe(1);
    expect(tree.courseName).toBe("财务管理学");
    expect(tree.chapters).toHaveLength(3);
    const ch10 = tree.chapters.find((c) => c.id === 10)!;
    expect(ch10).toMatchObject({ name: "第一章 存货", level: 1, parentKey: null });
    const ch11 = tree.chapters.find((c) => c.id === 11)!;
    expect(ch11).toMatchObject({ name: "第一节 存货计价", level: 2 });
    expect(ch11.parentKey).toBe(ch10.key);
    const kp1 = tree.kps.find((k) => k.id === 1)!;
    expect(kp1.name).toBe("kp1");
    expect(kp1.content).toBe("第一段内容。\n\n第二段内容。");
    expect(kp1.chapterKey).toBe(ch10.key);
    const kp2 = tree.kps.find((k) => k.id === 2)!;
    expect(kp2.chapterKey).toBe(ch11.key);
    // 未归章是虚拟分组：kp3（chapterId null）与 kp4（幽灵 999）都归 null
    expect(tree.kps.find((k) => k.id === 3)!.chapterKey).toBeNull();
    expect(tree.kps.find((k) => k.id === 4)!.chapterKey).toBeNull();
  });

  it("onlyUnmastered 过滤导出声明不可导入", () => {
    const md = buildKpTreeMarkdown(COURSE, CHAPTERS, KPS, [], [], { date: "2026-11-03", onlyUnmastered: true });
    const tree = roundTrip(md);
    expect(tree.importable).toBe(false);
    expect(tree.kps).toHaveLength(2);
  });

  it("改名（保留标记）：解析出新名称；删除计数后缀与掌握度/错题标签", () => {
    const md = buildKpTreeMarkdown(COURSE, CHAPTERS, KPS, [], [], { date: "2026-11-03" })
      .replace("- kp1 [了解] <!-- kp:1 -->", "- 存货的定义（改） [掌握]（2 错题） <!-- kp:1 -->");
    const tree = roundTrip(md);
    expect(tree.kps.find((k) => k.id === 1)!.name).toBe("存货的定义（改）");
  });

  it("新增条目（无 kp 标记）→ id null；新章节（无 ch 标记）→ id null", () => {
    const md = buildKpTreeMarkdown(COURSE, CHAPTERS, KPS, [], [], { date: "2026-11-03" })
      .replace(
        "# 第一章 存货（2） <!-- ch:10 -->\n- kp1 [了解] <!-- kp:1 -->",
        "# 第一章 存货（2） <!-- ch:10 -->\n- 新增知识点 <!-- kp:99 -->\n- 全新条目\n  新内容\n## 新小节\n- 小节里的新条目",
      );
    const tree = roundTrip(md);
    const fresh = tree.kps.find((k) => k.name === "全新条目")!;
    expect(fresh.id).toBeNull();
    expect(fresh.content).toBe("新内容");
    expect(fresh.chapterKey).toBe(tree.chapters.find((c) => c.id === 10)!.key);
    const newUnit = tree.chapters.find((c) => c.name === "新小节")!;
    expect(newUnit.id).toBeNull();
    expect(newUnit.level).toBe(2);
    expect(tree.kps.find((k) => k.name === "小节里的新条目")!.chapterKey).toBe(newUnit.key);
  });

  it("移动条目到其他章节 → chapterKey 跟随位置", () => {
    const md = buildKpTreeMarkdown(COURSE, CHAPTERS, KPS, [], [], { date: "2026-11-03" });
    const moved = "- kp4 [精通] <!-- kp:4 -->\n";
    const without = md.replace(moved, "");
    const withMoved = without.replace("## 第一节 存货计价（1） <!-- ch:11 -->\n", "## 第一节 存货计价（1） <!-- ch:11 -->\n" + moved);
    const tree = roundTrip(withMoved);
    expect(tree.kps.find((k) => k.id === 4)!.chapterKey).toBe(tree.chapters.find((c) => c.id === 11)!.key);
  });

  it("删除说明头：courseId 缺失，courseName 从一级标题恢复", () => {
    const md = buildKpTreeMarkdown(COURSE, CHAPTERS, KPS, [], [], { date: "2026-11-03" });
    const lines = md.split("\n");
    const closeIdx = lines.findIndex((l) => l.trim() === "-->");
    const stripped = lines.slice(closeIdx + 1).join("\n").replace(/^\n+/, "");
    const res = parseKpTreeMarkdown(stripped);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.tree.courseId).toBeNull();
      expect(res.tree.courseName).toBe("财务管理学");
    }
  });

  it.each([
    ["未闭合的说明头", "<!-- 只有开头没有结尾\n# 第一章 存货（0） <!-- ch:10 -->\n"],
    ["条目不在任何章节下", "# 财务管理学 知识点树\n- 孤儿条目 <!-- kp:1 -->\n# 第一章 存货（0） <!-- ch:10 -->\n"],
    ["小节先于顶章出现", "# 财务管理学 知识点树\n## 无主小节\n"],
    ["未识别的非缩进行", "# 财务管理学 知识点树\n# 第一章 存货（0） <!-- ch:10 -->\n随便一段文字\n"],
    ["缩进行不在条目之后", "# 财务管理学 知识点树\n# 第一章 存货（0） <!-- ch:10 -->\n  悬空缩进行\n"],
    ["重复的 kp 标记", "# 财务管理学 知识点树\n# 第一章 存货（2） <!-- ch:10 -->\n- a <!-- kp:1 -->\n- b <!-- kp:1 -->\n"],
  ])("%s → 报错（带行号）", (_label, text) => {
    const res = parseKpTreeMarkdown(text);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.line).toBeGreaterThan(0);
  });
});

describe("effectiveNodeOf（KP 归属节点 = 思源区域同步落点）", () => {
  const top = chapter(10, 1, null, 1, "第一章");
  const unit = chapter(11, 2, 10, 1, "第一节");
  const sub = chapter(12, 3, 11, 1, "1.1 小节");
  const deep = chapter(13, 4, 12, 1, "1.1.1 更深层");
  const all = [top, unit, sub, deep];

  it("level≤2 语义不变：顶章/节直属自身，孤儿节与幽灵章节回退 null", () => {
    const orphan = chapter(14, 2, 99, 1, "孤儿节");
    const list = [...all, orphan];
    expect(effectiveNodeOf({ chapterId: 10 }, list)).toBe(10);
    expect(effectiveNodeOf({ chapterId: 11 }, list)).toBe(11);
    expect(effectiveNodeOf({ chapterId: 14 }, list)).toBeNull();
    expect(effectiveNodeOf({ chapterId: null }, list)).toBeNull();
    expect(effectiveNodeOf({ chapterId: 99 }, list)).toBeNull();
  });

  it("level>2 落最近 level≤2 祖先：L3 → 节，L4 上溯两级 → 节", () => {
    expect(effectiveNodeOf({ chapterId: 12 }, all)).toBe(11);
    expect(effectiveNodeOf({ chapterId: 13 }, all)).toBe(11);
  });

  it("断链（父节点已删）回退自身，不抛错", () => {
    expect(effectiveNodeOf({ chapterId: 12 }, [top, sub])).toBe(12);
  });
});

describe("computeKpTreeDiff", () => {
  it("往返零变更：导出 → 解析 → diff 全空", () => {
    const diff = computeKpTreeDiff(roundTrip(), CHAPTERS, KPS);
    expect(diff.updated).toHaveLength(0);
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.chaptersUpdated).toHaveLength(0);
    expect(diff.chaptersAdded).toHaveLength(0);
    expect(diff.chaptersRemoved).toHaveLength(0);
    expect(diff.unchangedKps).toBe(4);
  });

  it("改内容 → updated（仅 content）；改名称 → updated（仅 name）", () => {
    let md = buildKpTreeMarkdown(COURSE, CHAPTERS, KPS, [], [], { date: "2026-11-03" });
    md = md.replace("  第一段内容。\n\n  第二段内容。", "  改过的内容。");
    md = md.replace("- kp2 [掌握] <!-- kp:2 -->", "- kp2改名 [掌握] <!-- kp:2 -->");
    const diff = computeKpTreeDiff(roundTrip(md), CHAPTERS, KPS);
    expect(diff.updated).toHaveLength(2);
    const u1 = diff.updated.find((u) => u.id === 1)!;
    expect(u1.content).toBe("改过的内容。");
    expect(u1.name).toBeUndefined();
    const u2 = diff.updated.find((u) => u.id === 2)!;
    expect(u2.name).toBe("kp2改名");
    expect(u2.content).toBeUndefined();
    expect(diff.unchangedKps).toBe(2);
  });

  it("移动 kp4 到 ch:11 → updated 含 chapterKey 变更", () => {
    const md = buildKpTreeMarkdown(COURSE, CHAPTERS, KPS, [], [], { date: "2026-11-03" });
    const moved = "- kp4 [精通] <!-- kp:4 -->\n";
    const withMoved = md.replace(moved, "").replace(
      "## 第一节 存货计价（1） <!-- ch:11 -->\n",
      "## 第一节 存货计价（1） <!-- ch:11 -->\n" + moved,
    );
    const tree = roundTrip(withMoved);
    const diff = computeKpTreeDiff(tree, CHAPTERS, KPS);
    const u = diff.updated.find((u) => u.id === 4)!;
    expect(u.chapterKey).toBe(tree.chapters.find((c) => c.id === 11)!.key);
    expect(diff.unchangedKps).toBe(3);
  });

  it("删条目 → removed；删整章（含小节与条目）→ chaptersRemoved 级联", () => {
    let md = buildKpTreeMarkdown(COURSE, CHAPTERS, KPS, [], [], { date: "2026-11-03" });
    md = md.replace("- kp3 [未学习] <!-- kp:3 -->\n", "");
    // 整块删掉第二章
    md = md.replace(/\n# 第二章 固定资产（0） <!-- ch:20 -->\n/, "\n");
    const diff = computeKpTreeDiff(roundTrip(md), CHAPTERS, KPS);
    expect(diff.removed.map((r) => r.id)).toEqual([3]);
    expect(diff.chaptersRemoved.map((r) => r.id).sort()).toEqual([20]);
  });

  it("chaptersRemoved 携带 siyuanBlockId 快照（章无思源文档时为 null）", () => {
    const md = buildKpTreeMarkdown(COURSE, CHAPTERS, KPS, [], [], { date: "2026-11-03" })
      .replace(/\n# 第二章 固定资产（0） <!-- ch:20 -->\n/, "\n");
    const tree = roundTrip(md);
    // 章带思源文档 → 快照取原值
    const withDoc = CHAPTERS.map((c) => (c.id === 20 ? { ...c, siyuanBlockId: "doc-ch20" } : c));
    const diff = computeKpTreeDiff(tree, withDoc, KPS);
    expect(diff.chaptersRemoved).toHaveLength(1);
    expect(diff.chaptersRemoved[0].siyuanBlockId).toBe("doc-ch20");
    // 章无思源文档（null）→ 字段为 null
    const diff2 = computeKpTreeDiff(tree, CHAPTERS, KPS);
    expect(diff2.chaptersRemoved[0].siyuanBlockId).toBeNull();
  });

  it("新章节 + 新条目 → chaptersAdded + added（chapterKey 指向新章节）", () => {
    const md = buildKpTreeMarkdown(COURSE, CHAPTERS, KPS, [], [], { date: "2026-11-03" }) +
      "\n# 第三章 新章\n- 新知识点\n  新内容\n";
    const tree = roundTrip(md);
    const diff = computeKpTreeDiff(tree, CHAPTERS, KPS);
    expect(diff.chaptersAdded).toHaveLength(1);
    expect(diff.chaptersAdded[0]).toMatchObject({ name: "第三章 新章", level: 1 });
    expect(diff.added).toHaveLength(1);
    expect(diff.added[0].name).toBe("新知识点");
    expect(diff.added[0].chapterKey).toBe(diff.chaptersAdded[0].key);
  });

  it("章节删标记（用户误删）→ 旧章 removed + 新章 added，条目跟随新章", () => {
    const md = buildKpTreeMarkdown(COURSE, CHAPTERS, KPS, [], [], { date: "2026-11-03" })
      .replace("# 第二章 固定资产（0） <!-- ch:20 -->", "# 第二章 固定资产（0）");
    const tree = roundTrip(md);
    const diff = computeKpTreeDiff(tree, CHAPTERS, KPS);
    expect(diff.chaptersRemoved.map((r) => r.id)).toEqual([20]);
    expect(diff.chaptersAdded).toHaveLength(1);
    expect(diff.chaptersAdded[0].name).toBe("第二章 固定资产");
    expect(diff.unchangedKps).toBe(4); // 条目都在文件里，无删无增
  });
});

describe("applyKpTreeDiff", () => {
  it("应用零变更 diff：数据不变", () => {
    const tree = roundTrip();
    const diff = computeKpTreeDiff(tree, CHAPTERS, KPS);
    const data = makeData();
    const next = applyKpTreeDiff(data, 1, tree, diff);
    expect(next.knowledgePoints).toEqual(data.knowledgePoints);
    expect(next.chapters).toEqual(data.chapters);
  });

  it("更新只动 name/content/章节/顺序：mastery、tags、blockId 等状态不变", () => {
    // 文件里把 kp1 的标签改成 [精通]、内容改掉 —— 掌握度绝不能变
    const md = buildKpTreeMarkdown(COURSE, CHAPTERS, KPS, [], [], { date: "2026-11-03" })
      .replace("- kp1 [了解] <!-- kp:1 -->", "- kp1 [精通] <!-- kp:1 -->")
      .replace("  第一段内容。\n\n  第二段内容。", "  新内容。");
    const tree = roundTrip(md);
    const diff = computeKpTreeDiff(tree, CHAPTERS, KPS);
    const data = makeData();
    const next = applyKpTreeDiff(data, 1, tree, diff);
    const k1 = next.knowledgePoints.find((k) => k.id === 1)!;
    expect(k1.mastery).toBe("known"); // 文件标签 [精通] 被忽略
    expect(k1.content).toBe("新内容。");
    expect(k1.blockId).toBeNull();
    expect(k1.sourceAssetIds).toBe("");
  });

  it("新增知识点：默认未学习、新 id、归入所在章节；新增章节创建成功", () => {
    const md = buildKpTreeMarkdown(COURSE, CHAPTERS, KPS, [], [], { date: "2026-11-03" }) +
      "\n# 第三章 新章\n- 新知识点\n  新内容\n";
    const tree = roundTrip(md);
    const diff = computeKpTreeDiff(tree, CHAPTERS, KPS);
    const next = applyKpTreeDiff(makeData(), 1, tree, diff);
    expect(next.chapters).toHaveLength(4);
    const newCh = next.chapters.find((c) => c.name === "第三章 新章")!;
    expect(newCh.level).toBe(1);
    expect(newCh.parentId).toBeNull();
    const newKp = next.knowledgePoints.find((k) => k.name === "新知识点")!;
    expect(newKp.id).toBeGreaterThan(4);
    expect(newKp.mastery).toBe("unlearn");
    expect(newKp.chapterId).toBe(newCh.id);
    expect(newKp.content).toBe("新内容");
    expect(newKp.chapterName).toBe("第三章 新章");
  });

  it("删除：条目与空章节移除；其他课程数据不受影响", () => {
    let md = buildKpTreeMarkdown(COURSE, CHAPTERS, KPS, [], [], { date: "2026-11-03" });
    md = md.replace("- kp3 [未学习] <!-- kp:3 -->\n", "");
    md = md.replace(/\n# 第二章 固定资产（0） <!-- ch:20 -->\n/, "\n");
    const tree = roundTrip(md);
    const diff = computeKpTreeDiff(tree, CHAPTERS, KPS);
    const data = makeData();
    // 另一课程的实体（不应被动）
    data.courses.push({ id: 2, siyuanDocId: null, name: "课程二", description: "", target: "", totalCycle: "", status: "active", createTime: "2026-01-01T00:00:00Z" });
    data.chapters.push(chapter(30, 1, null, 1, "课程二章"));
    data.knowledgePoints.push(kp(90, 30, "mastered", 1, "课程二kp"));
    const next = applyKpTreeDiff(data, 1, tree, diff);
    expect(next.knowledgePoints.find((k) => k.id === 3)).toBeUndefined();
    expect(next.chapters.find((c) => c.id === 20)).toBeUndefined();
    expect(next.knowledgePoints.find((k) => k.id === 90)).toBeDefined();
    expect(next.chapters.find((c) => c.id === 30)).toBeDefined();
  });

  it("章节改名：知识点 chapterName 同步刷新；未归章知识点 chapterName 置空", () => {
    const md = buildKpTreeMarkdown(COURSE, CHAPTERS, KPS, [], [], { date: "2026-11-03" })
      .replace("# 第一章 存货（2） <!-- ch:10 -->", "# 存货总论（2） <!-- ch:10 -->");
    const tree = roundTrip(md);
    const diff = computeKpTreeDiff(tree, CHAPTERS, KPS);
    const next = applyKpTreeDiff(makeData(), 1, tree, diff);
    expect(next.chapters.find((c) => c.id === 10)!.name).toBe("存货总论");
    expect(next.knowledgePoints.find((k) => k.id === 1)!.chapterName).toBe("存货总论");
    expect(next.knowledgePoints.find((k) => k.id === 2)!.chapterName).toBe("第一节 存货计价");
    expect(next.knowledgePoints.find((k) => k.id === 3)!.chapterName).toBe("");
  });
});
