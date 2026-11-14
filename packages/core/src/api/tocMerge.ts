// 阶段③ 目录语义合并：既有课程章节树为种子 → 逐资料顺序调 AI（merge_toc）把资料 outline
// 合并进规范树 → 完整规范树 + outline 节点→规范节点映射（后台任务，完成后派发 toc-merged 事件）
import { getData } from "./storage";
import { callAiWithRetry, cancelAiCall, AiCanceledError, findTaskBinding } from "./ai";
import { resolvePromptTemplate, renderPrompt } from "./promptTemplates";
import { startBgTask, type BgTaskReporter } from "./bgTask";
import { queryMaterials } from "./material";
import { runOutlineRecognition } from "./outlineExtract";
import { buildChapterTree, outlineOf, type OutlineNode } from "../utils/outline";
import { stripThinkBlocks } from "../utils/aiJson";
import type { Chapter } from "../types/appData";

/** 单次合并调用可携带的 outline 节点上限（超过按顶层边界拆片顺序合） */
const MAX_OUTLINE_PER_CALL = 150;
// M5 护栏：章节树 + 本片段大纲的 prompt 体积上限（字符）。超过则 fail-loud 报「章节树过大」，
// 不赌模型上下文窗口（outline 侧已按 150 节点分片，此处管树侧）
const MAX_MERGE_PROMPT_CHARS = 20000;

/** 合并完成事件：detail = { courseId, result: MergeResult }；课程视图监听后打开预览弹窗（api 层不依赖组件层） */
export const TOC_MERGED_EVENT = "siyuan-ai-study:toc-merged";

export interface MergeNode {
  /** 数组下标 */
  id: number;
  parent: number | null;
  name: string;
  variants: string[];
  /** 对应既有章节 id；新节点为 null */
  chapterId: number | null;
}

export interface RawMapping {
  /** 资料 id（显式 id：子集合并时过滤列表下标会错位，不用下标） */
  materialId: number;
  /** 资料 outline 内节点序号（全局，非分片局部） */
  materialSeq: number;
  nodeId: number;
}

export interface MergeResult {
  nodes: MergeNode[];
  mappings: RawMapping[];
  /** 本轮成功完成合并的资料 id（失败的在 failed，不含）；落库据此确定映射替换范围（子集合并不清未处理资料） */
  processed: number[];
  failed: { materialName: string; reason: string; outline: OutlineNode[] }[];
}

/** 既有课程章节树 → 合并种子（id 重排为下标，文档序，chapterId 保留原 id） */
export function seedNodesFromChapters(chapters: Chapter[], courseId: number): MergeNode[] {
  const out: MergeNode[] = [];
  const walk = (list: ReturnType<typeof buildChapterTree>, parentIdx: number | null): void => {
    for (const it of list) {
      const idx = out.length;
      out.push({ id: idx, parent: parentIdx, name: it.chapter.name, variants: [], chapterId: it.chapter.id });
      walk(it.children, idx);
    }
  };
  // buildChapterTree：过滤课程、同级 sort 序、孤儿（parentId 指向已删节点）提升顶层末尾
  walk(buildChapterTree(chapters, courseId), null);
  return out;
}

export interface ParsedMerge {
  nodes: { id: number; parent: number | null; name: string; variants: string[] }[];
  mapping: { seq: number; node: number }[];
}

/**
 * 解析并校验 merge_toc 的 AI 输出。安全核心：输入节点丢失/新 id 不连续/parent 悬空/成环/空名/
 * mappings 越界/seq 重复——全部 fail-loud 抛中文错误。
 */
export function parseMergeResponse(content: string, inputCount: number, outlineCount: number): ParsedMerge {
  let s = content.trim();
  const fence = s.match(/^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/);
  if (fence) s = fence[1].trim();
  s = stripThinkBlocks(s);
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI 返回的合并结果不是合法 JSON");
  let obj: unknown;
  try {
    obj = JSON.parse(s.slice(start, end + 1));
  } catch {
    throw new Error("AI 返回的合并结果不是合法 JSON");
  }
  const o = obj as { nodes?: unknown; mappings?: unknown };
  if (!Array.isArray(o.nodes)) throw new Error("AI 返回缺少 nodes 数组");
  const nodes: ParsedMerge["nodes"] = [];
  const seen = new Set<number>();
  for (const item of o.nodes) {
    if (typeof item !== "object" || item === null) throw new Error("AI 返回 nodes 含非法项");
    const n = item as Record<string, unknown>;
    const id = Number(n.id);
    const name = typeof n.name === "string" ? n.name.trim() : "";
    if (!Number.isInteger(id) || id < 0 || seen.has(id)) throw new Error(`AI 返回节点 id 非法或重复：${id}`);
    if (!name) throw new Error("AI 返回节点存在空 name");
    seen.add(id);
    const variants = Array.isArray(n.variants)
      ? (n.variants as unknown[]).filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim())
      : [];
    nodes.push({ id, parent: n.parent === null ? null : Number(n.parent), name, variants });
  }
  // 序不变量：数组下标 === id（下游 levelOf/mapping 均按下标取节点，乱序会静默挂错章）
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].id !== i) throw new Error(`AI 返回 nodes 未按 id 升序排列：位置 ${i} 的 id=${nodes[i].id}`);
  }
  // 输入节点全部保留；新节点 id 从 inputCount 起连续
  for (let i = 0; i < inputCount; i++) {
    if (!seen.has(i)) throw new Error(`AI 返回丢失输入节点 id=${i}`);
  }
  const newIds = [...seen].filter((id) => id >= inputCount).sort((a, b) => a - b);
  for (let k = 0; k < newIds.length; k++) {
    if (newIds[k] !== inputCount + k) throw new Error("AI 返回新增节点 id 必须从输入总数起连续");
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // parent 合法性 + 无环（沿 parent 链 ≤8 步必须到顶层）
  for (const n of nodes) {
    if (n.parent !== null && (!Number.isInteger(n.parent) || !byId.has(n.parent))) {
      throw new Error(`AI 返回节点 parent 悬空：id=${n.id} parent=${n.parent}`);
    }
    let cur: ParsedMerge["nodes"][number] | undefined = n;
    let guard = 0;
    while (cur && cur.parent !== null && guard++ < 8) cur = byId.get(cur.parent);
    if (cur && cur.parent !== null) throw new Error(`AI 返回节点 parent 成环：id=${n.id}`);
  }
  // mappings
  const mapping: ParsedMerge["mapping"] = [];
  if (o.mappings !== undefined) {
    if (!Array.isArray(o.mappings)) throw new Error("AI 返回 mappings 不是数组");
    const seenSeq = new Set<number>();
    for (const item of o.mappings as unknown[]) {
      if (typeof item !== "object" || item === null) throw new Error("AI 返回 mappings 含非法项");
      const m = item as Record<string, unknown>;
      const seq = Number(m.seq);
      const node = Number(m.node);
      if (!Number.isInteger(seq) || seq < 0 || seq >= outlineCount) throw new Error(`AI 返回 mapping seq 越界：${seq}`);
      if (!Number.isInteger(node) || !seen.has(node)) throw new Error(`AI 返回 mapping node 不存在：${node}`);
      if (seenSeq.has(seq)) throw new Error(`AI 返回 mapping seq 重复：${seq}`);
      seenSeq.add(seq);
      mapping.push({ seq, node });
    }
  }
  return { nodes, mapping };
}

/**
 * 大 outline 按顶层（level 1）边界拆成 ≤MAX_OUTLINE_PER_CALL 的连续片。
 * 每片取 [起点, 起点+150) 内最后一个顶层边界为切点；片内无顶层边界时（单章过大）硬切。
 */
export function splitOutlineForMerge(outline: OutlineNode[]): { start: number; nodes: OutlineNode[] }[] {
  if (outline.length <= MAX_OUTLINE_PER_CALL) return [{ start: 0, nodes: outline }];
  const parts: { start: number; nodes: OutlineNode[] }[] = [];
  let start = 0;
  while (start < outline.length) {
    const endLimit = Math.min(start + MAX_OUTLINE_PER_CALL, outline.length);
    let cut = -1;
    for (let i = start + 1; i < endLimit; i++) {
      if (outline[i].level === 1) cut = i;
    }
    const end = cut >= 0 ? cut : endLimit;
    parts.push({ start, nodes: outline.slice(start, end) });
    start = end;
  }
  return parts;
}

/** 节点层级（沿 parent 链计深，与 prompt 的 L 前缀一致） */
function levelOf(nodes: MergeNode[], id: number): number {
  let d = 1;
  let cur: MergeNode | undefined = nodes[id];
  let guard = 0;
  while (cur && cur.parent !== null && guard++ < 8) {
    d++;
    cur = nodes[cur.parent];
  }
  return d;
}

/**
 * 逐资料顺序语义合并。种子=现有课程树（幂等/增量）；
 * 资料无 outline 时先跑阶段②；>150 节点拆片顺序合；单资料失败不阻塞其他。
 * onProgress 第三参 phase：outline=补跑②期间 / merge=正式合并期（进度文案区分）
 */
export async function mergeCourseToc(
  courseId: number,
  materialIds?: number[],
  onProgress?: (done: number, total: number, phase: "outline" | "merge") => void,
  isAborted?: () => boolean,
): Promise<MergeResult> {
  const data = await getData();
  const binding = findTaskBinding(data, "merge_toc", courseId);
  if (!binding) throw new Error("未配置「目录合并」模型：请到「模型配置 → 任务模型」为该任务指定模型");
  const tpl = resolvePromptTemplate(data, "merge_toc");
  const course = data.courses.find((c) => c.id === courseId);
  if (!course) throw new Error("课程不存在或已删除");
  let mats = await queryMaterials(courseId);
  if (materialIds) mats = mats.filter((m) => materialIds.includes(m.id));
  if (mats.length === 0) throw new Error("课程还没有资料，无法合并目录");

  let nodes = seedNodesFromChapters(data.chapters, courseId);
  const mappings: RawMapping[] = [];
  const processed: number[] = [];
  const failed: MergeResult["failed"] = [];

  for (let i = 0; i < mats.length; i++) {
    if (isAborted?.()) throw new AiCanceledError();
    const mat = mats[i];
    let outline = outlineOf(mat);
    try {
      if (outline.length === 0) {
        onProgress?.(i, mats.length, "outline");
        const r = await runOutlineRecognition(mat.id, courseId, undefined, isAborted);
        if (isAborted?.()) throw new AiCanceledError();
        outline = r.nodes;
      }
      onProgress?.(i, mats.length, "merge");
      for (const part of splitOutlineForMerge(outline)) {
        const treeText = nodes.length
          ? nodes.map((n) => `L${levelOf(nodes, n.id)} ${n.name}`).join("\n")
          : "（空，课程还没有章节树）";
        const outlineText = part.nodes.map((h, j) => `[${part.start + j}] L${h.level} ${h.text}`).join("\n");
        if (treeText.length + outlineText.length > MAX_MERGE_PROMPT_CHARS) {
          throw new Error(
            `章节树过大（${nodes.length} 节点），超出目录合并单次处理上限。请拆分课程章节（或删去冗余章节）后重新识别`,
          );
        }
        const res = await callAiWithRetry({
          providerId: binding.providerId,
          modelId: binding.modelId,
          taskKey: "merge_toc",
          scope: `course-${courseId}`,
          messages: [
            { role: "system", content: renderPrompt(tpl.system, {}) },
            { role: "user", content: renderPrompt(tpl.user, { tree: treeText, materialName: mat.name, outline: outlineText }) },
          ],
        }, isAborted);
        const parsed = parseMergeResponse(res.content, nodes.length, part.nodes.length);
        // chapterId 侧信道：旧 id 继承，新 id 为 null
        const oldById = new Map(nodes.map((n) => [n.id, n.chapterId]));
        nodes = parsed.nodes.map((n) => ({ ...n, chapterId: oldById.has(n.id) ? (oldById.get(n.id) ?? null) : null }));
        for (const mp of parsed.mapping) {
          mappings.push({ materialId: mat.id, materialSeq: part.start + mp.seq, nodeId: mp.node });
        }
      }
      processed.push(mat.id);
    } catch (e) {
      if (e instanceof AiCanceledError) throw e;
      // outline 用当前值（补跑②后的新结果；未补跑时等价 outlineOf(mat)）
      failed.push({ materialName: mat.name, reason: e instanceof Error ? e.message : String(e), outline });
    }
  }
  onProgress?.(mats.length, mats.length, "merge");
  return { nodes, mappings, processed, failed };
}

// 后台任务：模块级 Set 防重入 + flag Map 协作取消（同一课程串行，多课程并行）
const tocMergingCourseIds = new Set<number>();
const tocAbortFlags = new Map<number, { aborted: boolean }>();

export function startTocMergeTask(courseId: number, materialIds?: number[]): void {
  if (tocMergingCourseIds.has(courseId)) return;
  tocMergingCourseIds.add(courseId);
  const flag = { aborted: false };
  tocAbortFlags.set(courseId, flag);
  const task: BgTaskReporter = startBgTask({
    taskId: `course-${courseId}-toc`,
    taskType: "toc",
    label: "目录合并",
    courseId,
    message: "准备中…",
  });
  void (async () => {
    try {
      const result = await mergeCourseToc(
        courseId,
        materialIds,
        (done, total, phase) =>
          task.progress({
            done,
            total,
            message: phase === "outline"
              ? `识别资料结构：资料 ${Math.min(done + 1, total)}/${total}…`
              : `合并目录：资料 ${Math.min(done + 1, total)}/${total}…`,
          }),
        () => flag.aborted,
      );
      if (flag.aborted) {
        task.canceled();
        return;
      }
      // 预览弹窗由课程视图监听 TOC_MERGED_EVENT 打开；本模块只负责合并 + 派发事件
      const msg = result.failed.length > 0
        ? `目录合并完成，${result.failed.length} 份资料失败：${result.failed.map((f) => f.materialName).join("、")}`
        : "目录合并完成";
      task.done(msg);
      window.dispatchEvent(new CustomEvent(TOC_MERGED_EVENT, { detail: { courseId, result } }));
    } catch (e) {
      if (e instanceof AiCanceledError || flag.aborted) task.canceled();
      else task.fail(e, "目录合并失败");
    } finally {
      tocMergingCourseIds.delete(courseId);
      tocAbortFlags.delete(courseId);
    }
  })();
}

export function cancelTocMergeTask(courseId: number): void {
  const flag = tocAbortFlags.get(courseId);
  if (flag) flag.aborted = true;
  // 打断在途 AI 调用（forwardProxy 无网络层 abort：响应返回后丢弃）
  cancelAiCall("merge_toc", `course-${courseId}`);
}
