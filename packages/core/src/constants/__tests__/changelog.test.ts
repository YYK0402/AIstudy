import { describe, it, expect } from "vitest";
import { CHANGELOG, changelogSince, type ChangelogEntry } from "../changelog";

const sample: ChangelogEntry[] = [
  { version: "0.3.1", date: "2026-10-30", items: [{ text: "a" }] },
  { version: "0.3.0", date: "2026-10-30", items: [{ text: "b" }] },
  { version: "0.2.0", date: "2026-10-28", items: [{ text: "c" }] },
];

describe("changelogSince", () => {
  it("返回高于 seen 的版本，保持新到旧顺序", () => {
    const got = changelogSince(sample, "0.3.0");
    expect(got.map((e) => e.version)).toEqual(["0.3.1"]);
  });

  it("seen 较早时返回多个", () => {
    expect(changelogSince(sample, "0.2.0").map((e) => e.version)).toEqual(["0.3.1", "0.3.0"]);
  });

  it("seen 为 null/空返回全部", () => {
    expect(changelogSince(sample, null).map((e) => e.version)).toEqual(["0.3.1", "0.3.0", "0.2.0"]);
    expect(changelogSince(sample, "").map((e) => e.version)).toEqual(["0.3.1", "0.3.0", "0.2.0"]);
  });

  it("seen 已是最新返回空", () => {
    expect(changelogSince(sample, "0.3.1")).toEqual([]);
  });

  it("seen 高于全部返回空", () => {
    expect(changelogSince(sample, "9.9.9")).toEqual([]);
  });
});

describe("CHANGELOG 数据形状", () => {
  it("非空且最新在前（0.4.2）", () => {
    expect(CHANGELOG.length).toBeGreaterThan(0);
    expect(CHANGELOG[0].version).toBe("0.4.2");
  });

  it("每条都有非空 version/date 与 items", () => {
    for (const e of CHANGELOG) {
      expect(e.version.length).toBeGreaterThan(0);
      expect(e.date.length).toBeGreaterThan(0);
      expect(Array.isArray(e.items)).toBe(true);
      expect(e.items.length).toBeGreaterThan(0);
      for (const it of e.items) expect(it.text.length).toBeGreaterThan(0);
    }
  });

  it("版本严格新到旧", () => {
    for (let i = 1; i < CHANGELOG.length; i++) {
      expect(changelogSince(CHANGELOG, CHANGELOG[i].version).some((e) => e.version === CHANGELOG[i - 1].version)).toBe(true);
    }
  });
});
