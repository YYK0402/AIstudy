/**
 * 最小 Markdown 渲染器（零依赖、XSS 安全）。
 * 先整体 HTML 转义，再套用 Markdown 规则，因此原文中的 HTML 标签一律按文本显示。
 * 覆盖 AI 问答 / 资料正文实际用到的语法：
 * 围栏代码块、行内代码、加粗、斜体、链接、标题、有序/无序列表（含嵌套）、引用、分隔线、表格、段落内换行。
 * 不支持的语法（如脚注、图片）按原文纯文本展示，不丢内容。
 */

const ESC_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(src: string): string {
  return src.replace(/[&<>"']/g, (ch) => ESC_MAP[ch]);
}

const LIST_ITEM_RE = /^([ \t]*)([-*+]|\d+[.)])[ \t]+(.*)$/;
const HR_RE = /^[ \t]*([-*_])[ \t]*(?:\1[ \t]*){2,}$/;
const FENCE_RE = /^[ \t]*```/;

const indentOf = (line: string): number => line.match(/^[ \t]*/)?.[0].length ?? 0;
const isOrderedMarker = (marker: string): boolean => /^\d+[.)]/.test(marker);

/** 行内渲染：转义后的文本 → 行内 HTML（代码/加粗/斜体/链接） */
function inline(text: string): string {
  const codes: string[] = [];
  let out = text.replace(/`([^`\n]+)`/g, (_m, code: string) => {
    codes.push(code);
    return `\u0001${codes.length - 1}\u0001`;
  });
  out = out.replace(/\*\*([\s\S]+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/__([\s\S]+?)__/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (raw, label: string, url: string) => {
    // 链接仅放行 http(s)，其余（javascript: 等）原样按纯文本显示
    return /^https?:\/\//i.test(url)
      ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`
      : raw;
  });
  out = out.replace(/\u0001(\d+)\u0001/g, (_m, n: string) => `<code>${codes[Number(n)]}</code>`);
  return out;
}

/** 从 start 行起解析一个列表（可嵌套），返回 [html, 下一行下标] */
function parseList(lines: string[], start: number, baseIndent: number, ordered: boolean): [string, number] {
  const tag = ordered ? "ol" : "ul";
  const items: string[] = [];
  let j = start;
  while (j < lines.length) {
    const line = lines[j];
    if (/^[ \t]*$/.test(line)) {
      const next = lines[j + 1];
      if (next && LIST_ITEM_RE.test(next) && indentOf(next) >= baseIndent) {
        j++;
        continue;
      }
      break;
    }
    const m = line.match(LIST_ITEM_RE);
    if (!m) break;
    const ind = m[1].length;
    if (ind < baseIndent) break;
    if (ind > baseIndent) {
      // 更深层：子列表（首个子项决定有序/无序）；若本层还没有条目，说明调用方按 ind+1 预估的
      // baseIndent 偏小，该子列表整体就是当前层
      const [childHtml, nextJ] = parseList(lines, j, ind, isOrderedMarker(m[2]));
      if (items.length) items[items.length - 1] += childHtml;
      else return [childHtml, nextJ];
      j = nextJ;
      continue;
    }
    if (isOrderedMarker(m[2]) !== ordered) break;
    j++;
    const [childHtml, nextJ] = parseList(lines, j, ind + 1, false);
    items.push(`<li>${inline(m[3])}${childHtml}</li>`);
    j = nextJ;
  }
  if (!items.length) return ["", start];
  return [`<${tag}>${items.join("")}</${tag}>`, j];
}

/** 从 start 行起收集连续表格行（以 | 开头），返回 [html, 下一行下标]；首行非表格行时原样返回 */
function parseTable(lines: string[], start: number): [string, number] {
  const isRow = (l: string) => /^[ \t]*\|.*\|[ \t]*$/.test(l);
  if (!isRow(lines[start])) return ["", start];
  const rows: string[][] = [];
  let j = start;
  while (j < lines.length && isRow(lines[j])) {
    const cells = lines[j]
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((c) => c.trim());
    // 第二行分隔行（| --- | :--: |）不作为数据行
    if (!(j === start + 1 && cells.every((c) => /^:?-{2,}:?$/.test(c)))) rows.push(cells);
    j++;
  }
  if (rows.length < 2) return ["", start];
  const head = rows[0];
  const body = rows.slice(1);
  const html =
    "<table>" +
    `<thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead>` +
    `<tbody>${body.map((r) => `<tr>${head.map((_c, idx) => `<td>${inline(r[idx] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody>` +
    "</table>";
  return [html, j];
}

export function renderMarkdown(src: string): string {
  if (!src) return "";
  const lines = escapeHtml(src).split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^[ \t]*$/.test(line)) {
      i++;
      continue;
    }
    if (FENCE_RE.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE_RE.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      i++; // 跳过收尾围栏（EOF 时越界无碍）
      out.push(`<pre><code>${body.join("\n")}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,6})[ \t]+(.*)$/);
    if (h) {
      const lv = h[1].length;
      out.push(`<h${lv}>${inline(h[2])}</h${lv}>`);
      i++;
      continue;
    }
    if (HR_RE.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }
    // 注意：整体已 HTML 转义，引用符 > 此时是 &gt;
    const quote: string[] = [];
    while (i < lines.length && /^[ \t]*&gt;[ \t]?/.test(lines[i])) {
      quote.push(inline(lines[i].replace(/^[ \t]*&gt;[ \t]?/, "")));
      i++;
    }
    if (quote.length) {
      out.push(`<blockquote>${quote.join("<br>")}</blockquote>`);
      continue;
    }
    if (LIST_ITEM_RE.test(line)) {
      const [html, next] = parseList(lines, i, indentOf(line), isOrderedMarker(line.match(LIST_ITEM_RE)![2]));
      out.push(html);
      i = next;
      continue;
    }
    if (/^[ \t]*\|/.test(line)) {
      const [html, next] = parseTable(lines, i);
      if (html) {
        out.push(html);
        i = next;
        continue;
      }
    }
    // 段落：连续普通行以 <br> 连接
    const para: string[] = [line];
    i++;
    while (i < lines.length) {
      const l = lines[i];
      if (
        /^[ \t]*$/.test(l) ||
        FENCE_RE.test(l) ||
        /^#{1,6}[ \t]+/.test(l) ||
        HR_RE.test(l) ||
        /^[ \t]*&gt;[ \t]?/.test(l) ||
        LIST_ITEM_RE.test(l) ||
        /^[ \t]*\|/.test(l)
      ) {
        break;
      }
      para.push(l);
      i++;
    }
    out.push(`<p>${para.map(inline).join("<br>")}</p>`);
  }
  return out.join("\n");
}
