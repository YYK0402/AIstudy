// 阶段② 结构识别：资料干净文本 → 分段调 AI（recognize_outline）→ 合并 N 级扁平 outline
// → 代码侧 span 对齐定位 → 落库 Material.outline/outlineStatus（后台任务，铃铛可取消）
import { getData, saveData } from "./storage";
import { callAi, cancelAiCall, AiCanceledError, findTaskBinding } from "./ai";
import { resolvePromptTemplate, renderPrompt } from "./promptTemplates";
import { startBgTask, type BgTaskReporter } from "./bgTask";
import { alignOutlineSpans, type OutlineNode } from "../utils/outline";
import { stripThinkBlocks } from "../utils/aiJson";

const OUTLINE_CHUNK_SIZE = 40000;
const OUTLINE_TAIL_OVERLAP = 500;
const MAX_OUTLINE_NODES = 400;

/** 校验 AI 输出的单个标题项；非法（非对象/空文本/level 越界/目录点线）返回 null */
function asOutlineNode(item: unknown): OutlineNode | null {
  if (typeof item !== "object" || item === null) return null;
  const o = item as Record<string, unknown>;
  const text = typeof o.text === "string" ? o.text.trim() : "";
  const level = Number(o.level);
  if (!text || !Number.isInteger(level) || level < 1 || level > 8) return null;
  if (text.includes("…")) return null; // 目录页点线（如「第1章 …… 3」）
  return { text, level };
}

/** 解析 recognize_outline 的 AI 输出（代码围栏/思考泄漏前缀容忍；非法项过滤；节点数截断） */
export function parseOutlineResponse(content: string): OutlineNode[] {
  let s = content.trim();
  const fence = s.match(/^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/);
  if (fence) s = fence[1].trim();
  s = stripThinkBlocks(s);
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI 返回的 outline 不是合法 JSON");
  let obj: unknown;
  try {
    obj = JSON.parse(s.slice(start, end + 1));
  } catch {
    throw new Error("AI 返回的 outline 不是合法 JSON");
  }
  const o = obj as { headings?: unknown };
  if (!Array.isArray(o.headings)) throw new Error("AI 返回缺少 headings 数组");
  return o.headings.map(asOutlineNode).filter((n): n is OutlineNode => n !== null).slice(0, MAX_OUTLINE_NODES);
}

export interface OutlineChunk {
  index: number;
  total: number;
  /** 发给 AI 的文本（续段含前段尾部重叠） */
  text: string;
  /** 本段正文在 text 中的起点（首段 0；续段 = 重叠前缀长 + 2 个换行） */
  bodyStart: number;
  overlap: boolean;
}

/** 按段落边界切段（段长 ≤ size）；续段文本 = 前段尾 tail 字 + 本段 */
export function buildOutlineChunks(text: string, size = OUTLINE_CHUNK_SIZE, tail = OUTLINE_TAIL_OVERLAP): OutlineChunk[] {
  const paras = text.split(/\n{2,}/);
  const raw: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (cur.length > 0 && cur.length + p.length + 2 > size) {
      raw.push(cur);
      cur = p;
    } else {
      cur = cur ? cur + "\n\n" + p : p;
    }
    // 超长单段（OCR 长行）强制硬切
    while (cur.length > size) {
      raw.push(cur.slice(0, size));
      cur = cur.slice(size);
    }
  }
  if (cur.trim()) raw.push(cur);
  return raw.map((c, i) => {
    if (i === 0) return { index: 0, total: raw.length, text: c, bodyStart: 0, overlap: false };
    const head = raw[i - 1].slice(-tail);
    return { index: i, total: raw.length, text: head + "\n\n" + c, bodyStart: head.length + 2, overlap: true };
  });
}

/** 累积合并：丢弃 next 开头与 acc 尾部重复的节点（重叠区双识别） */
export function mergeOutlineNodes(acc: OutlineNode[], next: OutlineNode[]): OutlineNode[] {
  let drop = 0;
  const tail3 = acc.slice(-3);
  while (drop < next.length && tail3.length > 0) {
    const cand = next[drop];
    const last = tail3[tail3.length - 1];
    if (cand.text === last.text && cand.level === last.level) drop++;
    else break;
  }
  return [...acc, ...next.slice(drop)];
}

/** 识别一份资料的 N 级 outline：分段调用 AI → 合并 → 对齐定位 → 落库 Material.outline */
export async function runOutlineRecognition(
  materialId: number,
  courseId: number,
  onProgress?: (done: number, total: number) => void,
  isAborted?: () => boolean,
): Promise<{ nodes: OutlineNode[]; unlocated: number[] }> {
  const data = await getData();
  const binding = findTaskBinding(data, "recognize_outline", courseId);
  if (!binding) throw new Error("未配置「结构识别」模型：请到「模型配置 → 任务模型」为该任务指定模型");
  const tpl = resolvePromptTemplate(data, "recognize_outline");
  const mat = data.materials.find((m) => m.id === materialId);
  if (!mat || !mat.contentText.trim()) throw new Error("资料没有可识别的正文");
  const chunks = buildOutlineChunks(mat.contentText);
  let acc: OutlineNode[] = [];
  for (const chunk of chunks) {
    if (isAborted?.()) throw new AiCanceledError();
    onProgress?.(chunk.index, chunk.total);
    // 携带前面已识别大纲，保证跨段层级一致
    const context = acc.length ? acc.map((h) => `L${h.level} ${h.text}`).join("\n") : "（空，本段是首段）";
    const res = await callAi({
      providerId: binding.providerId,
      modelId: binding.modelId,
      taskKey: "recognize_outline",
      scope: "material-" + materialId,
      messages: [
        { role: "system", content: renderPrompt(tpl.system, {}) },
        { role: "user", content: renderPrompt(tpl.user, { context, chunk: chunk.text }) },
      ],
    });
    acc = mergeOutlineNodes(acc, parseOutlineResponse(res.content));
  }
  const { unlocated } = alignOutlineSpans(mat.contentText, acc);
  // 重新取最新数据再写，防任务期间其他写入被覆盖（脏写）
  const latest = await getData();
  const m2 = latest.materials.find((m) => m.id === materialId);
  if (!m2) throw new Error("资料已在任务期间被删除");
  m2.outline = JSON.stringify(acc);
  m2.outlineStatus = unlocated.length > 0 ? "partial" : "done";
  await saveData(latest);
  onProgress?.(chunks.length, chunks.length);
  return { nodes: acc, unlocated };
}

// 后台任务（与 startOrganizeTask 同模式）：模块级 Set 防重入 + flag Map 协作取消
const outliningMaterialIds = new Set<number>();
const outlineAbortFlags = new Map<number, { aborted: boolean }>();

export function startOutlineTask(materialId: number, courseId: number): void {
  if (outliningMaterialIds.has(materialId)) return;
  outliningMaterialIds.add(materialId);
  const flag = { aborted: false };
  outlineAbortFlags.set(materialId, flag);
  const task: BgTaskReporter = startBgTask({
    taskId: `material-${materialId}-outline`,
    taskType: "outline",
    label: "结构识别",
    materialId,
    courseId,
    message: "准备中…",
  });
  void (async () => {
    try {
      const r = await runOutlineRecognition(
        materialId,
        courseId,
        (done, total) => task.progress({ done, total, message: `识别中：第 ${Math.min(done + 1, total)}/${total} 段…` }),
        () => flag.aborted,
      );
      if (flag.aborted) {
        task.canceled();
        return;
      }
      const msg =
        r.unlocated.length > 0
          ? `识别完成：${r.nodes.length} 个标题，${r.unlocated.length} 个未能定位（不影响抽取，预览可查看）`
          : `识别完成：${r.nodes.length} 个标题`;
      task.done(msg);
    } catch (e) {
      if (e instanceof AiCanceledError || flag.aborted) task.canceled();
      else task.fail(e, "结构识别失败");
    } finally {
      outliningMaterialIds.delete(materialId);
      outlineAbortFlags.delete(materialId);
    }
  })();
}

export function cancelOutlineTask(materialId: number): void {
  const flag = outlineAbortFlags.get(materialId);
  if (flag) flag.aborted = true;
  // 打断在途 AI 调用（forwardProxy 无网络层 abort：响应返回后丢弃）
  cancelAiCall("recognize_outline", "material-" + materialId);
}
