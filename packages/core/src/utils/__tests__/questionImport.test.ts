import { describe, expect, it } from "vitest";
import { IMPORT_SAMPLE, detectImportMode, parseQuestionsMarkdown } from "../questionImport";
import type { KnowledgePoint } from "../../api";

const kps = [{ id: 11, name: "货币时间价值" }] as KnowledgePoint[];

const RAW_PAPER = `# 2024年考研政治真题
一、单选题（每题 2 分，共 10 分）
1. 下列对货币时间价值理解正确的是？
A. 资金的现值
B. 资金随时间推移产生的增值
C. 未来资金的折现
D. 风险报酬

二、多选题（每题 3 分，共 9 分）
2. 下列属于货币政策工具的有？
A. 存款准备金率
B. 公开市场操作
C. 再贴现率
D. 税收政策

三、简答题（每题 5 分，共 10 分）
3. 简述货币时间价值的含义。

【参考答案】
1. B
2. A B C
3. 资金在投资过程中随时间推移产生的增值。`;

describe("parseQuestionsMarkdown", () => {
  it("解析内置示例单选题", () => {
    const { drafts, errors } = parseQuestionsMarkdown(IMPORT_SAMPLE, []);
    expect(errors).toHaveLength(0);
    expect(drafts.length).toBeGreaterThanOrEqual(1);
    expect(drafts[0].qType).toBe("single");
    expect(drafts[0].title).toContain("货币时间价值");
    expect(drafts[0].answer).toBe("资金随时间推移产生的增值");
  });

  it("多选题答案按选项文本拼接", () => {
    const text = "多选题\nA. 甲\nB. 乙\nC. 丙\n答案: A,B";
    const { drafts } = parseQuestionsMarkdown(text, []);
    expect(drafts[0].qType).toBe("multiple");
    expect(drafts[0].answer).toBe("甲,乙");
  });

  it("判断题识别两选项", () => {
    const text = "判断题\nA. 正确\nB. 错误\n答案: 正确";
    const { drafts } = parseQuestionsMarkdown(text, []);
    expect(drafts[0].qType).toBe("judge");
    expect(drafts[0].answer).toBe("正确");
  });

  it("简答题使用参考答案", () => {
    const text = "简述货币时间价值。\n答案: 资金随时间增值";
    const { drafts } = parseQuestionsMarkdown(text, []);
    expect(drafts[0].qType).toBe("essay");
    expect(drafts[0].answer).toBe("资金随时间增值");
  });

  it("知识点按名称匹配", () => {
    const text = "题目\nA. 甲\nB. 乙\n答案: A\n知识点: 货币时间价值, 不存在";
    const { drafts } = parseQuestionsMarkdown(text, kps);
    expect(drafts[0].kpIds).toEqual([11]);
    expect(drafts[0].unmatchedKpNames).toEqual(["不存在"]);
  });

  it("缺答案或多选答案越界时返回错误", () => {
    const { drafts, errors } = parseQuestionsMarkdown("题目\nA. 甲\nB. 乙", []);
    expect(drafts).toHaveLength(0);
    expect(errors[0].reason).toContain("答案");
  });

  it("单选题答案字母超出选项范围时报错", () => {
    const { errors } = parseQuestionsMarkdown("题目\nA. 甲\nB. 乙\n答案: D", []);
    expect(errors[0].reason).toContain("超出选项范围");
  });

  it("多选题连续字母答案「AB」按字母展开（U1）", () => {
    const { drafts, errors } = parseQuestionsMarkdown("多选题\nA. 甲\nB. 乙\nC. 丙\nD. 丁\n答案: AB", []);
    expect(errors).toHaveLength(0);
    expect(drafts[0].qType).toBe("multiple");
    expect(drafts[0].answer).toBe("甲,乙");
  });

  it("显式题型多选 + 连续字母「ABC」", () => {
    const { drafts } = parseQuestionsMarkdown("多选题\n题型: 多选\nA. 甲\nB. 乙\nC. 丙\nD. 丁\n答案: ABC", []);
    expect(drafts[0].qType).toBe("multiple");
    expect(drafts[0].answer).toBe("甲,乙,丙");
  });

  it("单字母单选题答案不受展开影响", () => {
    const { drafts } = parseQuestionsMarkdown("题目\nA. 甲\nB. 乙\n答案: B", []);
    expect(drafts[0].qType).toBe("single");
    expect(drafts[0].answer).toBe("乙");
  });

  it("块内重复「答案:」行产生 warning 且取最后一行（U2）", () => {
    const r = parseQuestionsMarkdown("题目\nA. 甲\nB. 乙\n答案: A\n答案: B", []);
    expect(r.drafts[0].answer).toBe("乙");
    expect(r.warnings.some((w) => w.reason.includes("重复"))).toBe(true);
  });

  it("词形填空（__ (word) 标记）导入为 fill 并解析 blanks", () => {
    const { drafts, errors } = parseQuestionsMarkdown(
      "needs __ (require) no perfection.\n答案: requires\n题型: 词形填空",
      [],
    );
    expect(errors).toHaveLength(0);
    expect(drafts[0].qType).toBe("fill");
    expect(JSON.parse(drafts[0].blanks!)).toEqual([{ no: 1, hint: "require" }]);
    expect(drafts[0].answer).toBe("requires");
  });

  it("选择填空（编号空 + 选项行）导入为 banked", () => {
    const { drafts, errors } = parseQuestionsMarkdown(
      "He __41__ a student.\nA. is\nB. are\nC. was\n答案: 41:is\n题型: 选择填空",
      [],
    );
    expect(errors).toHaveLength(0);
    expect(drafts[0].qType).toBe("banked");
    expect(drafts[0].options).toEqual(["is", "are", "was"]);
    expect(JSON.parse(drafts[0].blanks!)).toEqual([{ no: 41 }]);
  });

  it("完形填空导入为 cloze 且空位标记必填", () => {
    const ok = parseQuestionsMarkdown("It __41__ sunny.\n答案: 41:is\n题型: 完形", []);
    expect(ok.errors).toHaveLength(0);
    expect(ok.drafts[0].qType).toBe("cloze");
    const bad = parseQuestionsMarkdown("没有空位的题干\n答案: 41:is\n题型: 完形", []);
    expect(bad.drafts).toHaveLength(0);
    expect(bad.errors[0].reason).toContain("空位标记");
  });

  it("CRLF 换行与 LF 解析结果一致", () => {
    const lf = "题干C\nA. 甲\nB. 乙\n答案: A";
    const crlf = lf.replace(/\n/g, "\r\n");
    const a = parseQuestionsMarkdown(lf, []);
    const b = parseQuestionsMarkdown(crlf, []);
    expect(b.errors).toHaveLength(0);
    expect(b.drafts[0].title).toBe(a.drafts[0].title);
    expect(b.drafts[0].options).toEqual(a.drafts[0].options);
    expect(b.drafts[0].answer).toBe(a.drafts[0].answer);
  });

  it("第 9 选项（I.）不在 A-H 支持范围：不当选项，落入题干", () => {
    const { drafts, errors } = parseQuestionsMarkdown("题干九\nA. 甲\nB. 乙\nI. 第九项\n答案: A", []);
    expect(errors).toHaveLength(0);
    expect(drafts[0].options).toEqual(["甲", "乙"]);
    expect(drafts[0].title).toContain("第九项");
  });

  it("带「- 」前缀的选项行不识别为选项（选项正则无列表前缀分支），落入题干", () => {
    const { drafts, errors } = parseQuestionsMarkdown("题干X\n- A. 甲\n- B. 乙\n答案: A", []);
    expect(errors).toHaveLength(0);
    expect(drafts[0].options).toEqual([]);
    expect(drafts[0].qType).toBe("essay");
  });

  it("首行 markdown 标题提取为 paperName，并从标题提取年份", () => {
    const { paperName, paperYear } = parseQuestionsMarkdown("# 2024考研政治真题\n1. 题干\nA. 甲\nB. 乙\n答案: A", []);
    expect(paperName).toBe("2024考研政治真题");
    expect(paperYear).toBe(2024);
  });
});

describe("parseQuestionsMarkdown - 整卷智能切题", () => {
  it("detectImportMode 分流判定", () => {
    expect(detectImportMode(IMPORT_SAMPLE)).toBe("structured");
    expect(detectImportMode("题干\nA. 甲\nB. 乙\n答案: A")).toBe("structured");
    expect(detectImportMode("1. 题干\nA. 甲\nB. 乙\n答案: A\n知识点: 货币时间价值")).toBe("structured");
    expect(detectImportMode(RAW_PAPER)).toBe("segmented");
    expect(
      detectImportMode("1. 甲？\nA. 一\nB. 二\n答案: B\n2. 乙？\nA. 三\nB. 四\n答案: C"),
    ).toBe("segmented");
  });

  it("原始整卷（文末答案区）切题并缝合，答案转选项文本", () => {
    const r = parseQuestionsMarkdown(RAW_PAPER, []);
    expect(r.mode).toBe("segmented");
    expect(r.errors).toHaveLength(0);
    expect(r.drafts).toHaveLength(3);
    expect(r.drafts[0].qType).toBe("single");
    expect(r.drafts[0].answer).toBe("资金随时间推移产生的增值");
    expect(r.drafts[1].qType).toBe("multiple");
    expect(r.drafts[1].answer).toBe("存款准备金率,公开市场操作,再贴现率");
    expect(r.drafts[2].qType).toBe("essay");
    expect(r.drafts[2].answer).toBe("资金在投资过程中随时间推移产生的增值。");
    expect(r.paperName).toBe("2024年考研政治真题");
    expect(r.paperYear).toBe(2024);
  });

  it("每题内联答案（P2）两题均切出", () => {
    const text = "1. 甲？\nA. 一\nB. 二\n答案: B\n2. 乙？\nA. 三\nB. 四\nC. 五\nD. 六\n答案: C";
    const r = parseQuestionsMarkdown(text, []);
    expect(r.mode).toBe("segmented");
    expect(r.errors).toHaveLength(0);
    expect(r.drafts).toHaveLength(2);
    expect(r.drafts[0].answer).toBe("二");
    expect(r.drafts[1].answer).toBe("五");
  });

  it("答案区缺某题答案 → 该题报错，其余题正常", () => {
    const text = "1. 甲？\nA. 一\nB. 二\n2. 乙？\nA. 三\nB. 四\n【参考答案】\n1. A";
    const r = parseQuestionsMarkdown(text, []);
    expect(r.drafts).toHaveLength(1);
    expect(r.drafts[0].answer).toBe("一");
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].reason).toContain("答案");
  });

  it("未编号单题粘贴回落结构化路径（行为不变）", () => {
    const { drafts, errors } = parseQuestionsMarkdown("题目\nA. 甲\nB. 乙", []);
    expect(drafts).toHaveLength(0);
    expect(errors[0].reason).toContain("答案");
  });
});
