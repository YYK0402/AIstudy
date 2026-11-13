import { describe, expect, it } from "vitest";
import { isSameDocumentAnchor, shouldBlockSpecialClick } from "../anchorNav";

const left = { button: 0, metaKey: false, ctrlKey: false };
const middle = { button: 1, metaKey: false, ctrlKey: false };
const metaLeft = { button: 0, metaKey: true, ctrlKey: false };
const ctrlLeft = { button: 0, metaKey: false, ctrlKey: true };

describe("isSameDocumentAnchor", () => {
  it("hash 路由 / 相对路径为当前文档", () => {
    expect(isSameDocumentAnchor("#/content")).toBe(true);
    expect(isSameDocumentAnchor("#")).toBe(true);
    expect(isSameDocumentAnchor("/stage/build/desktop/?r=x#/content")).toBe(true);
  });
  it("带协议的为外部", () => {
    expect(isSameDocumentAnchor("https://example.com")).toBe(false);
    expect(isSameDocumentAnchor("mailto:a@b.com")).toBe(false);
    expect(isSameDocumentAnchor("siyuan://x")).toBe(false);
  });
});

describe("shouldBlockSpecialClick", () => {
  it("普通左键不拦截", () => {
    expect(shouldBlockSpecialClick("#/content", left)).toBe(false);
  });
  it("中键 / Cmd+点击 / Ctrl+点击 应用内链接拦截", () => {
    expect(shouldBlockSpecialClick("#/content", middle)).toBe(true);
    expect(shouldBlockSpecialClick("#/content", metaLeft)).toBe(true);
    expect(shouldBlockSpecialClick("#/content", ctrlLeft)).toBe(true);
    expect(shouldBlockSpecialClick("/x#/content", middle)).toBe(true);
  });
  it("外部链接不拦截（保留浏览器默认行为）", () => {
    expect(shouldBlockSpecialClick("https://example.com", middle)).toBe(false);
    expect(shouldBlockSpecialClick("mailto:a@b.com", metaLeft)).toBe(false);
  });
});
