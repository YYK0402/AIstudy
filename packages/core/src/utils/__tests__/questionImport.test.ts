import { describe, expect, it } from "vitest";
import { IMPORT_SAMPLE, parseQuestionsMarkdown } from "../questionImport";
import type { KnowledgePoint } from "../../api";

const kps = [{ id: 11, name: "货币时间价值" }] as KnowledgePoint[];

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
