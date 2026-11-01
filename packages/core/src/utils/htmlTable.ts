// 把文本中的 <table>…</table> HTML 转为 markdown 表格。
// 部分 PDF（HTML 页面打印/导出）的文本层直接含 HTML 表格标记，解析出的 contentText
// 会带 <table><td colspan=2> 原始标签；解析时转换（新数据干净），渲染前兜底（存量数据免迁移）。

const TABLE_RE = /<table\b[\s\S]*?<\/table>/gi;
const ROW_RE = /<tr\b[\s\S]*?<\/tr>/gi;
const CELL_RE = /<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

function decodeEntities(s: string): string {
  return s.replace(/&[a-z]+;|&#\d+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? e);
}

/** 单元格纯文本：去标签 + 解码实体 + 压缩空白 */
function cellText(raw: string): string {
  return decodeEntities(raw.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function attrValue(attrs: string, name: string): number {
  const m = attrs.match(new RegExp(`${name}\\s*=\\s*"?([0-9]+)"?`, "i"));
  return m ? Math.max(1, Number(m[1])) : 1;
}

/** 解析一张表为行数组；结构损坏（无行/无单元格）返回 null */
function parseRows(tableHtml: string): Array<Array<{ text: string; colspan: number; rowspan: number; head: boolean }>> | null {
  const rows: Array<Array<{ text: string; colspan: number; rowspan: number; head: boolean }>> = [];
  for (const rowMatch of tableHtml.matchAll(ROW_RE)) {
    const rowHtml = rowMatch[0];
    const cells: Array<{ text: string; colspan: number; rowspan: number; head: boolean }> = [];
    for (const c of rowHtml.matchAll(CELL_RE)) {
      cells.push({
        text: cellText(c[3]),
        colspan: attrValue(c[2], "colspan"),
        rowspan: attrValue(c[2], "rowspan"),
        head: c[1].toLowerCase() === "th",
      });
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows.length > 0 ? rows : null;
}

/** colspan/rowspan 展开为规整网格：内容占左上格，其余覆盖格留空 */
function expandGrid(rows: Array<Array<{ text: string; colspan: number; rowspan: number }>>): string[][] {
  const grid: string[][] = [];
  let maxCols = 0;
  rows.forEach((cells, r) => {
    if (!grid[r]) grid[r] = [];
    let c = 0;
    for (const cell of cells) {
      while (grid[r][c] !== undefined) c++; // 跳过被上方 rowspan 占据的格
      for (let dr = 0; dr < cell.rowspan; dr++) {
        for (let dc = 0; dc < cell.colspan; dc++) {
          if (!grid[r + dr]) grid[r + dr] = [];
          if (grid[r + dr][c + dc] === undefined) {
            grid[r + dr][c + dc] = dr === 0 && dc === 0 ? cell.text : "";
          }
        }
      }
      c += cell.colspan;
      maxCols = Math.max(maxCols, c);
    }
  });
  for (const row of grid) {
    while (row.length < maxCols) row.push("");
  }
  return grid;
}

function mdCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function tableToMarkdown(tableHtml: string): string {
  const rows = parseRows(tableHtml);
  if (!rows) {
    // 结构损坏：退化为纯文本（保留内容，不展示标签）
    return cellText(tableHtml);
  }
  const grid = expandGrid(rows);
  if (grid.length === 0) return cellText(tableHtml);
  // 首行全 th → 表头；否则首行作表头（与 markdown 表格结构一致）
  const lines = grid.map((row) => `| ${row.map(mdCell).join(" | ")} |`);
  const sep = `| ${grid[0].map(() => "---").join(" | ")} |`;
  return [lines[0], sep, ...lines.slice(1)].join("\n");
}

/** 把文本中所有 <table>…</table> 转为 markdown 表格；无表格时原样返回 */
export function htmlTablesToMarkdown(text: string): string {
  if (!text || text.indexOf("<table") === -1) return text;
  TABLE_RE.lastIndex = 0;
  return text.replace(TABLE_RE, (t) => tableToMarkdown(t));
}
