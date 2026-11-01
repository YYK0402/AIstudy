import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../markdown";

describe("renderMarkdown", () => {
  it("空输入返回空串", () => {
    expect(renderMarkdown("")).toBe("");
  });

  it("HTML 标签按文本显示（XSS 安全）", () => {
    const html = renderMarkdown('<script>alert(1)</script>');
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("段落内单换行变 <br>，空行分段", () => {
    expect(renderMarkdown("第一行\n第二行")).toBe("<p>第一行<br>第二行</p>");
    expect(renderMarkdown("段一\n\n段二")).toBe("<p>段一</p>\n<p>段二</p>");
  });

  it("加粗 / 斜体 / 行内代码", () => {
    expect(renderMarkdown("**affects**")).toBe("<p><strong>affects</strong></p>");
    expect(renderMarkdown("*重点*")).toBe("<p><em>重点</em></p>");
    expect(renderMarkdown("`affects` 的三单")).toBe("<p><code>affects</code> 的三单</p>");
  });

  it("围栏代码块内容不做行内渲染", () => {
    const html = renderMarkdown("```\n**不是加粗** `不是代码`\n```");
    expect(html).toBe("<pre><code>**不是加粗** `不是代码`</code></pre>");
  });

  it("标题与分隔线", () => {
    expect(renderMarkdown("## 正确句子")).toBe("<h2>正确句子</h2>");
    expect(renderMarkdown("---")).toBe("<hr>");
  });

  it("引用块内可含加粗", () => {
    expect(renderMarkdown("> **正确** 的句子")).toBe("<blockquote><strong>正确</strong> 的句子</blockquote>");
  });

  it("无序 / 有序列表", () => {
    expect(renderMarkdown("- 甲\n- 乙")).toBe("<ul><li>甲</li><li>乙</li></ul>");
    expect(renderMarkdown("1. 甲\n2. 乙")).toBe("<ol><li>甲</li><li>乙</li></ol>");
  });

  it("嵌套列表归入父条目", () => {
    const html = renderMarkdown("- 父\n  - 子");
    expect(html).toBe("<ul><li>父<ul><li>子</li></ul></li></ul>");
  });

  it("链接仅放行 http(s)", () => {
    expect(renderMarkdown("[官网](https://example.com)")).toBe(
      '<p><a href="https://example.com" target="_blank" rel="noopener noreferrer">官网</a></p>',
    );
    expect(renderMarkdown("[危险](javascript:alert(1))")).toBe("<p>[危险](javascript:alert(1))</p>");
  });

  it("表格：首行表头，分隔行不渲染", () => {
    const html = renderMarkdown("| A | B |\n| --- | --- |\n| 1 | 2 |");
    expect(html).toBe("<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>");
  });

  it("单行 | 不是表格，按段落处理", () => {
    expect(renderMarkdown("a | b")).toBe("<p>a | b</p>");
  });

  it("用户示例形态：加粗+列表+引用+代码混排", () => {
    const src = [
      "这道题**不是用 `carried`**，而是用 **`affects`**。",
      "",
      "- 句型：`Having friends` 是**动名词短语**。",
      "- 主语在意义上是单数。",
      "",
      "正确句子：",
      "",
      "> **Having friends affects children in many ways.**",
    ].join("\n");
    const html = renderMarkdown(src);
    expect(html).toContain("<strong>不是用 <code>carried</code></strong>");
    expect(html).toContain("<ul><li>句型：");
    expect(html).toContain("<blockquote><strong>Having friends affects children in many ways.</strong></blockquote>");
  });
});
