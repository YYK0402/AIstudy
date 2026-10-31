import { describe, expect, it } from "vitest";
import { aggregatePdfRows, sortSlideNames } from "../documentParser";

describe("sortSlideNames（U3：pptx 页码数值排序）", () => {
  it("slide10 排在 slide2 之后（数值序而非字典序）", () => {
    expect(sortSlideNames(["ppt/slides/slide10.xml", "ppt/slides/slide2.xml", "ppt/slides/slide1.xml"])).toEqual([
      "ppt/slides/slide1.xml",
      "ppt/slides/slide2.xml",
      "ppt/slides/slide10.xml",
    ]);
  });

  it("过滤非 slides 下的同名文件", () => {
    expect(sortSlideNames(["ppt/notesSlides/notesSlide1.xml", "ppt/slides/slide3.xml", "ppt/slides/slide1.xml"])).toEqual([
      "ppt/slides/slide1.xml",
      "ppt/slides/slide3.xml",
    ]);
  });
});

describe("aggregatePdfRows（y/3 桶化行聚合）", () => {
  function p2(x: number, y: number, str: string) {
    return { x, str, height: 12, width: 10, y };
  }

  it("|Δy|<3 合并，行 y 取首个片段，保持插入序", () => {
    const rows = aggregatePdfRows([p2(0, 100, "a"), p2(12, 102.5, "b"), p2(0, 200, "c")]);
    expect(rows.map((r) => r.y)).toEqual([100, 200]);
    expect(rows[0].parts.map((p) => p.str)).toEqual(["a", "b"]);
  });

  it("|Δy|=3 不合并（与原 find 语义一致）", () => {
    const rows = aggregatePdfRows([p2(0, 100, "a"), p2(0, 103, "b")]);
    expect(rows.length).toBe(2);
  });

  it("跨桶匹配：后建行的 y 与更早 item 在相邻桶内仍可命中", () => {
    // row1.y=10（桶3），row2.y=15.5（桶5）；y=13 的 item 应与 row2 合并（|13-15.5|<3，跨桶 4→5 相邻）
    const rows = aggregatePdfRows([p2(0, 10, "a"), p2(0, 15.5, "b"), p2(0, 13, "c")]);
    expect(rows.map((r) => r.parts.map((p) => p.str))).toEqual([["a"], ["b", "c"]]);
  });

  it("与朴素全扫实现结果一致（随机对照）", () => {
    const rnd = (n: number) => Math.floor(Math.random() * n);
    const parts = Array.from({ length: 500 }, (_, i) => p2(rnd(400), 70 + rnd(600), `t${i}`));
    const naive: Array<{ y: number; parts: typeof parts }> = [];
    for (const p of parts) {
      const row = naive.find((r) => Math.abs(r.y - p.y) < 3);
      if (!row) naive.push({ y: p.y, parts: [p] });
      else row.parts.push(p);
    }
    const fast = aggregatePdfRows(parts);
    expect(fast.map((r) => r.y)).toEqual(naive.map((r) => r.y));
    expect(fast.map((r) => r.parts.map((p) => p.str))).toEqual(naive.map((r) => r.parts.map((p) => p.str)));
  });
});
