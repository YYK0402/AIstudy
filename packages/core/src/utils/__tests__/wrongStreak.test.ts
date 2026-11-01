import { describe, expect, it } from "vitest";
import type { WrongQuestion } from "../../types/appData";
import { recordWrongResult, WRONG_GRADUATE_STREAK } from "../wrongStreak";

const NOW = "2026-11-01T00:00:00.000Z";

function entry(overrides: Partial<WrongQuestion> = {}): WrongQuestion {
  return {
    id: 1,
    recordId: null,
    qId: 10,
    reviewTimes: 1,
    createTime: NOW,
    status: "active",
    correctStreak: 0,
    graduatedAt: null,
    ...overrides,
  };
}

describe("recordWrongResult", () => {
  it("wrong 不存在：新建 active/streak0/reviewTimes1", () => {
    const list: WrongQuestion[] = [];
    const w = recordWrongResult(list, 10, "wrong", NOW);
    expect(w).not.toBeNull();
    expect(w).toMatchObject({ qId: 10, status: "active", correctStreak: 0, reviewTimes: 1 });
    expect(list).toHaveLength(1);
  });

  it("wrong 已存在 active：重新激活并 reviewTimes++", () => {
    const list = [entry({ correctStreak: 1, reviewTimes: 3 })];
    const w = recordWrongResult(list, 10, "wrong", NOW);
    expect(w).toMatchObject({ status: "active", correctStreak: 0, reviewTimes: 4, graduatedAt: null });
  });

  it("wrong 已毕业：重新入册（回 active、清 graduatedAt）", () => {
    const list = [entry({ status: "graduated", correctStreak: WRONG_GRADUATE_STREAK, graduatedAt: NOW, reviewTimes: 5 })];
    const w = recordWrongResult(list, 10, "wrong", NOW);
    expect(w).toMatchObject({ status: "active", correctStreak: 0, reviewTimes: 6, graduatedAt: null });
  });

  it("wrong 新建 id 取最大值 +1", () => {
    const list = [entry({ qId: 99, id: 42 })];
    const w = recordWrongResult(list, 10, "wrong", NOW);
    expect(w?.id).toBe(43);
  });

  it("correct 不存在：忽略返回 null", () => {
    const list: WrongQuestion[] = [];
    expect(recordWrongResult(list, 10, "correct", NOW)).toBeNull();
    expect(list).toHaveLength(0);
  });

  it("correct 已毕业：忽略返回 null（不复活）", () => {
    const list = [entry({ status: "graduated", correctStreak: 2, graduatedAt: NOW })];
    const w = recordWrongResult(list, 10, "correct", NOW);
    expect(w).toBeNull();
    expect(list[0].status).toBe("graduated");
  });

  it("correct active 首次：streak+1 未达阈值保持 active", () => {
    const list = [entry()];
    const w = recordWrongResult(list, 10, "correct", NOW);
    expect(w).toMatchObject({ status: "active", correctStreak: 1, graduatedAt: null });
  });

  it("correct 连续达阈值：转 graduated 并记 graduatedAt", () => {
    const list = [entry({ correctStreak: WRONG_GRADUATE_STREAK - 1 })];
    const w = recordWrongResult(list, 10, "correct", NOW);
    expect(w).toMatchObject({ status: "graduated", correctStreak: WRONG_GRADUATE_STREAK, graduatedAt: NOW });
  });

  it("graduatedAt 使用本次 nowIso 而非旧值", () => {
    const old = "2026-10-01T00:00:00.000Z";
    const list = [entry({ correctStreak: WRONG_GRADUATE_STREAK - 1, graduatedAt: old })];
    const w = recordWrongResult(list, 10, "correct", NOW);
    expect(w?.graduatedAt).toBe(NOW);
  });
});
