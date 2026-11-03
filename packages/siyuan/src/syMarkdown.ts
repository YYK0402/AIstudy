// .sy 块树 → markdown 还原（思源 spec 格式；用于对话文档同步/知识点区读回时读取当前内容）
// 块树来源：/api/filetree/getDoc 定位 .sy 文件 → /api/file/getFile 读原文 JSON
export interface SyNode {
  Type?: string;
  HeadingLevel?: number;
  Data?: string;
  TextMarkType?: string;
  TextMarkTextContent?: string;
  CodeBlockInfo?: string;
  ListData?: { Typ?: number; Num?: number };
  TaskListItemChecked?: boolean;
  Properties?: { title?: string };
  Children?: SyNode[];
}

/** 宽容解析块树 JSON：非对象/坏 JSON 返回 null，调用方按读取失败兜底 */
export function safeJsonParse(text: string): SyNode | null {
  try {
    const v = JSON.parse(text) as unknown;
    return (v && typeof v === "object" ? v : null) as SyNode | null;
  } catch {
    return null;
  }
}

/** base64 → UTF-8 文本（浏览器无 Buffer：atob 得二进制串，须按字节 TextDecoder 还原多字节字符） */
function b64Decode(v: string | undefined): string {
  if (!v) return "";
  try {
    const bin = atob(v);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return v;
  }
}

function htmlUnescape(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** 行内节点（文本/标记/公式/图片）→ markdown */
function syInline(nodes: SyNode[] | undefined): string {
  let out = "";
  for (const n of nodes ?? []) {
    switch (n.Type) {
      case "NodeText":
        out += htmlUnescape(n.Data ?? "");
        break;
      case "NodeTextMark": {
        const raw = n.Data != null ? n.Data : n.TextMarkTextContent;
        const inner = raw != null ? htmlUnescape(raw) : syInline(n.Children);
        const t = n.TextMarkType;
        if (t === "strong") out += `**${inner}**`;
        else if (t === "em") out += `*${inner}*`;
        else if (t === "del") out += `~~${inner}~~`;
        else if (t === "code") out += `\`${inner}\``;
        else if (t === "link") out += `[${inner}]${syLinkDest(n.Children)}`;
        else out += inner;
        break;
      }
      case "NodeMath":
      case "NodeInlineMath":
        out += `$${n.Data ?? ""}$`;
        break;
      case "NodeImage":
        out += `![${syLinkText(n.Children)}]${syLinkDest(n.Children)}`;
        break;
      default:
        break;
    }
  }
  return out;
}

function syLinkText(children: SyNode[] | undefined): string {
  const n = (children ?? []).find((c) => c.Type === "NodeLinkText");
  return n ? htmlUnescape(n.Data ?? "") : "";
}

function syLinkDest(children: SyNode[] | undefined): string {
  const n = (children ?? []).find((c) => c.Type === "NodeLinkDest");
  return n && n.Data ? `(${htmlUnescape(n.Data)})` : "";
}

function syListItem(item: SyNode, depth: number): string {
  const pad = "  ".repeat(depth);
  const kids = item.Children ?? [];
  const taskMarker = kids.find((c) => c.Type === "NodeTaskListItemMarker");
  const para = kids.find((c) => c.Type === "NodeParagraph");
  const nested = kids.filter((c) => c.Type === "NodeList");
  const text = para ? syInline(para.Children) : "";
  let prefix: string;
  if (taskMarker) prefix = taskMarker.TaskListItemChecked === true ? "- [x] " : "- [ ] ";
  else if (item.ListData?.Typ === 1) prefix = `${item.ListData?.Num ?? ""}. `;
  else prefix = "- ";
  // 内核解析时剥掉列表项续行的 2 空格缩进（name 行与内容行合并在同一 NodeText 以 \n 分隔），
  // 还原时必须补回，否则内容行落在第 0 列，parseKpRegion 会将其当游离文本丢弃（内容丢失）；
  // 空行与 renderKpRegion 一致保持空串不缩进，首行（name 行）不缩进
  const textIndented = text
    .split("\n")
    .map((l, i) => (i === 0 || l === "" ? l : `  ${l}`))
    .join("\n");
  let out = pad + prefix + textIndented;
  for (const nl of nested) {
    out += "\n" + (nl.Children ?? []).map((it) => syListItem(it, depth + 1)).join("\n");
  }
  return out;
}

function syBlock(n: SyNode): string {
  const kids = (n.Children ?? []).filter((c) => c.Type !== "NodeAttr");
  switch (n.Type) {
    case "NodeHeading": {
      const level = Math.min(Math.max(n.HeadingLevel ?? 1, 1), 6);
      const text = syInline(kids).trim();
      return text ? `${"#".repeat(level)} ${text}` : "";
    }
    case "NodeParagraph":
      return syInline(kids).trim();
    case "NodeBlockquote": {
      const inner = kids
        .filter((c) => c.Type !== "NodeBlockquoteMarker")
        .map((c) => syBlock(c))
        .filter(Boolean);
      return inner.map((l) => l.split("\n").map((x) => `> ${x}`).join("\n")).join("\n");
    }
    case "NodeList":
      return kids.filter((c) => c.Type === "NodeListItem").map((it) => syListItem(it, 0)).join("\n");
    case "NodeCodeBlock": {
      const info = kids.find((c) => c.Type === "NodeCodeBlockFenceInfoMarker");
      const code = kids.find((c) => c.Type === "NodeCodeBlockCode");
      const lang = b64Decode(info?.CodeBlockInfo).trim();
      return "```" + lang + "\n" + (code?.Data ?? "") + "```";
    }
    default:
      return syInline(kids).trim();
  }
}

export function syTreeToMarkdown(tree: SyNode): string {
  const title = (tree.Properties?.title ?? "").trim();
  const children = (tree.Children ?? []).filter((n) => n.Type && n.Type !== "NodeAttr");
  // 首个 h1 与文档标题等价（思源约定），避免重复
  if (children[0]?.Type === "NodeHeading" && children[0].HeadingLevel === 1) {
    children.shift();
  }
  const body = children.map((n) => syBlock(n)).filter((s) => s.trim() !== "").join("\n\n");
  return title ? (body ? `# ${title}\n\n${body}` : `# ${title}`) : body;
}
