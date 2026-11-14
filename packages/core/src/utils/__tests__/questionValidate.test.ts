import { describe, expect, it } from "vitest";
import { validateQuestionAnswer } from "../questionValidate";

describe("validateQuestionAnswer - single 式", () => {
  const opts = ["A. 资金现值", "B. 资金增值", "C. 折现", "D. 风险报酬"];
  it("字母答案命中选项前缀", () => {
    const r = validateQuestionAnswer("single", "single", opts, "B");
    expect(r).toEqual({ ok: true, answer: "B. 资金增值" });
  });
  it("文本答案精确命中", () => {
    const r = validateQuestionAnswer("single", "single", ["巴黎", "伦敦"], "伦敦");
    expect(r).toEqual({ ok: true, answer: "伦敦" });
  });
  it("字母无选项可匹配 → 拒绝", () => {
    expect(validateQuestionAnswer("single", "single", ["巴黎", "伦敦"], "D").ok).toBe(false);
  });
  it("无选项 → 拒绝", () => {
    expect(validateQuestionAnswer("single", "single", [], "A").ok).toBe(false);
  });
  it("字母按序号回退（选项无前缀字母）", () => {
    const r = validateQuestionAnswer("single", "single", ["巴黎", "伦敦", "柏林"], "C");
    expect(r).toEqual({ ok: true, answer: "柏林" });
  });
  it("自定义单选（课程题型）同口径校验", () => {
    const r = validateQuestionAnswer("阅读理解", "single", opts, "C");
    expect(r).toEqual({ ok: true, answer: "C. 折现" });
    expect(validateQuestionAnswer("阅读理解", "single", opts, "不存在的").ok).toBe(false);
  });
});

describe("validateQuestionAnswer - multiple 式", () => {
  const opts = ["A. 存款准备金率", "B. 公开市场操作", "C. 再贴现率", "D. 税收政策"];
  it("逗号字母答案", () => {
    const r = validateQuestionAnswer("multiple", "multiple", opts, "A,B");
    expect(r).toEqual({ ok: true, answer: "A. 存款准备金率,B. 公开市场操作" });
  });
  it("连续字母答案拆分", () => {
    const r = validateQuestionAnswer("multiple", "multiple", opts, "ABC");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.answer.split(",").length).toBe(3);
  });
  it("答案元素不在选项 → 拒绝", () => {
    expect(validateQuestionAnswer("multiple", "multiple", opts, "A,E").ok).toBe(false);
  });
  it("重复选项 → 拒绝", () => {
    expect(validateQuestionAnswer("multiple", "multiple", opts, "A,A").ok).toBe(false);
  });
  it("空答案 → 拒绝", () => {
    expect(validateQuestionAnswer("multiple", "multiple", opts, "  ").ok).toBe(false);
  });
  it("自定义多选（课程题型）同口径校验", () => {
    const r = validateQuestionAnswer("搭配题", "multiple", opts, "AB");
    expect(r.ok).toBe(true);
  });
});

describe("validateQuestionAnswer - judge", () => {
  it("「错误」归一化为选项文本", () => {
    expect(validateQuestionAnswer("judge", "single", ["正确", "错误"], "错误")).toEqual({ ok: true, answer: "错误" });
  });
  it("√/× 识别", () => {
    expect(validateQuestionAnswer("judge", "single", ["对", "错"], "×")).toEqual({ ok: true, answer: "错" });
  });
  it("选项含 √/× 时归一到同义选项", () => {
    expect(validateQuestionAnswer("judge", "single", ["√", "×"], "正确")).toEqual({ ok: true, answer: "√" });
  });
  it("无法识别 → 拒绝", () => {
    expect(validateQuestionAnswer("judge", "single", ["正确", "错误"], "差不多").ok).toBe(false);
  });
  it("无选项时按对/错归一", () => {
    expect(validateQuestionAnswer("judge", "single", [], "true")).toEqual({ ok: true, answer: "对" });
  });
});

describe("validateQuestionAnswer - 自由题型", () => {
  it("essay/translation/cloze/自定义简答 不校验", () => {
    expect(validateQuestionAnswer("essay", "essay", [], "自由作答")).toEqual({ ok: true, answer: "自由作答" });
    expect(validateQuestionAnswer("cloze", "passage", [], "投资")).toEqual({ ok: true, answer: "投资" });
    expect(validateQuestionAnswer("translation", "essay", [], "any")).toEqual({ ok: true, answer: "any" });
    expect(validateQuestionAnswer("写作", "essay", [], "要点…")).toEqual({ ok: true, answer: "要点…" });
  });
});
