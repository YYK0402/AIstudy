// 知识点锚点区 ↔ 思源文档双向同步（核心纯函数 + 写回/读回管道）
//
// 文档格式：章/节文档、课程顶层文档末尾追加锚点区，区是应用数据镜像
// （仅本节点直属 KP、sort 序、与 md 往返 KP 行逐行一致）；锚点外内容永不触碰。
import type { Chapter, Course, DocRegionState, KnowledgePoint } from "../types/appData";
import { applyKpTreeDiff, computeKpTreeDiff, effectiveNodeOf, parseKpLine } from "../utils/kpTreeImport";
import type { KpTreeDiff, ParsedChapter, ParsedKp, ParsedKpTree } from "../utils/kpTreeImport";
import { MASTERY_LABEL } from "../utils/kpTreeExport";
import { parseKpPrevIds } from "./format";
import { createDoc, docsEnabled, ensureFolder, removeDocIfExists } from "./docStore";
import { sanitizeDocSegment } from "../utils/docPath";
import { getData, saveData } from "./storage";
import { getSettings } from "./settings";
import { getBridge } from "@/bridge";

// ---------- 区常量与规范哈希 ----------

export const KP_REGION_BEGIN = "<!-- ai-study:kps:begin -->";
export const KP_REGION_END = "<!-- ai-study:kps:end -->";

/** 章/课程文档顶部说明（幂等标记注释 + 可见引用块；插在标题行之后） */
export const DOC_NOTE_MARKER = "<!-- ai-study:doc-note -->";
const DOC_NOTE_TEXT = [
  "> 本文档末尾的知识点区由 AI 智能学习插件自动维护（应用数据镜像）。",
  "> 区内知识点名称/内容可直接编辑，回插件页点「从思源同步」合并；整区删除或改动锚点标记将停写本文档。区外手写内容不受影响，掌握度、题目、闪卡、复习排期等学习记录也不因同步改动。",
].join("\n");
export const DOC_NOTE = `${DOC_NOTE_MARKER}\n${DOC_NOTE_TEXT}`;

/** 确保文档顶部说明存在（标记在 = 原样返回）；插在首个标题行之后，无标题则置顶 */
export function ensureDocNote(md: string): string {
  if (md.includes(DOC_NOTE_MARKER)) return md;
  const lines = md.split("\n");
  if (lines[0]?.startsWith("# ")) {
    const rest = lines.slice(1).join("\n").replace(/^\n+/, "");
    return rest ? `${lines[0]}\n\n${DOC_NOTE}\n\n${rest}` : `${lines[0]}\n\n${DOC_NOTE}`;
  }
  const rest = md.replace(/^\n+/, "");
  return rest ? `${DOC_NOTE}\n\n${rest}` : DOC_NOTE;
}

/** djb2 哈希（32 位 hex）；用于区变更检测，非密码学用途 */
export function djb2Hex(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  }
  return h.toString(16);
}

/** 区内一个条目（带标记或无标记） */
export interface RegionEntry {
  id: number | null;
  name: string;
  content: string;
}

/** 区规范串：条目按序 `id|name|content` 拼接（无标记 = `new`）。
 *  空白/缩进/空行格式差异不改变规范串；内容、名称、行序、增删行（含无标记）都改变 */
export function canonicalRegion(entries: RegionEntry[]): string {
  return entries.map((e) => `${e.id ?? "new"}|${e.name}|${e.content}`).join("\n");
}

// ---------- 渲染与解析 ----------

/** 渲染 KP 列表为锚点区（含锚点）：sort 序，与 md 往返 KP 行逐行一致 */
export function renderKpRegion(kps: KnowledgePoint[]): string {
  const lines: string[] = [KP_REGION_BEGIN];
  for (const k of [...kps].sort((a, b) => a.sort - b.sort)) {
    lines.push(`- ${k.name} ${MASTERY_LABEL[k.mastery]} <!-- kp:${k.id} -->`);
    if (k.content) {
      for (const l of k.content.split("\n")) lines.push(l === "" ? "" : `  ${l}`);
    }
  }
  lines.push(KP_REGION_END);
  return lines.join("\n");
}

interface ParsedRegionKp {
  id: number | null;
  name: string;
  content: string;
}

export interface ParsedRegion {
  /** 存在闭合区（两锚点齐全且 begin 在 end 前）；锚点未闭合 = 视为无区 */
  hasRegion: boolean;
  /** 区内条目（带标记 + 无标记，按文档序）；区内的非 bullet 自由文本行不计入条目 */
  kps: ParsedRegionKp[];
  /** 区条目规范哈希；"" = 无区 */
  hash: string;
}

/** 解析文档中的知识点锚点区（内容行规则与 md 树解析一致：空行 / 2 空格缩进，尾部空行丢弃） */
export function parseKpRegion(md: string): ParsedRegion {
  const beginIdx = md.indexOf(KP_REGION_BEGIN);
  const endIdx = md.indexOf(KP_REGION_END);
  if (beginIdx < 0 || endIdx < 0 || endIdx <= beginIdx) {
    return { hasRegion: false, kps: [], hash: "" };
  }
  const body = md.slice(beginIdx + KP_REGION_BEGIN.length, endIdx).replace(/\r\n/g, "\n");
  const kps: ParsedRegionKp[] = [];
  let current: ParsedRegionKp | null = null;
  const buf: string[] = [];
  const finalize = (): void => {
    if (current) {
      while (buf.length > 0 && buf[buf.length - 1] === "") buf.pop();
      current.content = buf.join("\n");
      kps.push(current);
    }
    buf.length = 0;
    current = null;
  };
  for (const raw of body.split("\n")) {
    if (current !== null && (raw.trim() === "" || /^\s/.test(raw))) {
      buf.push(raw.trim() === "" ? "" : raw.replace(/^ {2}/, "").replace(/^\t/, ""));
      continue;
    }
    finalize();
    if (raw.trim() === "" || !raw.startsWith("- ")) continue;
    const { name, id } = parseKpLine(raw.slice(2));
    current = { id, name, content: "" };
  }
  finalize();
  return { hasRegion: true, kps, hash: djb2Hex(canonicalRegion(kps)) };
}

// ---------- 合并与写回判定 ----------

/** 定位文档锚点区：返回锚点外前缀/后缀（替换时锚点外字节级保留） */
export function extractRegionInfo(md: string): { hasRegion: boolean; before: string; after: string } {
  const beginIdx = md.indexOf(KP_REGION_BEGIN);
  const endIdx = md.indexOf(KP_REGION_END);
  if (beginIdx < 0 || endIdx < 0 || endIdx <= beginIdx) {
    return { hasRegion: false, before: md, after: "" };
  }
  return {
    hasRegion: true,
    before: md.slice(0, beginIdx),
    after: md.slice(endIdx + KP_REGION_END.length),
  };
}

/** 新区合并进旧文档：有区 → 替换区（锚点外保留）；无区 → 文末追加（\n\n 分隔） */
export function mergeKpRegion(oldMd: string, newRegion: string): string {
  const info = extractRegionInfo(oldMd);
  if (info.hasRegion) {
    return info.before + newRegion + info.after;
  }
  const base = oldMd.trimEnd();
  return `${base ? base + "\n\n" : ""}${newRegion}\n`;
}

// ---------- 相关知识点区（块引用，点亮思源反链/关系图） ----------

export const RELATED_REGION_BEGIN = "<!-- ai-study:related:begin -->";
export const RELATED_REGION_END = "<!-- ai-study:related:end -->";

/**
 * 渲染指定文档的「相关知识点」整块（null = 不写区）：
 * 本文档直属 KP 的 prevKpIds 前置 → 目标 KP 所在文档（nodeDocTarget 口径）写块引用。
 * 跳过：同文档目标（自引用）、未落库章节（docId 为空）、重复 (文档, KP)；名称内双引号转全角防引用语法断裂
 */
export function renderRelatedSection(
  course: Course,
  chapters: Chapter[],
  docKps: KnowledgePoint[],
  allKps: KnowledgePoint[],
  selfDocId: string | null,
): string | null {
  const byId = new Map(allKps.map((k) => [k.id, k]));
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const k of docKps) {
    for (const prevId of parseKpPrevIds(k)) {
      const t = byId.get(prevId);
      if (!t) continue;
      const tDocId = nodeDocTarget(course, chapters, effectiveNodeOf(t, chapters)).docId;
      if (!tDocId || tDocId === selfDocId) continue;
      const key = `${tDocId}:${t.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(`- ((${tDocId} "${t.name.replace(/"/g, "”")}"))`);
    }
  }
  if (lines.length === 0) return null;
  return [RELATED_REGION_BEGIN, "## 相关知识点", "", ...lines, RELATED_REGION_END].join("\n");
}

/** 提取文档中的相关知识点整块（含标题与锚点；null = 无区或锚点未闭合） */
export function extractRelatedSection(md: string): string | null {
  const beginIdx = md.indexOf(RELATED_REGION_BEGIN);
  const endIdx = md.indexOf(RELATED_REGION_END);
  if (beginIdx < 0 || endIdx < 0 || endIdx <= beginIdx) return null;
  return md.slice(beginIdx, endIdx + RELATED_REGION_END.length);
}

/** 相关区合并：有区 → 整块替换；无区且 block 非空 → 文末追加；block 为 null → 删除旧区（区由应用全权生成，用户手改会在下次写回时覆盖） */
export function mergeRelatedSection(md: string, block: string | null): string {
  const beginIdx = md.indexOf(RELATED_REGION_BEGIN);
  const endIdx = md.indexOf(RELATED_REGION_END);
  const hasBlock = beginIdx >= 0 && endIdx > beginIdx;
  if (hasBlock) {
    const before = md.slice(0, beginIdx);
    const after = md.slice(endIdx + RELATED_REGION_END.length);
    if (!block) return (before.replace(/\n+$/, "") + "\n" + after.replace(/^\n+/, "")).trimEnd() + "\n";
    return before.trimEnd() + "\n\n" + block + "\n" + after.replace(/^\n+/, "");
  }
  if (!block) return md;
  const base = md.trimEnd();
  return `${base ? base + "\n\n" : ""}${block}\n`;
}

export type RegionWriteDecision =
  | { action: "write" }
  | { action: "skip" }
  | { action: "stop"; reason: "user-modified" | "region-deleted" | "state-missing" };

/**
 * 依据「存储的最后写入态 + 文档当前区状态」判定写回策略（停写检测核心）：
 * 比对基准是「本应用最后写入的状态」而非「应用当前状态」——应用领先（改过还没写）不误报；
 * 用户只动空白/空行时规范哈希不变也不误报（写回时顺带规范化）。
 */
export function decideRegionWrite(opts: {
  hasStored: boolean;
  storedHash: string | null;
  /** "" = 文档无（闭合）区 */
  regionHash: string;
  renderedHash: string;
}): RegionWriteDecision {
  if (opts.regionHash === "") {
    if (opts.hasStored) return { action: "stop", reason: "region-deleted" };
    return { action: "write" };
  }
  if (!opts.hasStored) return { action: "stop", reason: "state-missing" };
  if (opts.regionHash !== (opts.storedHash ?? "")) return { action: "stop", reason: "user-modified" };
  if (opts.renderedHash === opts.storedHash) return { action: "skip" };
  return { action: "write" };
}

// ---------- 读回组树（纯函数） ----------

export interface SiyuanSyncBuildInput {
  course: Course;
  /** 本课程全部章节（含 unit） */
  chapters: Chapter[];
  /** 本课程全部知识点 */
  kps: KnowledgePoint[];
  docRegions: Record<string, DocRegionState>;
  /** docId → 文档 markdown；null = 文档已删除（docId 为 null 的节点不在此 Map） */
  docs: Map<string, string | null>;
}

export interface SiyuanSyncBuild {
  tree: ParsedKpTree;
  /** 文档已不存在（用户删除）的文档数（计入提示，不清空该节点 KP） */
  deletedDocs: number;
  /** 文档未落库或尚无知识点的区（历史）的文档数 */
  historicalDocs: number;
  /** 应用侧待写 KP 保留数（id ∉ 存储 ids 并集，确认后合并回区写回） */
  retained: number;
}

/** 读回组装 ParsedKpTree：chapters 全部带标记（读回不产生章节结构变更）；
 *  kps 按文档/区状态分流（见 spec §3 安全规则表） */
export function buildSiyuanParsedTree(input: SiyuanSyncBuildInput): SiyuanSyncBuild {
  const { course, chapters, kps, docRegions, docs } = input;

  const treeChapters: ParsedChapter[] = [...chapters]
    .sort((a, b) => a.sort - b.sort)
    .map((c) => ({
      key: `id:${c.id}`,
      id: c.id,
      name: c.name,
      level: c.level,
      parentKey: c.level === 2 && c.parentId !== null ? `id:${c.parentId}` : null,
      sort: c.sort,
    }));

  // 存储 ids 并集（跨全部文档）：区分「应用待写」与「用户删除」
  const unionStoredIds = new Set<number>();
  for (const s of Object.values(docRegions)) {
    for (const id of s.ids) unionStoredIds.add(id);
  }

  const nodeOrder: Array<{ node: number | null; key: string | null }> = [
    ...[...chapters]
      .sort((a, b) => a.sort - b.sort)
      .map((c) => ({ node: c.id as number | null, key: `id:${c.id}` as string | null })),
    { node: null, key: null },
  ];

  const treeKps: ParsedKp[] = [];
  const injectKept = (list: KnowledgePoint[], key: string | null): void => {
    for (const k of list) {
      treeKps.push({ key: `id:${k.id}`, id: k.id, name: k.name, content: k.content, chapterKey: key, sort: treeKps.length });
    }
  };

  let deletedDocs = 0;
  let historicalDocs = 0;
  let retained = 0;
  let newCounter = 0;

  for (const { node, key } of nodeOrder) {
    const docId = node === null ? course.siyuanDocId : chapters.find((c) => c.id === node)?.siyuanBlockId ?? null;
    const nodeKps = kps.filter((k) => effectiveNodeOf(k, chapters) === node).sort((a, b) => a.sort - b.sort);
    if (docId === null) {
      historicalDocs++;
      injectKept(nodeKps, key);
      continue;
    }
    const md = docs.get(docId) ?? null;
    if (md === null) {
      deletedDocs++;
      injectKept(nodeKps, key);
      continue;
    }
    const region = parseKpRegion(md);
    const stored = docRegions[docId];
    if (!region.hasRegion) {
      if (stored !== undefined) {
        // 用户删了整个区 → 不注入，全章 KP 进删除预览（确认才执行）
      } else {
        historicalDocs++;
        injectKept(nodeKps, key);
      }
      continue;
    }
    const markedIds = new Set<number>();
    for (const e of region.kps) {
      if (e.id !== null) {
        markedIds.add(e.id);
        treeKps.push({ key: `id:${e.id}`, id: e.id, name: e.name, content: e.content, chapterKey: key, sort: treeKps.length });
      } else {
        treeKps.push({ key: `new:${newCounter++}`, id: null, name: e.name, content: e.content, chapterKey: key, sort: treeKps.length });
      }
    }
    for (const k of nodeKps) {
      if (markedIds.has(k.id)) continue;
      if (unionStoredIds.has(k.id)) continue; // 上次写入时在区里、现被用户删 → 进删除预览
      retained++;
      treeKps.push({ key: `id:${k.id}`, id: k.id, name: k.name, content: k.content, chapterKey: key, sort: treeKps.length });
    }
  }

  return {
    tree: { importable: true, courseId: course.id, courseName: course.name, chapters: treeChapters, kps: treeKps },
    deletedDocs,
    historicalDocs,
    retained,
  };
}

// ---------- 写回管道（应用 → 思源） ----------

export interface NodeDocTarget {
  docId: string | null;
  /** 补建/自愈重建用的文档路径 */
  path: string;
  parentID: string | null;
  /** 文档首行标题（# 名称） */
  titleLine: string;
  /** 展示名（toast 用） */
  label: string;
}

/** 节点区域目标文档：null = 课程顶层文档；章/节 = siyuanBlockId 文档；幽灵节点回退课程文档 */
export function nodeDocTarget(course: Course, chapters: Chapter[], node: number | null): NodeDocTarget {
  // 路径段逐段转全角斜杠：名内含 / 时防内核按分隔符建出幽灵层级（标题/展示名保持原样）
  const cp = sanitizeDocSegment(course.name);
  if (node === null) {
    return { docId: course.siyuanDocId, path: `/${cp}`, parentID: null, titleLine: `# ${course.name}`, label: course.name };
  }
  const ch = chapters.find((c) => c.id === node);
  if (!ch) return nodeDocTarget(course, chapters, null);
  if (ch.level === 1 || ch.parentId === null) {
    return {
      docId: ch.siyuanBlockId,
      path: `/${cp}/${sanitizeDocSegment(ch.name)}`,
      parentID: course.siyuanDocId,
      titleLine: `# ${ch.name}`,
      label: ch.name,
    };
  }
  const parent = ch.parentId !== null ? chapters.find((c) => c.id === ch.parentId) : null;
  return {
    docId: ch.siyuanBlockId,
    path: parent ? `/${cp}/${sanitizeDocSegment(parent.name)}/${sanitizeDocSegment(ch.name)}` : `/${cp}/${sanitizeDocSegment(ch.name)}`,
    parentID: parent?.siyuanBlockId ?? course.siyuanDocId,
    titleLine: `# ${ch.name}`,
    label: parent ? `${parent.name} · ${ch.name}` : ch.name,
  };
}

/** 写回管道是否可用（非思源宿主短路；persistToSiyuan 在执行段内按最新设置检查） */
export function kpRegionSyncEnabled(): boolean {
  return docsEnabled();
}

// 每文档防抖合并 + 串行队列（storage.ts saveChain / siyuanSync.ts convSyncChains 同款）：
// 同章连续多次操作只写一次；同文档串行避免并发读旧文→各自合并→后写覆盖先写
const kpSyncTimers = new Map<string, ReturnType<typeof setTimeout>>();
const kpSyncChains = new Map<string, Promise<unknown>>();

function nodeKeyOf(courseId: number, node: number | null): string {
  return `${courseId}:${node === null ? "course" : node}`;
}

/** 调度单节点区域写回（node=null → 课程文档）。fire-and-forget：失败仅 toast，不阻塞 */
export function scheduleKpRegionSync(courseId: number, node: number | null, delay = 500): void {
  if (!kpRegionSyncEnabled()) return;
  const key = nodeKeyOf(courseId, node);
  const prev = kpSyncTimers.get(key);
  if (prev) clearTimeout(prev);
  kpSyncTimers.set(
    key,
    setTimeout(() => {
      kpSyncTimers.delete(key);
      const run = (kpSyncChains.get(key) ?? Promise.resolve()).then(() => doNodeSync(courseId, node));
      kpSyncChains.set(key, run.catch(() => undefined));
    }, delay),
  );
}

/**
 * 确保课程顶层文档存在（章文档写回竞态自愈）：挂课程级串行链
 * （与 node=null 同步同 key，同一文档不并发写），防止多个并行章同步各自创建重复课程文档。
 * 内部自愈不弹 toast；返回最终 siyuanDocId（null = 课程不存在；创建失败直接抛出，由调用方原逻辑报错）
 */
async function ensureCourseDoc(courseId: number, notebookName: string): Promise<string | null> {
  const key = nodeKeyOf(courseId, null);
  const run = (kpSyncChains.get(key) ?? Promise.resolve()).then(async (): Promise<string | null> => {
    const data = await getData();
    const course = data.courses.find((c) => c.id === courseId);
    if (!course) return null;
    if (course.siyuanDocId) return course.siyuanDocId;
    const notebook = await ensureFolder(notebookName);
    const { id } = await createDoc(`# ${course.name}`, `/${sanitizeDocSegment(course.name)}`, notebook, null);
    course.siyuanDocId = id;
    await saveData(data);
    return id;
  });
  kpSyncChains.set(key, run.catch(() => undefined));
  return run;
}

async function doNodeSync(courseId: number, node: number | null): Promise<void> {
  try {
    let data = await getData();
    const settings = await getSettings();
    if (!settings.persistToSiyuan) return;
    const course = data.courses.find((c) => c.id === courseId);
    if (!course) return;
    let chapters = data.chapters.filter((c) => c.courseId === courseId);
    const target = nodeDocTarget(course, chapters, node);
    const kps = data.knowledgePoints.filter(
      (k) => k.courseId === courseId && effectiveNodeOf(k, chapters) === node,
    );
    const label = node === null ? `课程「${course.name}」` : `章节「${target.label}」`;
    const region = renderKpRegion(kps);
    // 渲染态哈希必须与「实际写入区的解析哈希」同源（renderKpRegion 内部按 sort 排序，
    // 直接对未排序 kps 算 canonicalRegion 会因顺序不同永不匹配 → 恒停写误报）
    const renderedHash = parseKpRegion(region).hash;
    const bridge = getBridge();

    const docId = target.docId;
    const courseKps = data.knowledgePoints.filter((k) => k.courseId === courseId);
    const related = renderRelatedSection(course, chapters, kps, courseKps, docId);
    const assignDocId = (id: string): void => {
      if (node === null) course.siyuanDocId = id;
      else {
        const ch = chapters.find((c) => c.id === node);
        if (ch) ch.siyuanBlockId = id;
      }
    };
    // 补建/重建文档并回填数据 id；返回新 docId（闭包内改外层变量 TS 不收窄，直接返回）
    const createFresh = async (): Promise<string> => {
      const notebook = await ensureFolder(settings.notebookName);
      const body = `${ensureDocNote(target.titleLine)}\n\n${region}${related ? `\n\n${related}` : ""}`;
      const { id } = await createDoc(body, target.path, notebook, target.parentID);
      assignDocId(id);
      return id;
    };

    if (!docId) {
      // 写回竞态自愈：章文档缺失但课程顶层文档也缺失 → 先经课程级串行链确保课程文档存在
      //（防并行章同步重复创建），再从最新数据重新查找 course/刷新 chapters 引用（跨宿主防御：
      // fnos 端 getData 返回新对象，也避免旧对象 saveData 覆盖刚回填的课程 docId）
      if (node !== null && course.siyuanDocId === null) {
        await ensureCourseDoc(courseId, settings.notebookName);
        const fresh = await getData();
        const freshCourse = fresh.courses.find((c) => c.id === courseId);
        if (!freshCourse) return;
        data = fresh;
        chapters = fresh.chapters.filter((c) => c.courseId === courseId);
        const ch = chapters.find((c) => c.id === node);
        if (!ch) return; // 幽灵节点（章已删）：目标回退课程文档且已确保存在，无可建内容
        if (ch.level === 1 || ch.parentId === null) {
          target.parentID = freshCourse.siyuanDocId; // 顶章父文档；unit 级保持现有 parent 回退
        }
      }
      const newId = await createFresh();
      if (!data.docRegions) data.docRegions = {};
      data.docRegions[newId] = { h: renderedHash, ids: kps.map((k) => k.id) };
      await saveData(data);
      bridge.showMessage(`思源文档曾缺失，已自动补建：${label}`, 3000);
      return;
    }

    const md = await bridge.getDocMarkdown(docId);
    if (md === null) {
      if (await bridge.docExists(docId)) {
        bridge.showMessage(`思源文档读取失败，本次写回跳过：${label}`, 4000, "error");
        return;
      }
      const newId = await createFresh();
      if (!data.docRegions) data.docRegions = {};
      data.docRegions[newId] = { h: renderedHash, ids: kps.map((k) => k.id) };
      await saveData(data);
      bridge.showMessage(`思源文档曾被删除，已自动重建：${label}`, 3000);
      return;
    }

    const parsed = parseKpRegion(md);
    const stored = data.docRegions?.[docId];
    const decision = decideRegionWrite({
      hasStored: stored !== undefined,
      storedHash: stored?.h ?? null,
      regionHash: parsed.hash,
      renderedHash,
    });
    if (decision.action === "stop") {
      const msg =
        decision.reason === "region-deleted"
          ? `思源「${label}」的知识点区已被删除，本次应用侧变更未写入思源。请先用「从思源同步」确认变更`
          : decision.reason === "state-missing"
            ? `思源「${label}」知识点区写入状态缺失，为避免覆盖你的编辑已跳过写回。请用「从思源同步」恢复`
            : `思源「${label}」有未同步编辑，本次应用侧变更未写入思源。请先点「从思源同步」合并`;
      bridge.showMessage(msg, 5000, "error");
      return;
    }
    if (decision.action === "skip" && extractRelatedSection(md) === related) return;

    await bridge.updateDoc(docId, ensureDocNote(mergeRelatedSection(mergeKpRegion(md, region), related)));
    if (!data.docRegions) data.docRegions = {};
    data.docRegions[docId] = { h: renderedHash, ids: kps.map((k) => k.id) };
    await saveData(data);
  } catch (e) {
    console.error("知识点区写回失败:", e);
    getBridge().showMessage(`思源知识点区写回失败：${e instanceof Error ? e.message : "未知错误"}`, 4000, "error");
  }
}

// ---------- 读回管道（思源 → 应用） ----------

export interface SiyuanReadCtxNode {
  node: number | null;
  docId: string | null;
  hadRegion: boolean;
  /** 读时区规范哈希（"" = 无区） */
  regionHash: string;
  /** 读时区带标记条目 id */
  markedIds: number[];
  storedExisted: boolean;
  /** 存储态的 ids（读时快照） */
  storedIds: number[];
  /** 文档含顶部说明（读时） */
  hasNote: boolean;
}

export interface SiyuanReadCtx {
  course: Course;
  chapters: Chapter[];
  nodes: SiyuanReadCtxNode[];
}

export interface SiyuanKpSyncPreview {
  tree: ParsedKpTree;
  diff: KpTreeDiff;
  deletedDocs: number;
  historicalDocs: number;
  /** 无区无状态且应用侧有知识点的历史文档数（确认后批量回填写入区） */
  backfillDocs: number;
  /** 有区但缺顶部说明的文档数（确认后仅插入说明，不动区与状态） */
  noteDocs: number;
  retained: number;
  readCtx: SiyuanReadCtx;
}

/** 读回：读本课程全部文档（课程文档 + 章/节文档）→ 组树 → 计算 diff（不落盘） */
export async function readSiyuanKpSync(courseId: number): Promise<SiyuanKpSyncPreview> {
  const data = await getData();
  const course = data.courses.find((c) => c.id === courseId);
  if (!course) throw new Error("课程不存在，请刷新后重试");
  const chapters = data.chapters.filter((c) => c.courseId === courseId);
  const kps = data.knowledgePoints.filter((k) => k.courseId === courseId);
  const docRegions = data.docRegions ?? {};
  const bridge = getBridge();

  const docTargets: Array<{ node: number | null; docId: string | null }> = [
    ...[...chapters].sort((a, b) => a.sort - b.sort).map((c) => ({ node: c.id as number | null, docId: c.siyuanBlockId })),
    { node: null, docId: course.siyuanDocId },
  ];
  const docs = new Map<string, string | null>();
  for (const t of docTargets) {
    if (t.docId === null || docs.has(t.docId)) continue;
    const md = await bridge.getDocMarkdown(t.docId).catch(() => null);
    docs.set(t.docId, md);
  }

  const built = buildSiyuanParsedTree({ course, chapters, kps, docRegions, docs });
  const diff = computeKpTreeDiff(built.tree, chapters, kps);
  const readCtx: SiyuanReadCtx = {
    course,
    chapters,
    nodes: docTargets.map((t) => {
      const md = t.docId === null ? null : docs.get(t.docId) ?? null;
      const region = t.docId !== null && md !== null ? parseKpRegion(md) : { hasRegion: false, kps: [], hash: "" };
      const stored = t.docId !== null ? docRegions[t.docId] : undefined;
      return {
        node: t.node,
        docId: t.docId,
        hadRegion: region.hasRegion,
        regionHash: region.hash,
        markedIds: region.kps.filter((k) => k.id !== null).map((k) => k.id!),
        storedExisted: stored !== undefined,
        storedIds: stored?.ids ?? [],
        hasNote: md !== null && md.includes(DOC_NOTE_MARKER),
      };
    }),
  };
  // 批量回填对象：无区 + 无写入状态 + 应用侧该节点有知识点（区不存在 = 无编辑可冲突，追加安全）
  const backfillDocs = readCtx.nodes.filter(
    (n) => !n.hadRegion && !n.storedExisted && kps.some((k) => effectiveNodeOf(k, chapters) === n.node),
  ).length;
  // 缺顶部说明对象：有区但文档无说明标记（确认后仅插说明）
  const noteDocs = readCtx.nodes.filter((n) => n.docId !== null && n.hadRegion && !n.hasNote).length;
  return {
    tree: built.tree,
    diff,
    deletedDocs: built.deletedDocs,
    historicalDocs: built.historicalDocs,
    backfillDocs,
    noteDocs,
    retained: built.retained,
    readCtx,
  };
}

/** 确认读回：应用变更落盘 + 刷新/合并各区写入状态 */
export async function applySiyuanKpSync(courseId: number, preview: SiyuanKpSyncPreview): Promise<void> {
  const data = await getData();
  const nextData = applyKpTreeDiff(data, courseId, preview.tree, preview.diff);
  if (!nextData.docRegions) nextData.docRegions = {};

  const oldChapters = data.chapters.filter((c) => c.courseId === courseId);
  const chapters = nextData.chapters.filter((c) => c.courseId === courseId);
  const kpsNow = nextData.knowledgePoints.filter((k) => k.courseId === courseId);

  // 产生 diff 的节点集合（含保留待写 KP 的节点）
  const changedNodes = new Set<string>();
  const mark = (node: number | null): void => {
    changedNodes.add(node === null ? "course" : String(node));
  };
  for (const u of preview.diff.updated) {
    const oldKp = data.knowledgePoints.find((k) => k.id === u.id);
    if (oldKp) mark(effectiveNodeOf(oldKp, oldChapters));
    const newKp = nextData.knowledgePoints.find((k) => k.id === u.id);
    if (newKp) mark(effectiveNodeOf(newKp, chapters));
  }
  for (const r of preview.diff.removed) {
    const oldKp = data.knowledgePoints.find((k) => k.id === r.id);
    if (oldKp) mark(effectiveNodeOf(oldKp, oldChapters));
  }
  for (const a of preview.diff.added) {
    mark(a.chapterKey === null ? null : Number(a.chapterKey.slice(3)));
  }
  // 存在保留待写 KP 的有区节点（这些 KP 没产生 diff，但需合并回区写回）
  const unionStored = new Set(preview.readCtx.nodes.flatMap((n) => n.storedIds));
  const oldKpById = new Map(data.knowledgePoints.map((k) => [k.id, k]));
  for (const n of preview.readCtx.nodes) {
    if (!n.hadRegion || n.docId === null) continue;
    const hasRetained = [...oldKpById.values()].some(
      (k) =>
        k.courseId === courseId &&
        effectiveNodeOf(k, oldChapters) === n.node &&
        !n.markedIds.includes(k.id) &&
        !unionStored.has(k.id),
    );
    if (hasRetained) mark(n.node);
  }

  const settings = await getSettings();
  const canWrite = settings.persistToSiyuan && docsEnabled();
  const bridge = getBridge();
  const writeErrors: string[] = [];

  // 历史文档批量回填（读时无区 + 无写入状态 + 应用侧有 KP）：
  // 区不存在 = 无编辑可冲突，区追加到文档末尾安全；缺失文档补建（与写回管道自愈同口径）。
  let courseDocId: string | null = nextData.courses.find((c) => c.id === courseId)?.siyuanDocId ?? null;
  let notebook: string | null = null;
  const getNotebook = async (): Promise<string | null> => {
    if (notebook) return notebook;
    notebook = await ensureFolder(settings.notebookName).catch((e: unknown) => {
      console.error("笔记本初始化失败:", e);
      return null;
    });
    return notebook;
  };
  // 补建缺失节点文档（unit 先递归补父章/课程文档），回填 id 就地写入（随 nextData 落盘）；
  // regionMd 非空时创建内容即含区（仅回填节点自身传，链上补建的父文档不带区 → 不记状态）
  const ensureNodeDocId = async (node: number | null, regionMd: string | null): Promise<string | null> => {
    // 带区创建的文档同时带顶部说明；链上补建的父文档（无区）不带
    const mdOf = (title: string, region: string | null): string =>
      region ? `${ensureDocNote(title)}\n\n${region}` : title;
    if (node === null) {
      if (courseDocId) return courseDocId;
      const courseRow = nextData.courses.find((c) => c.id === courseId);
      if (!courseRow) return null;
      const nb = await getNotebook();
      if (!nb) return null;
      try {
        const { id } = await createDoc(mdOf(`# ${courseRow.name}`, regionMd), `/${sanitizeDocSegment(courseRow.name)}`, nb, null);
        courseRow.siyuanDocId = id;
        courseDocId = id;
        return id;
      } catch (e) {
        console.error("补建课程顶层文档失败:", e);
        return null;
      }
    }
    const ch = chapters.find((c) => c.id === node);
    if (!ch) return null;
    if (ch.siyuanBlockId) return ch.siyuanBlockId;
    const nb = await getNotebook();
    if (!nb) return null;
    const parentID =
      ch.level === 2 && ch.parentId !== null
        ? await ensureNodeDocId(ch.parentId, null)
        : await ensureNodeDocId(null, null);
    if (!parentID) return null;
    const target = nodeDocTarget(preview.readCtx.course, chapters, node);
    try {
      const { id } = await createDoc(mdOf(`# ${ch.name}`, regionMd), target.path, nb, parentID);
      ch.siyuanBlockId = id;
      return id;
    } catch (e) {
      console.error(`补建章节文档失败：${ch.name}`, e);
      return null;
    }
  };
  const recordRegionState = (docId: string, nodeKps: KnowledgePoint[]): void => {
    // 与写回管道同口径：用渲染区解析哈希（renderKpRegion 内部按 sort 排序）
    nextData.docRegions![docId] = {
      h: parseKpRegion(renderKpRegion(nodeKps)).hash,
      ids: nodeKps.map((k) => k.id),
    };
  };

  for (const n of preview.readCtx.nodes) {
    const nodeKey = n.node === null ? "course" : String(n.node);
    const inChanges = changedNodes.has(nodeKey);
    const nodeKps = kpsNow.filter((k) => effectiveNodeOf(k, chapters) === n.node);
    const isBackfill = !n.hadRegion && !n.storedExisted && nodeKps.length > 0;
    // 有区但缺顶部说明（确认后仅插说明；变更节点走下方合并写回顺带补）
    const needNote = n.hadRegion && !n.hasNote;

    if (inChanges && !n.hadRegion && n.storedExisted && n.docId !== null) {
      // 用户删了整个区并确认全章删除 → 删除状态条目（此后按历史文档处理，避免停写死循环）
      delete nextData.docRegions![n.docId];
      continue;
    }
    if (!inChanges && !isBackfill && !needNote) continue;
    if (!canWrite) continue;
    const label = nodeDocTarget(preview.readCtx.course, preview.readCtx.chapters, n.node).label;

    if (isBackfill) {
      const region = renderKpRegion(nodeKps);
      if (n.docId === null) {
        const newId = await ensureNodeDocId(n.node, region);
        if (newId === null) writeErrors.push(label);
        else recordRegionState(newId, nodeKps); // 补建内容即含区（见 ensureNodeDocId）
        continue;
      }
      const freshMd = await bridge.getDocMarkdown(n.docId).catch(() => null);
      if (freshMd === null) {
        // 期间文档被删 → 补建自愈（含区）
        const newId = await ensureNodeDocId(n.node, region);
        if (newId === null) writeErrors.push(label);
        else recordRegionState(newId, nodeKps);
        continue;
      }
      if (parseKpRegion(freshMd).hasRegion) continue; // 期间出现区（他人写入）：不覆盖，交由写回管道停写检测
      try {
        await bridge.updateDoc(n.docId, ensureDocNote(mergeKpRegion(freshMd, renderKpRegion(nodeKps))));
        recordRegionState(n.docId, nodeKps);
      } catch (e) {
        console.error("知识点区回填失败:", e);
        writeErrors.push(label);
      }
      continue;
    }

    if (n.docId === null) continue;

    if (needNote && !inChanges) {
      // 仅补顶部说明：区与写入状态不动
      const freshMd = await bridge.getDocMarkdown(n.docId).catch(() => null);
      if (freshMd === null || freshMd.includes(DOC_NOTE_MARKER)) continue;
      if (!parseKpRegion(freshMd).hasRegion) continue; // 期间区被删：不动，交由停写检测
      try {
        await bridge.updateDoc(n.docId, ensureDocNote(freshMd));
      } catch (e) {
        console.error("补顶部说明失败:", e);
        writeErrors.push(label);
      }
      continue;
    }

    const region = renderKpRegion(nodeKps);
    const freshMd = await bridge.getDocMarkdown(n.docId).catch(() => null);
    if (freshMd === null) continue; // 期间文档被删：跳过写回，下次写回自愈重建
    const freshRegion = parseKpRegion(freshMd);
    if (freshRegion.hasRegion && freshRegion.hash !== n.regionHash) {
      continue; // 期间区又有新编辑：不覆盖，保留读时状态（下次写回停写提示）
    }
    try {
      await bridge.updateDoc(n.docId, ensureDocNote(mergeKpRegion(freshMd, region)));
      nextData.docRegions![n.docId] = { h: parseKpRegion(region).hash, ids: nodeKps.map((k) => k.id) };
    } catch (e) {
      console.error("知识点区合并写回失败:", e);
      writeErrors.push(label);
    }
  }

  await saveData(nextData);
  if (writeErrors.length) {
    bridge.showMessage(
      `思源同步数据已保存，但以下知识点区写回失败：${writeErrors.join("、")}`,
      5000,
      "error",
    );
  }
}

// ---------- md 导入的章文档操作 ----------

/**
 * md 导入确认后同步思源章文档：删（removeDoc 级联 + 清 docRegions）→ 补建课程文档 →
 * 新建（createDoc + 回填 siyuanBlockId）→ 改名/换父（renameDoc/moveDoc）。
 * fire-and-forget 语义的「聚合版」：await 完成 + 聚合 toast，不抛异常。
 */
export async function syncChapterStructure(courseId: number, diff: KpTreeDiff, addedChapters: Chapter[]): Promise<void> {
  if (!kpRegionSyncEnabled()) return;
  const data = await getData();
  const settings = await getSettings();
  if (!settings.persistToSiyuan) return;
  const course = data.courses.find((c) => c.id === courseId);
  if (!course) return;
  const errors: string[] = [];
  const bridge = getBridge();
  const notebook = await ensureFolder(settings.notebookName).catch((e: unknown) => {
    console.error("笔记本初始化失败:", e);
    return null;
  });
  if (!notebook) return;

  // 1. 删除（级联幂等）+ 清 docRegions 状态
  // 真实导入流程先 applyKpTreeDiff 再调本函数：被删章已不在 data.chapters，
  // 优先用现存对象的 blockId，查不到时回退 diff 计算时的快照
  for (const r of diff.chaptersRemoved) {
    const ch = data.chapters.find((c) => c.id === r.id);
    const docId = ch?.siyuanBlockId ?? r.siyuanBlockId;
    if (docId) {
      await removeDocIfExists(docId).catch((e) => {
        console.error("删除思源章节文档失败:", e);
        errors.push(`章节「${r.name}」文档删除失败`);
      });
      if (data.docRegions) delete data.docRegions[docId];
    }
  }

  // 2. 惰性补建课程顶层文档（课程包导入/开持久化前创建的课程）
  if (!course.siyuanDocId) {
    try {
      const { id } = await createDoc(`# ${course.name}`, `/${sanitizeDocSegment(course.name)}`, notebook, null);
      course.siyuanDocId = id;
    } catch (e) {
      console.error("创建课程顶层文档失败:", e);
      errors.push(`课程「${course.name}」顶层文档创建失败`);
    }
  }

  // 3. 新建章节（文件序：顶章先于节 → 节的 parentID 可解析；
  //    新建章可能尚未进入 data.chapters（宿主引用语义），回退到 addedChapters 解析）
  for (const ch of addedChapters) {
    const parent =
      ch.parentId !== null
        ? data.chapters.find((c) => c.id === ch.parentId) ?? addedChapters.find((c) => c.id === ch.parentId)
        : null;
    const path = parent
      ? `/${sanitizeDocSegment(course.name)}/${sanitizeDocSegment(parent.name)}/${sanitizeDocSegment(ch.name)}`
      : `/${sanitizeDocSegment(course.name)}/${sanitizeDocSegment(ch.name)}`;
    const parentID = parent?.siyuanBlockId ?? course.siyuanDocId;
    try {
      const { id } = await createDoc(`# ${ch.name}`, path, notebook, parentID);
      ch.siyuanBlockId = id;
    } catch (e) {
      console.error("创建思源章节文档失败:", e);
      errors.push(`章节「${ch.name}」文档创建失败`);
    }
  }

  // 4. 改名 / 换父
  for (const u of diff.chaptersUpdated) {
    const ch = data.chapters.find((c) => c.id === u.id);
    if (!ch?.siyuanBlockId) continue;
    if (u.name !== undefined && u.name !== ch.name) {
      await bridge.renameDoc(ch.siyuanBlockId, sanitizeDocSegment(u.name)).catch((e) => {
        console.error("同步章节改名失败:", e);
        errors.push(`章节「${u.name}」改名失败`);
      });
    }
    const parentKey = u.parentKey;
    if (parentKey !== undefined) {
      let targetDocId: string | null = null;
      if (parentKey === null) targetDocId = course.siyuanDocId;
      else if (parentKey.startsWith("id:")) {
        targetDocId = data.chapters.find((c) => c.id === Number(parentKey.slice(3)))?.siyuanBlockId ?? null;
      } else {
        const i = diff.chaptersAdded.findIndex((a) => a.key === parentKey);
        targetDocId = addedChapters[i]?.siyuanBlockId ?? null;
      }
      if (targetDocId && targetDocId !== ch.siyuanBlockId) {
        await bridge.moveDoc(ch.siyuanBlockId, targetDocId).catch((e) => {
          console.error("同步章节移动失败:", e);
          errors.push(`章节「${ch.name}」移动失败`);
        });
      }
    }
  }

  await saveData(data);
  if (errors.length) {
    bridge.showMessage(`知识点树导入成功，但思源文档树未完全同步：${errors.join("；")}`, 5000, "error");
  }
}
