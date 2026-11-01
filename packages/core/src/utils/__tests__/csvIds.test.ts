import { describe, expect, it } from "vitest";
import { removeCsvIds } from "../csvIds";

describe("removeCsvIds", () => {
  it("移除命中的 id，保留其余", () => {
    expect(removeCsvIds("1,2,3", new Set([2]))).toBe("1,3");
    expect(removeCsvIds("1,2,3", new Set([1, 3]))).toBe("2");
    expect(removeCsvIds("1", new Set([1]))).toBe("");
  });

  it("容忍空白与空段", () => {
    expect(removeCsvIds(" 1 , 2 ,, 3 ", new Set([2]))).toBe("1,3");
    expect(removeCsvIds("", new Set([1]))).toBe("");
    expect(removeCsvIds(",,", new Set([1]))).toBe("");
  });

  it("非数字段原样保留（不参与命中）", () => {
    expect(removeCsvIds("1,abc,2", new Set([1, 2]))).toBe("abc");
  });

  it("无命中时按 trim 后紧凑返回", () => {
    expect(removeCsvIds(" 5 , 6 ", new Set([1]))).toBe("5,6");
  });
});
