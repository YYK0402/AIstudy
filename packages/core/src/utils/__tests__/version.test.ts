import { describe, it, expect } from "vitest";
import { compareVersions, isNewerVersion } from "../version";

describe("compareVersions", () => {
  it("同 major.minor，patch 更大为 1", () => {
    expect(compareVersions("0.3.1", "0.3.0")).toBe(1);
  });

  it("相等返回 0", () => {
    expect(compareVersions("0.3.0", "0.3.0")).toBe(0);
  });

  it("更小返回 -1", () => {
    expect(compareVersions("0.3.0", "0.3.1")).toBe(-1);
  });

  it("按数值比较而非字典序（0.10 > 0.9）", () => {
    expect(compareVersions("0.10.0", "0.9.0")).toBe(1);
    expect(compareVersions("0.9.0", "0.10.0")).toBe(-1);
  });

  it("major 优先", () => {
    expect(compareVersions("1.0.0", "0.9.9")).toBe(1);
  });

  it("缺位段按 0 补齐", () => {
    expect(compareVersions("0.3", "0.3.0")).toBe(0);
    expect(compareVersions("0.3.1", "0.3")).toBe(1);
  });
});

describe("isNewerVersion", () => {
  it("current 高于 seen 为 true", () => {
    expect(isNewerVersion("0.3.1", "0.3.0")).toBe(true);
  });

  it("相等或更低为 false", () => {
    expect(isNewerVersion("0.3.0", "0.3.0")).toBe(false);
    expect(isNewerVersion("0.3.0", "0.3.1")).toBe(false);
  });

  it("数值比较（0.10.0 > 0.9.0）", () => {
    expect(isNewerVersion("0.10.0", "0.9.0")).toBe(true);
  });
});
