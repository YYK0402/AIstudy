import { describe, expect, it } from "vitest";
import { htmlTablesToMarkdown } from "../htmlTable";

describe("htmlTablesToMarkdown", () => {
  it("无表格时原样返回", () => {
    expect(htmlTablesToMarkdown("# 标题\n\n正文")).toBe("# 标题\n\n正文");
    expect(htmlTablesToMarkdown("")).toBe("");
  });

  it("真实数据形态：rowspan/colspan 展开对齐（英语讲义词性表）", () => {
    const src = `## 词性的辨认

<table><tr><td rowspan=1 colspan=2>名词</td><td rowspan=1 colspan=1>n.</td><td rowspan=1 colspan=2>形容词</td><td rowspan=1 colspan=1>adj.</td></tr><tr><td rowspan=1 colspan=2>动词</td><td rowspan=1 colspan=1>v.</td><td rowspan=1 colspan=2>副词</td><td rowspan=1 colspan=1>adv.</td></tr></table>

后续正文`;
    const out = htmlTablesToMarkdown(src);
    expect(out).toContain("| 名词 |  | n. | 形容词 |  | adj. |");
    expect(out).toContain("| 动词 |  | v. | 副词 |  | adv. |");
    expect(out).toContain("| --- | --- | --- | --- | --- | --- |");
    expect(out).not.toContain("<table");
    expect(out).not.toContain("<td");
    // 表格外内容保留
    expect(out).toContain("## 词性的辨认");
    expect(out).toContain("后续正文");
  });

  it("多行 rowspan：被占据的格留空", () => {
    const src = `<table><tr><td colspan=2>跨两行两列</td></tr><tr><td>a</td></tr></table>`;
    const out = htmlTablesToMarkdown(src);
    expect(out).toContain("| 跨两行两列 |  |");
    expect(out).toContain("| a |  |");
  });

  it("th 表头 + 列数不均补齐", () => {
    const src = `<table><tr><th>甲</th><th>乙</th></tr><tr><td>1</td></tr><tr><td>2</td><td>3</td><td>4</td></tr></table>`;
    const out = htmlTablesToMarkdown(src);
    expect(out).toContain("| 甲 | 乙 |");
    expect(out).toContain("| 1 |  |");
    expect(out).toContain("| 2 | 3 | 4 |");
  });

  it("单元格内 | 转义、实体解码、标签剥离", () => {
    const src = `<table><tr><td>a | b</td><td>&nbsp;x<br/>y</td></tr></table>`;
    const out = htmlTablesToMarkdown(src);
    expect(out).toContain("| a \\| b | x y |");
  });

  it("结构损坏（无 tr）退化为纯文本不丢内容", () => {
    const src = "前文<table>残缺</table>后文";
    const out = htmlTablesToMarkdown(src);
    expect(out).toBe("前文残缺后文");
  });

  it("多个表格各自转换", () => {
    const src = `<table><tr><td>1</td></tr></table>中缝<table><tr><td>2</td></tr></table>`;
    const out = htmlTablesToMarkdown(src);
    expect(out).toContain("| 1 |");
    expect(out).toContain("| 2 |");
    expect(out).toContain("中缝");
    expect(out).not.toContain("<table");
  });
});
