// 直接引 types（不经 api barrel）：utils 被 siyuan 端程序跨包引入时，barrel 会把 core 全部 API 图
// （含 documentParser 的 mammoth/pdfjs 声明缺失）拖进程序导致类型检查失败
import type { Chapter, Material } from "../types/appData";

/** outline 扁平节点（文档序） */
export interface OutlineNode {
  text: string;
  level: number;
}

/** 资料 outline 字段（JSON 字符串）→ OutlineNode[]；缺失/损坏返回空 */
export function outlineOf(material: Material): OutlineNode[] {
  if (!material.outline) return [];
  try {
    const v: unknown = JSON.parse(material.outline);
    return Array.isArray(v)
      ? v.filter((x): x is OutlineNode => typeof x === "object" && x !== null && typeof (x as OutlineNode).text === "string")
      : [];
  } catch {
    return [];
  }
}

/** outline 节点在干净文本中的定位范围（start=-1 未定位） */
export interface OutlineSpan {
  seq: number;
  start: number;
  end: number;
}

const norm = (s: string): string => s.replace(/\s+/g, "");

/** 去掉 markdown 井号/加粗包裹，得到标题行纯文本 */
function plainLine(line: string): string {
  return line.trim().replace(/^#{1,6}\s+/, "").replace(/^\*\*(.+?)\*\*$/, "$1").trim();
}

/**
 * 顺序对齐：每个标题从上一标题行之后向后查找（单调，防目录页误匹配）。
 * 两遍匹配：归一化精确 → 包含匹配（标题与文档行略有差异，短行 ≤ 2×标题长）。
 */
export function alignOutlineSpans(text: string, nodes: OutlineNode[]): { spans: OutlineSpan[]; unlocated: number[] } {
  const lines = text.split("\n");
  const lineStarts: number[] = [];
  let off = 0;
  for (const line of lines) {
    lineStarts.push(off);
    off += line.length + 1;
  }
  const spans: OutlineSpan[] = [];
  const unlocated: number[] = [];
  let cursor = 0;
  for (let seq = 0; seq < nodes.length; seq++) {
    const target = norm(nodes[seq].text);
    let foundLine = -1;
    if (target.length > 0) {
      for (let i = cursor; i < lines.length; i++) {
        if (norm(plainLine(lines[i])) === target) { foundLine = i; break; }
      }
      if (foundLine < 0 && target.length >= 4) {
        for (let i = cursor; i < lines.length; i++) {
          const p = norm(plainLine(lines[i]));
          if (p.length < 4 || p.length > target.length * 2 + 6) continue;
          if (p.includes(target) || target.includes(p)) { foundLine = i; break; }
        }
      }
    }
    if (foundLine < 0) {
      spans.push({ seq, start: -1, end: -1 });
      unlocated.push(seq);
      continue;
    }
    cursor = foundLine + 1;
    spans.push({ seq, start: lineStarts[foundLine], end: -1 });
  }
  // 回填 end：到下一个「已定位」标题起点（未定位节点不切段）
  let nextStart = text.length;
  for (let i = spans.length - 1; i >= 0; i--) {
    spans[i].end = nextStart;
    if (spans[i].start >= 0) nextStart = spans[i].start;
  }
  return { spans, unlocated };
}

export interface OutlineTreeNode {
  seq: number;
  text: string;
  level: number;
  children: OutlineTreeNode[];
}

/** 扁平 outline → 嵌套树（level 回跳弹栈；首个节点无论 level 都作根） */
export function buildOutlineTree(nodes: OutlineNode[]): OutlineTreeNode[] {
  const roots: OutlineTreeNode[] = [];
  const stack: OutlineTreeNode[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node: OutlineTreeNode = { seq: i, text: nodes[i].text, level: nodes[i].level, children: [] };
    while (stack.length > 0 && stack[stack.length - 1].level >= node.level) stack.pop();
    if (stack.length === 0) roots.push(node);
    else stack[stack.length - 1].children.push(node);
    stack.push(node);
  }
  return roots;
}

/** 第 seq 个 outline 节点的路径文本（祖先 > 自身） */
export function nodePathOf(nodes: OutlineNode[], seq: number): string {
  const tree = buildOutlineTree(nodes);
  let found: string[] = [];
  const walk = (list: OutlineTreeNode[], trail: string[]): boolean => {
    for (const n of list) {
      const next = [...trail, n.text];
      if (n.seq === seq) { found = next; return true; }
      if (walk(n.children, next)) return true;
    }
    return false;
  };
  walk(tree, []);
  return found.join(">");
}

export interface NestedChapter {
  chapter: Chapter;
  children: NestedChapter[];
}

/** 章节 flat → 嵌套树（同级按 sort；孤儿 parentId 指向已删节点时提升顶层防丢失）；调用方自行保证传入范围 */
export function buildChapterTreeFlat(chapters: Chapter[]): NestedChapter[] {
  type Item = { chapter: Chapter; children: NestedChapter[] };
  const items: Item[] = chapters.map((c) => ({ chapter: c, children: [] }));
  const byId = new Map(items.map((it) => [it.chapter.id, it]));
  const roots: NestedChapter[] = [];
  const orphans: NestedChapter[] = [];
  for (const it of items) {
    const parent = it.chapter.parentId === null ? undefined : byId.get(it.chapter.parentId);
    if (parent) parent.children.push(it);
    else if (it.chapter.parentId === null) roots.push(it);
    else orphans.push(it); // 孤儿不混进真根排序，统一追加在顶层末尾
  }
  const sortRec = (list: NestedChapter[]): void => {
    list.sort((a, b) => a.chapter.sort - b.chapter.sort);
    for (const n of list) sortRec(n.children);
  };
  sortRec(roots);
  if (orphans.length) {
    orphans.sort((a, b) => a.chapter.sort - b.chapter.sort);
    roots.push(...orphans);
  }
  return roots;
}

/** 课程章节 flat → 嵌套树（courseId 过滤后同 buildChapterTreeFlat） */
export function buildChapterTree(chapters: Chapter[], courseId: number): NestedChapter[] {
  return buildChapterTreeFlat(chapters.filter((c) => c.courseId === courseId));
}

/** 自身或最近的 level≤2 祖先 id（KP 区域/文档同步落点）；level>2 节点本身不建文档 */
export function nearestDocAncestorId(chapters: Chapter[], nodeId: number): number {
  const byId = new Map(chapters.map((c) => [c.id, c]));
  let cur: Chapter | undefined = byId.get(nodeId);
  let guard = 0;
  while (cur && cur.level > 2 && guard++ < 16) {
    cur = cur.parentId === null ? undefined : byId.get(cur.parentId);
  }
  return cur?.id ?? nodeId;
}

/** 最近 level-1 祖先 id（parentId 链上溯至 level===1；自身 level 1 取自身）；
 *  节点不存在/链断/环致守卫耗尽返回 null（KP 归属口径，章末测评与掌握热力图共用） */
export function nearestTopAncestorId(chapterId: number, chapterById: Map<number, Chapter>): number | null {
  let cur: Chapter | undefined = chapterById.get(chapterId);
  let guard = 0;
  while (cur && guard++ < 16) {
    if (cur.level === 1) return cur.id;
    cur = cur.parentId === null ? undefined : chapterById.get(cur.parentId);
  }
  return null;
}

/** nodeId 是否 ancestorId 的严格后代（自身不算） */
export function isDescendant(chapters: Chapter[], ancestorId: number, nodeId: number): boolean {
  const byId = new Map(chapters.map((c) => [c.id, c]));
  let cur: Chapter | undefined = byId.get(nodeId);
  // 从 nodeId 的父节点起步，保证严格语义（isDescendant(c, x, x) === false）
  cur = cur && cur.parentId !== null ? byId.get(cur.parentId) : undefined;
  let guard = 0;
  while (cur && guard++ < 16) {
    if (cur.id === ancestorId) return true;
    cur = cur.parentId === null ? undefined : byId.get(cur.parentId);
  }
  return false;
}

/** 节点完整路径文本（根 > ... > 自身） */
export function chapterPathText(chapters: Chapter[], nodeId: number): string {
  const byId = new Map(chapters.map((c) => [c.id, c]));
  const parts: string[] = [];
  let cur: Chapter | undefined = byId.get(nodeId);
  let guard = 0;
  while (cur && guard++ < 16) {
    parts.unshift(cur.name);
    cur = cur.parentId === null ? undefined : byId.get(cur.parentId);
  }
  return parts.join(">");
}
