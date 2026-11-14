import type { AppData, Material } from "../types/appData";
import { getData, saveData } from "./storage";
import { findTaskBinding, cancelAiCall, AiCanceledError } from "./ai";
import { extractMaterialNodes } from "./nodeExtract";
import { purgeKpCascade } from "./kp";
import { effectiveNodeOf } from "../utils/kpTreeImport";
import { scheduleKpRegionSync } from "./kpDocSync";
import { startBgTask, type BgTaskReporter } from "./bgTask";
import { materialTaskId } from "../stores/notify";
import {
  isExtractingMaterial,
  isFullExtracting,
  isBatchExtracting,
  beginBatchExtract,
  endBatchExtract,
  markMaterialExtracting,
  unmarkMaterialExtracting,
} from "./extractState";
import { getBridge } from "@/bridge";

export interface ExtractKpResult {
  newCount: number;
  duplicateCount: number;
  totalChunks: number;
  /** 无可用正文（标题后无内容）的节点数：未调 AI，完成提示可见（M6） */
  emptyNodes: number;
  /** AI 返回缺 name/description 的项数：未采用，完成提示可见（M6） */
  invalidItems: number;
  errors: string[];
}

export async function extractKnowledgePoints(
  materialId: number,
  options?: {
    taskKey?: string;
    /** 取消信号：返回 true 时停止后续节点（已完成节点的结果保留） */
    isAborted?: () => boolean;
    onProgress?: (current: number, total: number, blockTitle: string) => void;
  },
): Promise<ExtractKpResult> {
  if (isExtractingMaterial(materialId)) {
    throw new Error("该资料正在抽取中，请等待本次抽取完成");
  }
  const data: AppData = await getData();
  const material = data.materials.find((m) => m.id === materialId);
  if (!material) {
    throw new Error("资料不存在");
  }
  const taskKey = options?.taskKey ?? "extract_kp";
  const binding = findTaskBinding(data, taskKey, material.courseId);
  if (!binding) {
    throw new Error(
      "未配置 AI 任务模型，请前往「模型配置 → AI 任务模型分配」设置「" + taskKey + "」任务或「全局默认模型」",
    );
  }
  markMaterialExtracting(materialId);
  try {
    // 按规范节点抽取：资料 → 映射覆盖的节点集合（共享节点只抽一次）；
    // 进度回调的 blockTitle 传节点路径（UI 文案沿用「第 X/N 块」兼容）
    const r = await extractMaterialNodes(
      material.courseId,
      [materialId],
      (done, total, nodePath) => options?.onProgress?.(done + 1, total, nodePath),
      options?.isAborted,
    );
    return {
      newCount: r.created,
      duplicateCount: r.skippedDup,
      totalChunks: r.nodeTotal,
      emptyNodes: r.emptyNodes,
      invalidItems: r.invalidItems,
      errors: [],
    };
  } finally {
    unmarkMaterialExtracting(materialId);
  }
}

export interface ReextractCourseResult {
  materials: number;
  nodes: number;
  created: number;
  skippedDup: number;
  emptyNodes: number;
  invalidItems: number;
}

/**
 * 全量重抽（H3：暂存 + 原子提交）：
 * 在内存副本上删除课程全部 KP（级联清理）→ 按资料顺序逐节点重抽；
 * 全部成功才一次性 saveData（原子落库，数据库不出现「删了一半」中间态）；
 * 任一资料失败/取消 → 丢弃副本，原知识点原样保留（旧实现先删后抽，中途失败=永久丢失）。
 * 提交后统一调度思源 KP 区同步（staging 期间 extractNodeKps 不调度）。
 */
export async function reextractCourse(
  courseId: number,
  onProgress?: (materialIndex: number, materialTotal: number, nodePath: string) => void,
  isAborted?: () => boolean,
): Promise<ReextractCourseResult> {
  const base: AppData = await getData();
  const course = base.courses.find((c) => c.id === courseId);
  if (!course) throw new Error("课程不存在或已删除");
  const binding = findTaskBinding(base, "extract_kp", courseId);
  if (!binding) throw new Error("未配置「知识点抽取」模型：请到「模型配置 → 任务模型」为该任务指定模型");
  const mats = base.materials
    .filter((m) => m.courseId === courseId)
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true }));
  if (mats.length === 0) throw new Error("课程没有资料，无法全量重新抽取");
  // staging 副本：删除课程 KP（级联）后在其上抽取；base 不受影响
  const staging: AppData = structuredClone(base);
  purgeKpCascade(
    staging,
    new Set(staging.knowledgePoints.filter((k) => k.courseId === courseId).map((k) => k.id)),
  );
  let nodes = 0;
  let created = 0;
  let skippedDup = 0;
  let emptyNodes = 0;
  let invalidItems = 0;
  try {
    for (let i = 0; i < mats.length; i++) {
      if (isAborted?.()) throw new AiCanceledError();
      onProgress?.(i, mats.length, "");
      const r = await extractMaterialNodes(
        courseId,
        [mats[i].id],
        (_done, _total, nodePath) => onProgress?.(i, mats.length, nodePath),
        isAborted,
        staging,
      );
      nodes += r.nodeTotal;
      created += r.created;
      skippedDup += r.skippedDup;
      emptyNodes += r.emptyNodes;
      invalidItems += r.invalidItems;
    }
  } catch (e) {
    // 丢弃 staging：数据库保持原样（旧 KP 未被删除）
    throw e;
  }
  await saveData(staging);
  // 提交后统一调度 KP 区同步：课程文档（null）+ 有 KP 的全部节点
  const syncTargets = new Set<number | null>([null]);
  for (const k of staging.knowledgePoints) {
    if (k.courseId === courseId) syncTargets.add(effectiveNodeOf(k, staging.chapters));
  }
  for (const nid of syncTargets) void scheduleKpRegionSync(courseId, nid);
  return { materials: mats.length, nodes, created, skippedDup, emptyNodes, invalidItems };
}

const extractAbortFlags = new Map<number, { aborted: boolean }>();

export function startExtractTask(materialId: number, courseId: number): void {
  if (isExtractingMaterial(materialId)) return;
  if (isFullExtracting()) {
    getBridge().showMessage("全量重抽中，请稍候", 3000, "error");
    return;
  }
  if (isBatchExtracting()) {
    getBridge().showMessage("批量抽取进行中，请稍候", 3000, "error");
    return;
  }
  const flag = { aborted: false };
  extractAbortFlags.set(materialId, flag);
  void runExtractTask(materialId, courseId, flag);
}

/** 尚无知识点覆盖的资料（课程知识点 sourceAssetIds 中均未出现的 materialId） */
export async function listUnextractedMaterials(courseId: number): Promise<Material[]> {
  const data = await getData();
  const covered = new Set<string>();
  for (const k of data.knowledgePoints) {
    if (k.courseId !== courseId) continue;
    for (const s of k.sourceAssetIds.split(",")) if (s.trim()) covered.add(s.trim());
  }
  return data.materials.filter((m) => m.courseId === courseId && !covered.has(String(m.id)));
}

/**
 * 批量抽取多个资料（目录确认后「未抽资料一起抽」）：
 * 每个资料一个后台任务（铃铛分别显示进度），按启动顺序串行执行，避免并发 AI 调用触发限速。
 * 互斥：任一抽取（单资料/批量/全量）进行中则拒绝。
 */
export function startBatchExtractTask(materialIds: number[], courseId: number): void {
  if (materialIds.length === 0) return;
  if (isFullExtracting() || isBatchExtracting()) {
    getBridge().showMessage("已有抽取任务进行中，请稍候", 3000, "error");
    return;
  }
  if (!beginBatchExtract()) return;
  void (async () => {
    const data = await getData();
    const names = new Map(data.materials.map((m) => [m.id, m.name] as const));
    const tasks = materialIds.map((id, i) =>
      startBgTask({
        taskId: materialTaskId(id, "extract"),
        taskType: "extract",
        label: names.get(id) ?? `资料 ${id}`,
        materialId: id,
        courseId,
        message: i === 0 ? "准备中…" : `排队中（共 ${materialIds.length} 份，等待前面资料完成）`,
      }),
    );
    try {
      for (let i = 0; i < materialIds.length; i++) {
        // flag 存入共享的 extractAbortFlags：铃铛「取消」（cancelExtractTask）对运行中/排队项均生效
        const flag = { aborted: false };
        extractAbortFlags.set(materialIds[i], flag);
        await runExtractTask(materialIds[i], courseId, flag, tasks[i]);
      }
    } finally {
      endBatchExtract();
    }
  })();
}

export async function cancelExtractTask(materialId: number): Promise<void> {
  const flag = extractAbortFlags.get(materialId);
  if (flag) flag.aborted = true;
  // 打断在途 AI 调用（forwardProxy 无网络层 abort：响应返回后丢弃）
  // 按节点抽取的 callAi scope 是 node-<nodeId>：逐一取消该资料映射覆盖的全部节点（在途节点必在其中）
  const data = await getData();
  const nodeIds = [...new Set(data.tocMappings.filter((m) => m.materialId === materialId).map((m) => m.chapterId))];
  for (const nid of nodeIds) cancelAiCall("extract_kp", `node-${nid}`);
}

async function runExtractTask(
  materialId: number,
  courseId: number,
  flag: { aborted: boolean },
  extractTask?: ReturnType<typeof startBgTask> | null,
): Promise<void> {
  const extractTaskId = materialTaskId(materialId, "extract");
  let reporter: BgTaskReporter | null = null;
  try {
    const data = await getData();
    const material = data.materials.find((m) => m.id === materialId);
    if (!material) throw new Error("资料不存在");
    reporter =
      extractTask ??
      startBgTask({
        taskId: extractTaskId,
        taskType: "extract",
        label: material.name,
        materialId,
        courseId,
        message: "准备中…",
      });
    const result = await extractKnowledgePoints(materialId, {
      isAborted: () => flag.aborted,
      onProgress: (current, total, blockTitle) => {
        if (total > 0) {
          reporter?.progress({
            done: current,
            total,
            message: `知识点抽取：第 ${current}/${total} 块${blockTitle ? " · " + blockTitle : ""}`,
          });
        }
      },
    });
    if (flag.aborted) {
      reporter.canceled();
      return;
    }
    let msg = `抽取完成：新增 ${result.newCount} 个知识点，合并重复 ${result.duplicateCount} 个`;
    if (result.emptyNodes > 0) msg += `，${result.emptyNodes} 个节点无可用正文未抽取`;
    if (result.invalidItems > 0) msg += `，${result.invalidItems} 个 AI 返回项缺描述未采用`;
    if (result.errors.length > 0) msg += `；${result.errors.length} 块失败（${result.errors[0]}）`;
    reporter.done(msg);
  } catch (e) {
    // 用户取消（flag 或节点层 AiCanceledError 上抛）：按取消处理，不计为失败
    if (e instanceof AiCanceledError || flag.aborted) {
      if (reporter) reporter.canceled();
    } else {
      if (reporter) reporter.fail(e, "知识点抽取失败");
    }
  } finally {
    extractAbortFlags.delete(materialId);
  }
}

/** 标签输入解析：中英文逗号/分号分隔，去空白去重 */
export function parseTagsInput(input: string): string[] {
  return [...new Set(input.split(/[,，;；]/).map((t) => t.trim()).filter(Boolean))];
}

