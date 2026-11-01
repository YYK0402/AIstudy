import { describe, expect, it } from "vitest";
import { isSafeAssetPath } from "../assetPath";

describe("isSafeAssetPath", () => {
  it("内核资源相对路径放行", () => {
    expect(isSafeAssetPath("/data/assets/20261031/abcdef12.png")).toBe(true);
    expect(isSafeAssetPath("/data/storage/petal/AIstudy/file.pdf")).toBe(true);
  });

  it("协议 URL / 路径穿越 / 非资源前缀拒绝", () => {
    expect(isSafeAssetPath("https://evil.com/a.png")).toBe(false);
    expect(isSafeAssetPath("javascript:alert(1)")).toBe(false);
    expect(isSafeAssetPath("/data/assets/../../../etc/passwd")).toBe(false);
    expect(isSafeAssetPath("/tmp/x.png")).toBe(false);
    expect(isSafeAssetPath("data/assets/relative.png")).toBe(false);
    expect(isSafeAssetPath("")).toBe(false);
  });
});
