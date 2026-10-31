import { describe, expect, it } from "vitest";
import { masteryChangeText, nextMastery } from "../mastery";

describe("nextMastery", () => {
  it("升一档 / 降一档", () => {
    expect(nextMastery("unlearn", 1)).toBe("known");
    expect(nextMastery("known", -1)).toBe("unlearn");
  });

  it("两端钳制：不越界且无变化返回 null", () => {
    expect(nextMastery("proficient", 1)).toBeNull();
    expect(nextMastery("unlearn", -1)).toBeNull();
  });

  it("跨级升档", () => {
    expect(nextMastery("known", 2)).toBe("proficient");
  });
});

describe("masteryChangeText", () => {
  it("有变化生成「前 → 后」说明", () => {
    expect(masteryChangeText("known", "mastered")).toBe("了解 → 掌握");
  });

  it("无变化返回 null", () => {
    expect(masteryChangeText("known", null)).toBeNull();
    expect(masteryChangeText("known", "known")).toBeNull();
  });
});
