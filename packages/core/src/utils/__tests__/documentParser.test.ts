import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { aggregatePdfRows, pdfContentMargin, parseDocument, sortSlideNames } from "../documentParser";

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

import { extractHeadingsFromMarkdown } from "../documentParser";

describe("extractHeadingsFromMarkdown 编号标题识别（M1 放宽）", () => {
  const levels = (md: string) => extractHeadingsFromMarkdown(md).map((h) => `${h.level}:${h.text}`);

  it("「5.3项目成本估算」（编号后直接跟中文）→ 节标题", () => {
    expect(levels("5.3项目成本估算\n正文内容")).toEqual(["2:5.3项目成本估算"]);
  });
  it("「一、项目背景」（顿号后无空格）→ 子标题", () => {
    expect(levels("一、项目背景\n正文内容")).toEqual(["3:一、项目背景"]);
  });
  it("「3.14倍是圆周率的近似值。」（句末标点）→ 正文，不识别", () => {
    expect(levels("3.14倍是圆周率的近似值。\n下一句")).toEqual([]);
  });
  it("回归：「5.3 项目成本估算」（编号后带空格）仍识别", () => {
    expect(levels("5.3 项目成本估算\n正文")).toEqual(["2:5.3 项目成本估算"]);
  });
  it("回归：「一、 项目背景」（顿号后带空格）仍识别", () => {
    expect(levels("一、 项目背景\n正文")).toEqual(["3:一、 项目背景"]);
  });
  it("回归：「第5章 项目成本管理」→ 章", () => {
    expect(levels("第5章 项目成本管理\n正文")).toEqual(["1:第5章 项目成本管理"]);
  });
  it("超长编号行（>40 字）→ 不识别（正文）", () => {
    expect(levels("5.3 " + "长".repeat(40))).toEqual([]);
  });
});


describe("pdfContentMargin 相对页边距（L2）", () => {
  it("页高 8%，最小 40pt", () => {
    expect(pdfContentMargin(842)).toBe(67); // A4
    expect(pdfContentMargin(792)).toBe(63); // Letter
    expect(pdfContentMargin(100)).toBe(40); // 小页面取下限
  });
});

describe("parseDocument pptx 标题处理（L4）", () => {
  async function pptxFile(slideXml: string): Promise<File> {
    const zip = new JSZip();
    zip.file("ppt/slides/slide1.xml", slideXml);
    const buf = await zip.generateAsync({ type: "arraybuffer" });
    return new File([buf], "deck.pptx");
  }
  const sp = (ph: string, paras: string[]) =>
    `<p:sp><p:nvSpPr><p:ph type="${ph}"/></p:nvSpPr><p:txBody>${paras
      .map((t) => `<a:p><a:t>${t}</a:t></a:p>`)
      .join("")}</p:txBody></p:sp>`;

  it("与标题同名的正文形状不被误删", async () => {
    const xml = sp("title", ["项目背景"]) + sp("body", ["项目背景"]) + sp("body", ["详细说明"]);
    const r = await parseDocument(await pptxFile(xml));
    expect(r.headings).toEqual([{ level: 1, text: "项目背景" }]);
    expect(r.contentText).toContain("# 项目背景\n\n项目背景\n\n详细说明");
  });

  it("无占位符：第一个形状作标题且只出现一次（不进正文）", async () => {
    const xml = sp("", ["第一章"]) + sp("", ["内容A"]);
    const r = await parseDocument(await pptxFile(xml));
    expect(r.headings).toEqual([{ level: 1, text: "第一章" }]);
    expect(r.contentText.split("第一章").length - 1).toBe(1);
    expect(r.contentText).toContain("内容A");
  });
});
