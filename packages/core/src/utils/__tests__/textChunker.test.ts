import { describe, expect, it } from "vitest";
import { chunkText } from "../textChunker";

describe("chunkText", () => {
  it("常规按行分块", () => {
    const chunks = chunkText("a\nb\nc", 5);
    expect(chunks.join("|")).toContain("a");
  });

  it("单行超 maxChars 时行内硬切，不产生超长块（U5）", () => {
    const line = "x".repeat(31000);
    const chunks = chunkText(line, 100);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(100);
    // 内容不丢
    expect(chunks.join("\n").replace(/\n/g, "")).toBe(line);
  });

  it("长短行混合：长行硬切且前后短行保留", () => {
    const long = "y".repeat(250);
    const chunks = chunkText(`head\n${long}\ntail`, 100);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(100);
    expect(chunks[0]).toContain("head");
    expect(chunks[chunks.length - 1]).toContain("tail");
    expect(chunks.join("\n").replace(/\n/g, "")).toBe(`head${long}tail`);
  });
});
