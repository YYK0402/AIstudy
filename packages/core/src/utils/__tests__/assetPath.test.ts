import { describe, expect, it } from "vitest";
import { isSafeAssetPath, isValidAssetPath } from "../assetPath";
import { setBridge } from "@/bridge";
import type { StudyBridge } from "@/bridge";

describe("isSafeAssetPath", () => {
  it("内核资源相对路径放行", () => {
    expect(isSafeAssetPath("/data/assets/20261031/abcdef12.png")).toBe(true);
    expect(isSafeAssetPath("/data/storage/petal/AIstudy/file.pdf")).toBe(true);
  });

  it("3.8.x 内核资产形态放行（upload 返回 assets/<名> 相对路径，HTTP /assets/... 提供）", () => {
    expect(isSafeAssetPath("assets/1.讲义-20261114004342-pkt6hj9.pdf")).toBe(true);
    expect(isSafeAssetPath("/assets/1.讲义-20261114004342-pkt6hj9.pdf")).toBe(true);
  });

  it("协议 URL / 路径穿越 / 非资源前缀拒绝", () => {
    expect(isSafeAssetPath("https://evil.com/a.png")).toBe(false);
    expect(isSafeAssetPath("javascript:alert(1)")).toBe(false);
    expect(isSafeAssetPath("//evil.com/a.png")).toBe(false);
    expect(isSafeAssetPath("/data/assets/../../../etc/passwd")).toBe(false);
    expect(isSafeAssetPath("assets/../../conf/xxx")).toBe(false);
    expect(isSafeAssetPath("/tmp/x.png")).toBe(false);
    expect(isSafeAssetPath("data/assets/relative.png")).toBe(false);
    expect(isSafeAssetPath("")).toBe(false);
  });
});

describe("isValidAssetPath（按宿主能力）", () => {
  it("无 bridge 时回退思源规则", () => {
    expect(isValidAssetPath("/data/assets/a.pdf")).toBe(true);
    expect(isValidAssetPath("assets/a.pdf")).toBe(true);
    expect(isValidAssetPath("api/assets/file?name=1-a.pdf")).toBe(false);
  });

  it("有 bridge 时使用宿主校验（飞牛资源 URL 放行）", () => {
    const bridge = {
      isValidAssetPath: (p: string) => p.startsWith("api/assets/file?name="),
    } as unknown as StudyBridge;
    setBridge(bridge);
    expect(isValidAssetPath("api/assets/file?name=1-a.pdf")).toBe(true);
    expect(isValidAssetPath("/data/assets/a.pdf")).toBe(false);
  });
});
