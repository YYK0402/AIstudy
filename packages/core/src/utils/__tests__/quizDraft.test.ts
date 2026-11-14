import { describe, expect, it } from "vitest";
import { isQuizAnswered, resolveAnswerText, type AnswerState } from "../quizDraft";

const emptyState: AnswerState = { single: null, multi: [], text: "", passage: {} };
const BLANKS = JSON.stringify([
  { no: 1, hint: "carry" },
  { no: 2, hint: "make" },
]);

function state(partial: Partial<AnswerState>): AnswerState {
  return { ...emptyState, ...partial };
}

describe("isQuizAnswered（按作答模式）", () => {
  it("单选式：未选=未答，已选=已答（single/judge/自定义单选同口径）", () => {
    expect(isQuizAnswered({ blanks: undefined }, emptyState, "single")).toBe(false);
    expect(isQuizAnswered({ blanks: undefined }, state({ single: "B" }), "single")).toBe(true);
  });

  it("多选式：空数组=未答", () => {
    expect(isQuizAnswered({ blanks: undefined }, emptyState, "multiple")).toBe(false);
    expect(isQuizAnswered({ blanks: undefined }, state({ multi: ["A", "C"] }), "multiple")).toBe(true);
  });

  it("简答式：按文本判断，空白不算答（essay/translation/自定义简答同口径）", () => {
    expect(isQuizAnswered({ blanks: undefined }, emptyState, "essay")).toBe(false);
    expect(isQuizAnswered({ blanks: undefined }, state({ text: "  " }), "essay")).toBe(false);
    expect(isQuizAnswered({ blanks: undefined }, state({ text: "答：…" }), "essay")).toBe(true);
  });

  it("文章式：所有空都填才算答", () => {
    const q = { blanks: BLANKS };
    expect(isQuizAnswered(q, emptyState, "passage")).toBe(false);
    expect(isQuizAnswered(q, state({ passage: { 1: "A" } }), "passage")).toBe(false);
    expect(isQuizAnswered(q, state({ passage: { 1: "  ", 2: "B" } }), "passage")).toBe(false);
    expect(isQuizAnswered(q, state({ passage: { 1: "A", 2: "B" } }), "passage")).toBe(true);
  });

  it("文章式：无空位/非法 blanks 时退回按文本判断", () => {
    expect(isQuizAnswered({ blanks: undefined }, state({ text: "ok" }), "passage")).toBe(true);
    expect(isQuizAnswered({ blanks: undefined }, emptyState, "passage")).toBe(false);
    expect(isQuizAnswered({ blanks: "{broken" }, emptyState, "passage")).toBe(false);
    expect(isQuizAnswered({ blanks: "{broken" }, state({ text: "ok" }), "passage")).toBe(true);
  });
});

describe("resolveAnswerText（按作答模式）", () => {
  it("单选式：原样返回所选选项；未选=空串", () => {
    expect(resolveAnswerText({ blanks: undefined }, state({ single: "B" }), "single")).toBe("B");
    expect(resolveAnswerText({ blanks: undefined }, emptyState, "single")).toBe("");
  });

  it("多选式：逗号连接", () => {
    expect(resolveAnswerText({ blanks: undefined }, state({ multi: ["A", "C"] }), "multiple")).toBe("A,C");
  });

  it("文章式：按空位编号升序拼 编号:值|…（去首尾空白）", () => {
    const q = { blanks: BLANKS };
    expect(
      resolveAnswerText(q, state({ passage: { 1: " carried ", 2: "makes" } }), "passage"),
    ).toBe("1:carried|2:makes");
  });

  it("简答式/文章式无空位：trim 后返回", () => {
    expect(resolveAnswerText({ blanks: undefined }, state({ text: "  答案  " }), "essay")).toBe("答案");
    expect(resolveAnswerText({ blanks: undefined }, state({ text: "shown" }), "passage")).toBe("shown");
  });
});
