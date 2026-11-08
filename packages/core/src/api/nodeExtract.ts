// 阶段④ 按规范节点抽取：资料集合 → 规范节点集合（共享节点只抽一次），
// 节点正文 = 各贡献资料映射 span 的精确切片拼接（无模糊挂接）；
// AI 输入带兄弟节点边界与已有 KP 名单（双层去重）；挂接 = 映射的 chapterId
import { getData, saveData } from "./storage";
import { callAi, AiCanceledError, findTaskBinding } from "./ai";
import { resolvePromptTemplate, renderPrompt } from "./promptTemplates";
import {
  alignOutlineSpans,
  buildChapterTree,
  chapterPathText,
  nodePathOf,
  outlineOf,
  type NestedChapter,
} from "../utils/outline";
import { isDuplicateKpName } from "./kpMatch";
import { extractJsonCandidates, parseJsonCandidates, unwrapArray } from "../utils/aiJson";
import { effectiveNodeOf } from "../utils/kpTreeImport";
import { scheduleKpRegionSync } from "./kpDocSync";
import { nextId, now } from "./format";
import type { AppData, KnowledgePoint } from "../types/appData";

/** 单节点正文超过此字数才分片（分片结果合并后统一去重） */
const NODE_TEXT_CHUNK = 60000;

/** 资料集合 → 需抽取的规范节点（被这些资料映射覆盖、且尚无 KP 的节点），按章节树文档序 */
export function resolveExtractNodes(data: AppData, materialIds: number[]): number[] {
  const set = new Set(materialIds);
  const courseId = data.materials.find((m) => set.has(m.id))?.courseId;
  if (courseId === undefined) return [];
  const nodes = data.tocMappings
    .filter((m) => m.courseId === courseId && set.has(m.materialId))
    .map((m) => m.chapterId);
  const withKp = new Set(
    data.knowledgePoints.filter((k) => k.courseId === courseId).map((k) => k.chapterId),
  );
  const candidates = [...new Set(nodes)].filter((id) => !withKp.has(id));
  // 章节树文档序（根序 + 子节点序），未入树的异常 id 排序值按 0 处理
  const order = new Map<number, number>();
  let i = 0;
  const walk = (list: NestedChapter[]): void => {
    for (const n of list) {
      order.set(n.chapter.id, i++);
      walk(n.children);
    }
  };
  walk(buildChapterTree(data.chapters.filter((c) => c.courseId === courseId), courseId));
  return candidates.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
}

/** 节点的精确圈定原文：各贡献资料映射 span 文本，资料自然序拼接；未定位 span 跳过 */
export function buildNodeText(data: AppData, nodeId: number): { text: string; materialIds: number[] } {
  const courseId = data.chapters.find((c) => c.id === nodeId)?.courseId;
  if (courseId === undefined) return { text: "", materialIds: [] };
  // 资料自然序（与 queryMaterials 口径一致：名称数字感知排序）
  const mats = data.materials
    .filter((m) => m.courseId === courseId)
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true }));
  const parts: string[] = [];
  const materialIds: number[] = [];
  for (const m of mats) {
    const ms = data.tocMappings.filter((t) => t.chapterId === nodeId && t.materialId === m.id);
    if (ms.length === 0) continue;
    const outline = outlineOf(m);
    if (outline.length === 0) continue;
    const { spans } = alignOutlineSpans(m.contentText, outline);
    // 预建 path→seq 索引，每条映射直接定位对应 span
    const pathToSeq = new Map(outline.map((h, i) => [nodePathOf(outline, i), i]));
    const slices: string[] = [];
    for (const t of ms) {
      const seq = pathToSeq.get(t.materialPath);
      if (seq === undefined) continue;
      const span = spans[seq];
      if (!span || span.start < 0) continue; // 未定位跳过
      slices.push(m.contentText.slice(span.start, span.end).trim());
    }
    if (slices.length > 0) {
      parts.push(slices.join("\n\n"));
      materialIds.push(m.id);
    }
  }
  return { text: parts.join("\n\n"), materialIds };
}

/** 节点正文按段落边界切片（片长 ≤ NODE_TEXT_CHUNK；超长单段强制硬切） */
function sliceNodeText(text: string): string[] {
  if (text.length <= NODE_TEXT_CHUNK) return [text];
  const paras = text.split(/\n{2,}/);
  const out: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (cur.length > 0 && cur.length + p.length + 2 > NODE_TEXT_CHUNK) {
      out.push(cur);
      cur = p;
    } else {
      cur = cur ? cur + "\n\n" + p : p;
    }
    while (cur.length > NODE_TEXT_CHUNK) {
      out.push(cur.slice(0, NODE_TEXT_CHUNK));
      cur = cur.slice(NODE_TEXT_CHUNK);
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

interface RawKp {
  name: string;
  description: string;
}

/** 解析 [{name, description}]（新契约，无 section）；复用 AI JSON 候选提取（围栏/包装对象容忍） */
function parseKpItems(content: string): RawKp[] {
  const arr = unwrapArray(parseJsonCandidates(extractJsonCandidates(content, "array"))) as
    | Record<string, unknown>[]
    | null;
  if (!arr) throw new Error("AI 返回的知识点不是合法 JSON");
  return arr
    .filter((it): it is { name: string; description: string } =>
      typeof it.name === "string" && typeof it.description === "string",
    )
    .map((it) => ({ name: it.name.trim(), description: it.description }));
}

/** 抽取单个规范节点：圈定正文（>60K 分片）→ AI → 按映射挂接 + 双层去重 */
export async function extractNodeKps(
  courseId: number,
  nodeId: number,
  onProgress?: (done: number, total: number) => void,
  isAborted?: () => boolean,
): Promise<{ created: number; skippedDup: number }> {
  const data = await getData();
  const binding = findTaskBinding(data, "extract_kp", courseId);
  if (!binding) throw new Error("未配置「知识点抽取」模型：请到「模型配置 → 任务模型」为该任务指定模型");
  const tpl = resolvePromptTemplate(data, "extract_kp");
  const course = data.courses.find((c) => c.id === courseId);
  if (!course) throw new Error("课程不存在或已删除");
  const chapters = data.chapters.filter((c) => c.courseId === courseId);
  const { text, materialIds } = buildNodeText(data, nodeId);
  if (!text.trim()) return { created: 0, skippedDup: 0 };

  const node = chapters.find((c) => c.id === nodeId);
  const nodePath = node ? chapterPathText(chapters, nodeId) : "";
  // 兄弟节点 = 同父的其他子节点（提示词边界：不得抽取兄弟内容）
  const siblings = node
    ? chapters
        .filter((c) => (node.parentId === null ? c.parentId === null : c.parentId === node.parentId) && c.id !== nodeId)
        .map((c) => c.name)
    : [];
  const existingNodeKps = data.knowledgePoints.filter((k) => k.courseId === courseId && k.chapterId === nodeId);
  const courseKps = data.knowledgePoints.filter((k) => k.courseId === courseId);
  const chunks = sliceNodeText(text);

  let raw: RawKp[] = [];
  for (let i = 0; i < chunks.length; i++) {
    if (isAborted?.()) throw new AiCanceledError();
    onProgress?.(i, chunks.length);
    const partNote = chunks.length > 1 ? `\n（本节点正文较长，以下为第 ${i + 1}/${chunks.length} 片）` : "";
    const res = await callAi({
      providerId: binding.providerId,
      modelId: binding.modelId,
      taskKey: "extract_kp",
      scope: `node-${nodeId}`,
      messages: [
        { role: "system", content: renderPrompt(tpl.system, {}) },
        {
          role: "user",
          content: renderPrompt(tpl.user, {
            courseName: course.name,
            chapter: nodePath,
            siblings: siblings.length ? siblings.join("、") : "（无）",
            existingKps: existingNodeKps.map((k) => k.name).join("、") || "（无）",
            courseKps: courseKps.map((k) => k.name).join("、") || "（无）",
            text: chunks[i] + partNote,
          }),
        },
      ],
    });
    raw = raw.concat(parseKpItems(res.content));
  }
  onProgress?.(chunks.length, chunks.length);

  // 双层去重（节点内 + 课程级）；挂接 = nodeId（映射是结构事实，无模糊匹配）
  // 落库前重新取最新数据，防任务期间其他写入被覆盖（脏写）
  const latest = await getData();
  const courseLatest = latest.knowledgePoints.filter((k) => k.courseId === courseId);
  const nodeNames: string[] = [];
  const newKps: KnowledgePoint[] = [];
  let created = 0;
  let skippedDup = 0;
  let merged = 0;
  for (const item of raw) {
    const name = item.name.trim();
    if (!name) continue;
    // 节点内去重（同批跨片/跨条）
    if (nodeNames.some((n) => isDuplicateKpName(n, name))) {
      skippedDup++;
      continue;
    }
    // 课程级去重：命中已有知识点则合并来源资料，让知识点反映覆盖它的全部资料
    const existing = courseLatest.find((k) => isDuplicateKpName(k.name, name));
    if (existing) {
      skippedDup++;
      const srcIds = existing.sourceAssetIds.split(",").map((s) => s.trim()).filter(Boolean);
      for (const mid of materialIds) if (!srcIds.includes(String(mid))) srcIds.push(String(mid));
      if (srcIds.join(",") !== existing.sourceAssetIds) {
        existing.sourceAssetIds = srcIds.join(",");
        merged++;
      }
      continue;
    }
    const newKp: KnowledgePoint = {
      id: nextId(latest.knowledgePoints),
      courseId,
      chapterId: nodeId,
      blockId: null,
      name,
      content: item.description.trim(),
      mastery: "unlearn",
      sourceAssetIds: materialIds.join(","),
      prevKpIds: "",
      chapterName: node?.name ?? "",
      sort: 0,
      createTime: now(),
    };
    latest.knowledgePoints.push(newKp);
    courseLatest.push(newKp);
    nodeNames.push(name);
    newKps.push(newKp);
    created++;
  }
  if (created > 0 || merged > 0) await saveData(latest);
  // 思源知识点区写回：新增 KP 所在节点的章文档
  for (const kp of newKps) void scheduleKpRegionSync(courseId, effectiveNodeOf(kp, latest.chapters));
  return { created, skippedDup };
}

/**
 * 来源回填：被本批资料映射覆盖、已有 KP 而跳过的节点（未调 AI），
 * 把本批中映射到该节点的资料 id 并入该节点每个 KP 的 sourceAssetIds
 * （去重、保原有顺序、新 id 追加）；节点的设计口径是 sourceAssetIds=全部映射贡献资料。
 * 无变更返回 false（不触发保存）。
 */
function backfillSkippedNodeSources(data: AppData, courseId: number, materialIds: number[]): boolean {
  const set = new Set(materialIds);
  const covered = new Set(
    data.tocMappings.filter((t) => t.courseId === courseId && set.has(t.materialId)).map((t) => t.chapterId),
  );
  let changed = false;
  for (const nodeId of covered) {
    // 本批中映射到该节点的资料 id（数字序，保证合并结果稳定）
    const mids = [...new Set(
      data.tocMappings.filter((t) => t.chapterId === nodeId && set.has(t.materialId)).map((t) => t.materialId),
    )].sort((a, b) => a - b);
    if (mids.length === 0) continue;
    for (const kp of data.knowledgePoints) {
      if (kp.courseId !== courseId || kp.chapterId !== nodeId) continue;
      const srcIds = kp.sourceAssetIds.split(",").map((s) => s.trim()).filter(Boolean);
      const added = mids.filter((m) => !srcIds.includes(String(m)));
      if (added.length === 0) continue;
      kp.sourceAssetIds = [...srcIds, ...added.map(String)].join(",");
      changed = true;
    }
  }
  return changed;
}

/** 资料集合 → 节点集合 → 逐节点抽取（多资料共享节点只抽一次） */
export async function extractMaterialNodes(
  courseId: number,
  materialIds: number[],
  onProgress?: (done: number, total: number, nodePath: string) => void,
  isAborted?: () => boolean,
): Promise<{ nodeTotal: number; nodeDone: number; created: number; skippedDup: number }> {
  const data = await getData();
  const nodes = resolveExtractNodes(data, materialIds);
  let created = 0;
  let skippedDup = 0;
  try {
    for (let i = 0; i < nodes.length; i++) {
      if (isAborted?.()) throw new AiCanceledError();
      const path = chapterPathText(data.chapters.filter((c) => c.courseId === courseId), nodes[i]);
      onProgress?.(i, nodes.length, path);
      const r = await extractNodeKps(courseId, nodes[i], undefined, isAborted);
      created += r.created;
      skippedDup += r.skippedDup;
    }
  } finally {
    // 来源回填是本地数据操作、不依赖 AI：取消（上抛 AiCanceledError）时也照常执行，
    // 保证增量资料进已有节点 KP 的 sourceAssetIds（listUnextractedMaterials 覆盖判定依赖它）
    const latest = await getData();
    if (backfillSkippedNodeSources(latest, courseId, materialIds)) await saveData(latest);
  }
  return { nodeTotal: nodes.length, nodeDone: nodes.length, created, skippedDup };
}
