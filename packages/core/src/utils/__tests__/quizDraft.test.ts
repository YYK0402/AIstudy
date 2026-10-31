import { describe, expect, it } from "vitest";
import { isQuizAnswered, resolveAnswerText, type AnswerState } from "../quizDraft";
import type { QuestionType } from "../../api/constants";

const emptyState: AnswerState = { single: null, multi: [], text: "", passage: {} };
const BLANKS = JSON.stringify([
  { no: 1, hint: "carry" },
  { no: 2, hint: "make" },
]);

function state(partial: Partial<AnswerState>): AnswerState {
  return { ...emptyState, ...partial };
}

describe("isQuizAnswered", () => {
  it("单选/判断：未选=未答，已选=已答", () => {
    expect(isQuizAnswered({ qType: "single", blanks: undefined }, emptyState)).toBe(false);
    expect(isQuizAnswered({ qType: "single", blanks: undefined }, state({ single: "B" }))).toBe(true);
    expect(isQuizAnswered({ qType: "judge", blanks: undefined }, state({ single: "√" }))).toBe(true);
  });

  it("多选：空数组=未答", () => {
    expect(isQuizAnswered({ qType: "multiple", blanks: undefined }, emptyState)).toBe(false);
    expect(isQuizAnswered({ qType: "multiple", blanks: undefined }, state({ multi: ["A", "C"] }))).toBe(true);
  });

  it("简答/翻译/填空(无空位)：按文本判断，空白不算答", () => {
    for (const t of ["essay", "translation"] as QuestionType[]) {
      expect(isQuizAnswered({ qType: t, blanks: undefined }, emptyState)).toBe(false);
      expect(isQuizAnswered({ qType: t, blanks: undefined }, state({ text: "  " }))).toBe(false);
      expect(isQuizAnswered({ qType: t, blanks: undefined }, state({ text: "答：…" }))).toBe(true);
    }
    expect(isQuizAnswered({ qType: "fill", blanks: undefined }, state({ text: "carried" }))).toBe(true);
    expect(isQuizAnswered({ qType: "fill", blanks: undefined }, emptyState)).toBe(false);
  });

  it("文章题：所有空都填才算答", () => {
    const q = { qType: "cloze" as QuestionType, blanks: BLANKS };
    expect(isQuizAnswered(q, emptyState)).toBe(false);
    expect(isQuizAnswered(q, state({ passage: { 1: "A" } }))).toBe(false);
    expect(isQuizAnswered(q, state({ passage: { 1: "  ", 2: "B" } }))).toBe(false);
    expect(isQuizAnswered(q, state({ passage: { 1: "A", 2: "B" } }))).toBe(true);
  });

  it("文章题：blanks 非法 JSON 时退回按文本判断", () => {
    const q = { qType: "fill" as QuestionType, blanks: "{broken" };
    expect(isQuizAnswered(q, emptyState)).toBe(false);
    expect(isQuizAnswered(q, state({ text: "ok" }))).toBe(true);
  });
});

describe("resolveAnswerText", () => {
  it("单选/判断：原样返回所选选项；未选=空串", () => {
    expect(resolveAnswerText({ qType: "single", blanks: undefined }, state({ single: "B" }))).toBe("B");
    expect(resolveAnswerText({ qType: "judge", blanks: undefined }, emptyState)).toBe("");
  });

  it("多选：逗号连接", () => {
    expect(resolveAnswerText({ qType: "multiple", blanks: undefined }, state({ multi: ["A", "C"] }))).toBe("A,C");
  });

  it("文章题：按空位编号升序拼 编号:值|…（去首尾空白）", () => {
    const q = { qType: "fill", blanks: BLANKS };
    expect(
      resolveAnswerText(q, state({ passage: { 1: " carried ", 2: "makes" } })),
    ).toBe("1:carried|2:makes");
  });

  it("简答/翻译/无空位填空：trim 后返回", () => {
    expect(resolveAnswerText({ qType: "essay", blanks: undefined }, state({ text: "  答案  " }))).toBe("答案");
    expect(resolveAnswerText({ qType: "fill", blanks: undefined }, state({ text: "shown" }))).toBe("shown");
  });
});
