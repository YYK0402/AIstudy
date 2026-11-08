import type { AppData, Material } from "../types/appData";
import { getData } from "./storage";
import { findTaskBinding, cancelAiCall, AiCanceledError } from "./ai";
import { extractMaterialNodes } from "./nodeExtract";
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
    return { newCount: r.created, duplicateCount: r.skippedDup, totalChunks: r.nodeTotal, errors: [] };
  } finally {
    unmarkMaterialExtracting(materialId);
  }
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

