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
});
