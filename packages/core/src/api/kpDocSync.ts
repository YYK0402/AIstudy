// 知识点锚点区 ↔ 思源文档双向同步（核心纯函数 + 写回/读回管道）
//
// 文档格式：章/节文档、课程顶层文档末尾追加锚点区，区是应用数据镜像
// （仅本节点直属 KP、sort 序、与 md 往返 KP 行逐行一致）；锚点外内容永不触碰。
import type { KnowledgePoint } from "../types/appData";
import { parseKpLine } from "../utils/kpTreeImport";
import { MASTERY_LABEL } from "../utils/kpTreeExport";

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
