import { describe, expect, it } from "vitest";
import { isDuplicateKpName, normalizeChapterRef } from "../kpMatch";

describe("normalizeChapterRef 纯编号名守卫", () => {
  it("剥离编号前缀", () => {
    expect(normalizeChapterRef("第5章 项目成本管理")).toBe("项目成本管理");
    expect(normalizeChapterRef("1.1 成本估算")).toBe("成本估算");
  });
  it("纯编号名剥空后保留原归一化串（1.1 与 1.2 不视为同名）", () => {
    expect(normalizeChapterRef("1.1")).not.toBe(normalizeChapterRef("1.2"));
    expect(normalizeChapterRef("第一章")).not.toBe(normalizeChapterRef("第二章"));
  });
});

describe("isDuplicateKpName 包含判定长度比（M3）", () => {
  it("归一化相等 → 重复", () => {
    expect(isDuplicateKpName("挣值法", "挣值法 ")).toBe(true);
  });
  it("短名占比足够（挣值法 ⊂ 挣值法分析，0.6）→ 重复", () => {
    expect(isDuplicateKpName("挣值法", "挣值法分析")).toBe(true);
  });
  it("短名占比不足（成本 ⊂ 项目成本管理，0.33）→ 不重复（防短 KP 被吞）", () => {
    expect(isDuplicateKpName("成本", "项目成本管理")).toBe(false);
  });
  it("单字名不判包含重复", () => {
    expect(isDuplicateKpName("费", "费用管理")).toBe(false);
  });
  it("无关名称 → 不重复", () => {
    expect(isDuplicateKpName("范围管理", "进度管理")).toBe(false);
  });
});
