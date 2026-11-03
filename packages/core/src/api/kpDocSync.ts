// 知识点锚点区 ↔ 思源文档双向同步（核心纯函数 + 写回/读回管道）
//
// 文档格式：章/节文档、课程顶层文档末尾追加锚点区，区是应用数据镜像
// （仅本节点直属 KP、sort 序、与 md 往返 KP 行逐行一致）；锚点外内容永不触碰。
import type { Chapter, Course, DocRegionState, KnowledgePoint } from "../types/appData";
import { applyKpTreeDiff, computeKpTreeDiff, effectiveNodeOf, parseKpLine } from "../utils/kpTreeImport";
import type { KpTreeDiff, ParsedChapter, ParsedKp, ParsedKpTree } from "../utils/kpTreeImport";
import { MASTERY_LABEL } from "../utils/kpTreeExport";
import { createDoc, docsEnabled, ensureFolder } from "./docStore";
import { getData, saveData } from "./storage";
import { getSettings } from "./settings";
import { getBridge } from "@/bridge";

// ---------- 区常量与规范哈希 ----------

export const KP_REGION_BEGIN = "<!-- ai-study:kps:begin -->";
export const KP_REGION_END = "<!-- ai-study:kps:end -->";

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
      parentKey: c.level === "unit" && c.parentId !== null ? `id:${c.parentId}` : null,
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
  if (node === null) {
    return { docId: course.siyuanDocId, path: `/${course.name}`, parentID: null, titleLine: `# ${course.name}`, label: course.name };
  }
  const ch = chapters.find((c) => c.id === node);
  if (!ch) return nodeDocTarget(course, chapters, null);
  if (ch.level === "chapter" || ch.parentId === null) {
    return {
      docId: ch.siyuanBlockId,
      path: `/${course.name}/${ch.name}`,
      parentID: course.siyuanDocId,
      titleLine: `# ${ch.name}`,
      label: ch.name,
    };
  }
  const parent = ch.parentId !== null ? chapters.find((c) => c.id === ch.parentId) : null;
  return {
    docId: ch.siyuanBlockId,
    path: parent ? `/${course.name}/${parent.name}/${ch.name}` : `/${course.name}/${ch.name}`,
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

async function doNodeSync(courseId: number, node: number | null): Promise<void> {
  try {
    const data = await getData();
    const settings = await getSettings();
    if (!settings.persistToSiyuan) return;
    const course = data.courses.find((c) => c.id === courseId);
    if (!course) return;
    const chapters = data.chapters.filter((c) => c.courseId === courseId);
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
      const { id } = await createDoc(`${target.titleLine}\n\n${region}`, target.path, notebook, target.parentID);
      assignDocId(id);
      return id;
    };

    if (!docId) {
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
    if (decision.action === "skip") return;

    await bridge.updateDoc(docId, mergeKpRegion(md, region));
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
      };
    }),
  };
  return {
    tree: built.tree,
    diff,
    deletedDocs: built.deletedDocs,
    historicalDocs: built.historicalDocs,
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

  for (const n of preview.readCtx.nodes) {
    if (!changedNodes.has(n.node === null ? "course" : String(n.node))) continue;
    if (n.docId === null) continue;
    const label = nodeDocTarget(preview.readCtx.course, preview.readCtx.chapters, n.node).label;
    if (!n.hadRegion && n.storedExisted) {
      // 用户删了整个区并确认全章删除 → 删除状态条目（此后按历史文档处理，避免停写死循环）
      delete nextData.docRegions![n.docId];
      continue;
    }
    if (!n.hadRegion || !canWrite) continue;

    // 用应用当前渲染重写该节点区（合并写回：用户编辑/新增/保留待写 KP 一次性落定）
    const nodeKps = kpsNow.filter((k) => effectiveNodeOf(k, chapters) === n.node);
    const region = renderKpRegion(nodeKps);
    const freshMd = await bridge.getDocMarkdown(n.docId).catch(() => null);
    if (freshMd === null) continue; // 期间文档被删：跳过写回，下次写回自愈重建
    const freshRegion = parseKpRegion(freshMd);
    if (freshRegion.hasRegion && freshRegion.hash !== n.regionHash) {
      continue; // 期间区又有新编辑：不覆盖，保留读时状态（下次写回停写提示）
    }
    try {
      await bridge.updateDoc(n.docId, mergeKpRegion(freshMd, region));
      // 与写回管道同口径：用渲染区解析哈希（renderKpRegion 内部按 sort 排序）
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
