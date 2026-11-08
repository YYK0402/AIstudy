import type { AppData, Chapter, KnowledgePoint } from "../types/appData";
import { nearestDocAncestorId } from "./outline";

/**
 * 知识点树往返导入（纯函数）：parse → diff → apply。
 * 解析「导出 → 编辑 → 导入」的 Markdown；身份靠 <!-- ch:ID --> / <!-- kp:ID --> 锚点匹配，
 * 仅更新 name/content/章节归属/顺序，绝不触碰掌握度、题目、闪卡、排期等学习状态。
 */

export interface ParsedKp {
  /** 稳定 key：`id:1`（带标记）或 `new:3`（新增） */
  key: string;
  /** 现有知识点 id；null = 文件中无标记（新增） */
  id: number | null;
  name: string;
  content: string;
  /** 所在章节的 key（ParsedChapter.key）；null = 未归章 */
  chapterKey: string | null;
  /** 所在章节内的文件顺序（0 起） */
  sort: number;
}

export interface ParsedChapter {
  key: string;
  /** 现有章节 id；null = 文件中无标记（新增） */
  id: number | null;
  name: string;
  /** 标题深度：# 数（1 = 顶章，2 = 节，3+ = 小节） */
  level: number;
  /** 直属父章的 key；顶章为 null */
  parentKey: string | null;
  sort: number;
}

export interface ParsedKpTree {
  /** 过滤导出（仅未掌握）为 false，导入须拒绝 */
  importable: boolean;
  courseId: number | null;
  courseName: string | null;
  chapters: ParsedChapter[];
  kps: ParsedKp[];
}

export type ParseResult =
  | { ok: true; tree: ParsedKpTree }
  | { ok: false; error: string; line: number };

export interface KpDiffUpdate {
  id: number;
  name?: string;
  content?: string;
  /** 目标章节 key（null = 未归章）；缺省 = 不变 */
  chapterKey?: string | null;
  sort: number;
}
export interface KpDiffAdd {
  name: string;
  content: string;
  /** 所在章节 key（null = 未归章） */
  chapterKey: string | null;
  sort: number;
}
export interface KpDiffRemove {
  id: number;
  name: string;
}
export interface ChapterDiffUpdate {
  id: number;
  name?: string;
  /** 目标父章 key（null = 顶章）；缺省 = 不变 */
  parentKey?: string | null;
  sort: number;
}
export interface ChapterDiffAdd {
  key: string;
  name: string;
  level: number;
  /** 父章 key（null = 顶章） */
  parentKey: string | null;
  sort: number;
}
export interface ChapterDiffRemove {
  id: number;
  name: string;
  /** 计算 diff 时的思源文档 id 快照（apply 后章对象可能已从 data 移除，同步侧不可依赖查表） */
  siyuanBlockId: string | null;
}
export interface KpTreeDiff {
  updated: KpDiffUpdate[];
  added: KpDiffAdd[];
  removed: KpDiffRemove[];
  unchangedKps: number;
  chaptersUpdated: ChapterDiffUpdate[];
  chaptersAdded: ChapterDiffAdd[];
  chaptersRemoved: ChapterDiffRemove[];
}

/** 掌握度/错题等显示标签（仅参考，解析时剥离，导入不据此改动状态） */
const MASTERY_TAG_RE = /\[(未学习|了解|掌握|精通)\]\s*$/;
const WRONG_TAG_RE = /（\d+\s*错题）\s*$/;
const COUNT_RE = /（\d+）\s*$/;
const CH_MARKER_RE = / <!-- ch:(\d+) -->\s*$/;
const KP_MARKER_RE = / <!-- kp:(\d+) -->\s*$/;

interface HeadingParse {
  name: string;
  id: number | null;
}

function parseHeading(line: string, depth: number): HeadingParse {
  const prefix = "#".repeat(depth) + " ";
  let rest = line.slice(prefix.length);
  let id: number | null = null;
  const m = rest.match(CH_MARKER_RE);
  if (m) {
    id = Number(m[1]);
    rest = rest.slice(0, m.index);
  }
  const name = rest.replace(COUNT_RE, "").trim();
  return { name, id };
}

function parseKpName(rest: string): string {
  return rest
    .trim()
    .replace(WRONG_TAG_RE, "")
    .trim()
    .replace(MASTERY_TAG_RE, "")
    .trim();
}

/** 解析知识点 bullet 行主体：kp 标记 ID + 名称（剥离显示标签）；主解析器与思源区解析共享 */
export function parseKpLine(rest: string): { name: string; id: number | null } {
  let id: number | null = null;
  let s = rest;
  const m = s.match(KP_MARKER_RE);
  if (m) {
    id = Number(m[1]);
    s = s.slice(0, m.index);
  }
  return { name: parseKpName(s), id };
}

interface HeaderInfo {
  error?: string;
  line?: number;
  courseId: number | null;
  importable: boolean;
  start: number;
}

/** 解析可选的头部注释块（身份锚点 + 使用说明）；未闭合则报错 */
function extractHeader(lines: string[]): HeaderInfo {
  let s = 0;
  while (s < lines.length && lines[s].trim() === "") s++;
  if (s >= lines.length || !lines[s].trim().startsWith("<!--")) {
    return { courseId: null, importable: true, start: 0 };
  }
  let end = -1;
  if (lines[s].trim().includes("-->")) {
    end = s;
  } else {
    for (let j = s + 1; j < lines.length; j++) {
      if (lines[j].trim() === "-->") {
        end = j;
        break;
      }
    }
  }
  if (end === -1) return { error: "说明头未闭合（缺少结尾 -->）", line: s + 1, courseId: null, importable: true, start: 0 };
  let courseId: number | null = null;
  let importable = true;
  for (let j = s; j <= end; j++) {
    const cm = lines[j].match(/（course:(\d+)）/);
    if (cm) courseId = Number(cm[1]);
    if (lines[j].includes("不可用于导入")) importable = false;
  }
  return { courseId, importable, start: end + 1 };
}

export function parseKpTreeMarkdown(text: string): ParseResult {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const header = extractHeader(lines);
  if (header.error) return { ok: false, error: header.error, line: header.line ?? 1 };

  const tree: ParsedKpTree = {
    importable: header.importable,
    courseId: header.courseId,
    courseName: null,
    chapters: [],
    kps: [],
  };

  let inUnassigned = false;
  let currentKp: ParsedKp | null = null;
  let kpBuf: string[] = [];
  let firstH1Seen = false;
  let newChapterCounter = 0;
  let newKpCounter = 0;
  /** 章标题祖先栈（文件序，# 数 = 深度）：推导父子与 KP 归属；弹栈到最近更浅层即父 */
  const chapterStack: Array<{ key: string; depth: number }> = [];
  const siblingIndex = new Map<string, number>();
  const nodeKpIndex = new Map<string, number>();
  const seenChapterIds = new Set<number>();
  const seenKpIds = new Set<number>();

  const fail = (error: string, line: number): ParseResult => ({ ok: false, error, line });

  const kpChapterKey = (): string | null => {
    if (inUnassigned) return null;
    const top = chapterStack[chapterStack.length - 1];
    return top ? top.key : null;
  };

  const finalizeKp = (): void => {
    if (currentKp) {
      while (kpBuf.length > 0 && kpBuf[kpBuf.length - 1] === "") kpBuf.pop();
      currentKp.content = kpBuf.join("\n");
      currentKp = null;
    }
    kpBuf = [];
  };

  for (let i = header.start; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    // 内容行：仅当处于某条目下，且为空行或缩进行
    if (currentKp !== null && (line.trim() === "" || /^\s/.test(line))) {
      kpBuf.push(line.trim() === "" ? "" : line.replace(/^ {2}/, "").replace(/^\t/, ""));
      continue;
    }

    // 结构行：结束当前条目
    finalizeKp();

    if (line.trim() === "" || line.trim().startsWith(">")) continue;

    // 章标题（任意深度）：# 数 = level；栈式推导父节点
    const heading = line.match(/^(#{1,6}) (.+)$/);
    if (heading) {
      const depth = heading[1].length;
      const { name, id } = parseHeading(line, depth);
      if (depth === 1) {
        // 课程标题（首个 H1 或以「知识点树」结尾）/ 未归章 / 顶章
        const isTitle = !firstH1Seen || name.endsWith("知识点树");
        firstH1Seen = true;
        if (isTitle) {
          if (tree.courseName === null) tree.courseName = name.replace(/ 知识点树$/, "").trim();
          chapterStack.length = 0;
          inUnassigned = false;
          continue;
        }
        if (name === "未归章") {
          chapterStack.length = 0;
          inUnassigned = true;
          continue;
        }
      } else if (chapterStack.length === 0) {
        return fail(`第 ${depth} 级标题（${"#".repeat(depth)}）未在任何顶章（#）下`, lineNo);
      }
      if (id !== null && seenChapterIds.has(id)) return fail(`重复的章节标记 ch:${id}`, lineNo);
      if (id !== null) seenChapterIds.add(id);
      const key = id !== null ? `id:${id}` : `new:${newChapterCounter++}`;
      // 弹到最近更浅层作父；跳级（depth > 栈顶+1）挂当前栈顶（容错）；depth 1 弹空 → 顶章
      while (chapterStack.length > 0 && chapterStack[chapterStack.length - 1].depth >= depth) chapterStack.pop();
      const parent = chapterStack[chapterStack.length - 1] ?? null;
      const groupKey = parent ? parent.key : "__none__";
      const idx = siblingIndex.get(groupKey) ?? 0;
      siblingIndex.set(groupKey, idx + 1);
      const ch: ParsedChapter = { key, id, name, level: depth, parentKey: parent ? parent.key : null, sort: idx };
      tree.chapters.push(ch);
      chapterStack.push({ key, depth });
      inUnassigned = false;
      continue;
    }

    if (line.startsWith("- ")) {
      if (!inUnassigned && chapterStack.length === 0) {
        return fail("知识点条目（-）未在任何章节下（未归章请放在「# 未归章」之后）", lineNo);
      }
      const { name, id } = parseKpLine(line.slice(2));
      if (id !== null && seenKpIds.has(id)) return fail(`重复的知识点标记 kp:${id}`, lineNo);
      if (id !== null) seenKpIds.add(id);
      const key = id !== null ? `id:${id}` : `new:${newKpCounter++}`;
      const nodeKey = kpChapterKey() ?? "__unassigned__";
      const idx = nodeKpIndex.get(nodeKey) ?? 0;
      nodeKpIndex.set(nodeKey, idx + 1);
      currentKp = { key, id, name, content: "", chapterKey: kpChapterKey(), sort: idx };
      tree.kps.push(currentKp);
      continue;
    }

    if (/^\s/.test(line)) return fail("缩进行未紧跟在知识点条目之后", lineNo);
    return fail("未识别的行（应为 # 章节标题 / - 条目 / 缩进内容）", lineNo);
  }
  finalizeKp();

  if (tree.chapters.length === 0 && tree.kps.length === 0) {
    return fail("文件中未解析到任何章节或知识点", 1);
  }
  return { ok: true, tree };
}

/** KP 归属的思源文档落点：顶章/节 = 自身；孤儿节/幽灵章节 → null；
 *  level>2 节点本身不建文档，区域同步落最近 level≤2 有文档祖先（断链回退自身）。
 *  注意：这是文档同步口径，md 导入的归属比较走 computeKpTreeDiff 的 full 粒度 */
export function effectiveNodeOf(kp: Pick<KnowledgePoint, "chapterId">, chapters: Chapter[]): number | null {
  if (kp.chapterId === null) return null;
  const topIds = new Set(chapters.filter((c) => c.level === 1).map((c) => c.id));
  if (topIds.has(kp.chapterId)) return kp.chapterId;
  const ch = chapters.find((c) => c.id === kp.chapterId);
  const unit = ch && ch.level === 2 && ch.parentId !== null && topIds.has(ch.parentId) ? ch : null;
  if (unit) return unit.id;
  return ch && ch.level > 2 ? nearestDocAncestorId(chapters, ch.id) : null;
}

/** 解析 KP 的目标节点：带标记章节 → id；新增章节 → key 哨兵；未归章 → null */
function parsedNodeOf(kp: ParsedKp, tree: ParsedKpTree): number | string | null {
  if (kp.chapterKey === null) return null;
  const ch = tree.chapters.find((c) => c.key === kp.chapterKey);
  if (!ch) return null;
  return ch.id !== null ? ch.id : ch.key;
}

function nodesEqual(a: number | string | null, b: number | string | null): boolean {
  if (a === null || b === null) return a === null && b === null;
  return a === b;
}

export interface KpTreeDiffOptions {
  /** KP 归属比较粒度：
   * full = 全深度章节 id（md 导入：文件位置即归属，N 级往返）；
   * effective = 最近 level≤2 文档节点（思源区读回：KP 区落在 ≤2 文档，默认，行为不变） */
  nodeGranularity?: "full" | "effective";
}

export function computeKpTreeDiff(tree: ParsedKpTree, chapters: Chapter[], kps: KnowledgePoint[], opts: KpTreeDiffOptions = {}): KpTreeDiff {
  const granularity: "full" | "effective" = opts.nodeGranularity ?? "effective";
  const chapterIds = new Set(chapters.map((c) => c.id));
  // 数据侧当前归属节点：full = 数据 chapterId（以存在性判定，空/幽灵 = null）；effective = 文档同步落点（最近 ≤2 祖先）
  const curNodeOf = (k: KnowledgePoint): number | null =>
    granularity === "full"
      ? k.chapterId !== null && chapterIds.has(k.chapterId)
        ? k.chapterId
        : null
      : effectiveNodeOf(k, chapters);

  const parsedKpById = new Map<number, ParsedKp>();
  for (const k of tree.kps) if (k.id !== null) parsedKpById.set(k.id, k);
  const parsedChById = new Map<number, ParsedChapter>();
  for (const c of tree.chapters) if (c.id !== null) parsedChById.set(c.id, c);

  // 解析侧各节点的顺序索引（用于 apply 时赋 sort）
  const parsedNodeIndex = new Map<string, number>();
  const nodeKeyOf = (n: number | string | null): string => (n === null ? "__null__" : `n:${n}`);
  const parsedSort = new Map<string, number>();
  for (const k of tree.kps) {
    const nk = nodeKeyOf(parsedNodeOf(k, tree));
    const idx = parsedNodeIndex.get(nk) ?? 0;
    parsedNodeIndex.set(nk, idx + 1);
    parsedSort.set(k.key, idx);
  }
  // 解析侧章节顺序索引：按父章分组（N 级通用；顶层章 parentKey 为 null）
  const parsedSiblingIndex = new Map<string, number>();
  const parsedChSort = new Map<string, number>();
  for (const c of tree.chapters) {
    const groupKey = c.parentKey ?? "__none__";
    const idx = parsedSiblingIndex.get(groupKey) ?? 0;
    parsedSiblingIndex.set(groupKey, idx + 1);
    parsedChSort.set(c.key, idx);
  }

  const updated: KpDiffUpdate[] = [];
  const added: KpDiffAdd[] = [];
  const removed: KpDiffRemove[] = [];
  let unchangedKps = 0;

  for (const k of kps) {
    const pk = parsedKpById.get(k.id);
    if (!pk) {
      removed.push({ id: k.id, name: k.name });
      continue;
    }
    const curNode = curNodeOf(k);
    const newNode = parsedNodeOf(pk, tree);
    const nameChanged = pk.name !== k.name;
    const contentChanged = pk.content !== k.content;
    const nodeChanged = !nodesEqual(curNode, newNode);
    if (!nameChanged && !contentChanged && !nodeChanged) {
      unchangedKps++;
      continue;
    }
    const entry: KpDiffUpdate = { id: k.id, sort: (parsedSort.get(pk.key) ?? 0) + 1 };
    if (nameChanged) entry.name = pk.name;
    if (contentChanged) entry.content = pk.content;
    if (nodeChanged) entry.chapterKey = pk.chapterKey;
    updated.push(entry);
  }
  for (const pk of tree.kps) {
    if (pk.id === null) {
      added.push({ name: pk.name, content: pk.content, chapterKey: pk.chapterKey, sort: (parsedSort.get(pk.key) ?? 0) + 1 });
    }
  }

  const chaptersUpdated: ChapterDiffUpdate[] = [];
  const chaptersAdded: ChapterDiffAdd[] = [];
  const chaptersRemoved: ChapterDiffRemove[] = [];

  for (const c of chapters) {
    const pc = parsedChById.get(c.id);
    if (!pc) {
      chaptersRemoved.push({ id: c.id, name: c.name, siyuanBlockId: c.siyuanBlockId ?? null });
      continue;
    }
    const nameChanged = pc.name !== c.name;
    // 父章变更判定（N 级通用）：现父 = c.parentId，解析父 = pc.parentKey（id:/new/none 三态）
    const parentCh = pc.parentKey !== null ? tree.chapters.find((x) => x.key === pc.parentKey) : null;
    const newParent = parentCh ? (parentCh.id !== null ? `id:${parentCh.id}` : "new") : "none";
    const curParent = c.parentId === null ? "none" : `id:${c.parentId}`;
    const parentChanged = curParent !== newParent;
    if (!nameChanged && !parentChanged) continue;
    const entry: ChapterDiffUpdate = { id: c.id, sort: (parsedChSort.get(pc.key) ?? 0) + 1 };
    if (nameChanged) entry.name = pc.name;
    if (parentChanged) entry.parentKey = pc.parentKey;
    chaptersUpdated.push(entry);
  }
  for (const pc of tree.chapters) {
    if (pc.id === null) {
      chaptersAdded.push({
        key: pc.key,
        name: pc.name,
        level: pc.level,
        parentKey: pc.parentKey,
        sort: (parsedChSort.get(pc.key) ?? 0) + 1,
      });
    }
  }

  return { updated, added, removed, unchangedKps, chaptersUpdated, chaptersAdded, chaptersRemoved };
}

function maxId(list: { id: number }[]): number {
  return list.reduce((m, x) => Math.max(m, x.id), 0);
}

/** 归属节点的展示名：存节点名（与 nodeExtract 口径一致，N 级通用；未归章/已删节点为空） */
function chapterNameOf(chapterId: number | null, chapters: Chapter[]): string {
  if (chapterId === null) return "";
  return chapters.find((c) => c.id === chapterId)?.name ?? "";
}

export function applyKpTreeDiff(data: AppData, courseId: number, tree: ParsedKpTree, diff: KpTreeDiff): AppData {
  // 章节 key → id（标记章节保留原 id；新增章节按文件顺序分配新 id）
  const chKeyToId = new Map<string, number>();
  for (const c of tree.chapters) if (c.id !== null) chKeyToId.set(c.key, c.id);
  let nextChId = maxId(data.chapters) + 1;
  for (const add of diff.chaptersAdded) {
    const id = nextChId++;
    chKeyToId.set(add.key, id);
  }

  const chapters: Chapter[] = data.chapters.filter((c) => !diff.chaptersRemoved.some((r) => r.id === c.id)).map((c) => {
    if (c.courseId !== courseId) return c;
    const up = diff.chaptersUpdated.find((u) => u.id === c.id);
    if (!up) return c;
    return {
      ...c,
      name: up.name ?? c.name,
      parentId: up.parentKey === undefined ? c.parentId : up.parentKey === null ? null : chKeyToId.get(up.parentKey) ?? null,
      sort: up.sort,
    };
  });
  for (const add of diff.chaptersAdded) {
    chapters.push({
      id: chKeyToId.get(add.key)!,
      courseId,
      parentId: add.parentKey === null ? null : chKeyToId.get(add.parentKey) ?? null,
      siyuanBlockId: null,
      name: add.name,
      level: 1, // 占位，下方按父链深度统一校正
      sort: add.sort,
    });
  }
  // level = 父链深度（根 1）：新增章与换父章统一重算（文件序父先于子，最终列表中父链完整）
  const chainDepth = (id: number): number => {
    let cur: Chapter | undefined = chapters.find((c) => c.id === id);
    let depth = 0;
    let guard = 0;
    while (cur && guard++ < 16) {
      depth++;
      const parentId = cur.parentId;
      cur = parentId === null ? undefined : chapters.find((c) => c.id === parentId);
    }
    return depth;
  };
  for (const add of diff.chaptersAdded) {
    const ch = chapters.find((c) => c.id === chKeyToId.get(add.key)!);
    if (ch) ch.level = chainDepth(ch.id);
  }
  for (const up of diff.chaptersUpdated) {
    if (up.parentKey === undefined) continue;
    const ch = chapters.find((c) => c.id === up.id);
    if (ch) ch.level = chainDepth(ch.id);
  }

  // 新增知识点按文件顺序分配新 id
  const addedWithIds = diff.added.map((add, i) => ({ add, id: maxId(data.knowledgePoints) + 1 + i }));

  const now = new Date().toISOString();
  const updatedIds = new Set<number>();
  const addedIds = new Set<number>();

  const knowledgePoints: KnowledgePoint[] = data.knowledgePoints
    .filter((k) => !diff.removed.some((r) => r.id === k.id))
    .map((k) => {
      if (k.courseId !== courseId) return k;
      const up = diff.updated.find((u) => u.id === k.id);
      if (!up) return k;
      updatedIds.add(k.id);
      return {
        ...k,
        name: up.name ?? k.name,
        content: up.content ?? k.content,
        chapterId:
          up.chapterKey === undefined
            ? k.chapterId
            : up.chapterKey === null
              ? null
              : chKeyToId.get(up.chapterKey) ?? null,
        sort: up.sort,
      };
    });
  for (const { add, id } of addedWithIds) {
    addedIds.add(id);
    const chId = add.chapterKey === null ? null : chKeyToId.get(add.chapterKey) ?? null;
    knowledgePoints.push({
      id,
      courseId,
      chapterId: chId,
      blockId: null,
      name: add.name,
      content: add.content,
      mastery: "unlearn",
      sourceAssetIds: "",
      prevKpIds: "",
      chapterName: chapterNameOf(chId, chapters),
      sort: add.sort,
      createTime: now,
    });
  }

  // 刷新受影响的 chapterName：被更新的 KP、新增 KP、以及归属链（自身→顶章）上任一章节被改名（N 级通用）
  const renamedIds = new Set(diff.chaptersUpdated.filter((c) => c.name).map((c) => c.id));
  const finalKps = knowledgePoints.map((k) => {
    if (k.courseId !== courseId) return k;
    let refresh = updatedIds.has(k.id) || addedIds.has(k.id);
    if (!refresh && renamedIds.size > 0 && k.chapterId !== null) {
      let cur: Chapter | undefined = chapters.find((c) => c.id === k.chapterId);
      let guard = 0;
      while (cur && guard++ < 16) {
        if (renamedIds.has(cur.id)) {
          refresh = true;
          break;
        }
        const parentId = cur.parentId;
        cur = parentId === null ? undefined : chapters.find((c) => c.id === parentId);
      }
    }
    if (!refresh) return k;
    return { ...k, chapterName: chapterNameOf(k.chapterId, chapters) };
  });

  return { ...data, chapters, knowledgePoints: finalKps };
}
