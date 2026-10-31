import type { AppData, KnowledgePoint, Material } from "../types/appData";
import { getData, saveData } from "./storage";
import { formatLocalDate, nextId, now, truncateText } from "./format";
import { findTaskBinding, callAi, cancelAiCall, AiCanceledError } from "./ai";
import { extractJsonCandidates, parseJsonCandidates, unwrapArray } from "../utils/aiJson";
import { resolvePromptTemplate, renderPrompt } from "./promptTemplates";
import { startBgTask, type BgTaskReporter } from "./bgTask";
import { materialTaskId } from "../stores/notify";
import { ensureReviewTouchpointInData } from "./review";
import { updateKnowledgePoint } from "./kp";
import { findChapterByTitle, normalizeKpName } from "./kpMatch";
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

interface AiKpItem {
  name: string;
  description: string;
  /** 该知识点所属小节标题（模型按原文照抄），用于挂到具体节 */
  section: string;
}

interface ParsedKpResponse {
  kps: AiKpItem[];
  /** 返回内容无法解析为 JSON 数组（区别于解析成功但该块无知识点） */
  parseFailed: boolean;
}

function parseAiKpResponse(content: string): ParsedKpResponse {
  const arr = unwrapArray(parseJsonCandidates(extractJsonCandidates(content, "array"))) as Record<string, unknown>[] | null;
  if (!arr) return { kps: [], parseFailed: true };
  return {
    kps: arr
      .filter((it): it is { name: string; description: string; section?: string } =>
        typeof it.name === "string" && typeof it.description === "string")
      .map((it) => ({ name: it.name, description: it.description, section: typeof it.section === "string" ? it.section : "" })),
    parseFailed: false,
  };
}

// 归一化知识点名：小写、去掉空白与标点，用于本地去重
// 本地判断两个知识点名是否重复（精确/归一化后相同，或相互包含）
function isDuplicateKpName(a: string, b: string): boolean {
  const na = normalizeKpName(a);
  const nb = normalizeKpName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 2 && nb.length >= 2 && (na.includes(nb) || nb.includes(na))) return true;
  return false;
}

export async function extractKnowledgePoints(
  materialId: number,
  options?: {
    taskKey?: string;
    /** 取消信号：返回 true 时停止后续块（已完成块的结果保留） */
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
    return await extractKnowledgePointsInner(material, taskKey, binding, options);
  } finally {
    unmarkMaterialExtracting(materialId);
  }
}

async function extractKnowledgePointsInner(
  material: Material,
  taskKey: string,
  binding: { providerId: number; modelId: string },
  options?: {
    taskKey?: string;
    isAborted?: () => boolean;
    onProgress?: (current: number, total: number, blockTitle: string) => void;
  },
): Promise<ExtractKpResult> {
  const data: AppData = await getData();

  const { chunkText, chunkByMarkdownHeadings, chunkByChapters } = await import("../utils/textChunker");
  // 优先按章切块（模型一次看到完整一章含节结构）；无章级标题时回退按节切分，再回退固定字符分块
  const chapterChunks = chunkByChapters(material.contentText);
  const headingChunks = chapterChunks.length >= 2 ? chapterChunks : chunkByMarkdownHeadings(material.contentText);
  const rawBlocks: Array<{ title: string; text: string }> =
    headingChunks.length >= 2
      ? headingChunks.map((c) => ({ title: c.title, text: c.content }))
      : chunkText(material.contentText, 2000).map((t) => ({ title: "", text: t }));
  // 单章超长（>30K 字）时再切分，避免超出模型有效上下文
  const MAX_BLOCK_CHARS = 30000;
  const blocks: Array<{ title: string; text: string }> = [];
  for (const b of rawBlocks) {
    if (b.text.length <= MAX_BLOCK_CHARS) {
      blocks.push(b);
      continue;
    }
    const parts = chunkText(b.text, MAX_BLOCK_CHARS);
    parts.forEach((p, i) => blocks.push({ title: b.title ? `${b.title}（${i + 1}/${parts.length}）` : "", text: p }));
  }
  const existingKps: KnowledgePoint[] = data.knowledgePoints.filter((k) => k.courseId === material.courseId);
  // 课程上下文：目录 + 已有知识点名（供提示词对齐术语、去重）
  const course = data.courses.find((c) => c.id === material.courseId);
  const courseChapters = data.chapters
    .filter((c) => c.courseId === material.courseId)
    .sort((a, b) => a.sort - b.sort);
  const tocLines = courseChapters
    .filter((ch) => ch.level === "chapter" || ch.parentId === null)
    .map((ch) => {
      const units = courseChapters
        .filter((c) => c.level === "unit" && c.parentId === ch.id)
        .map((u) => `  ${u.name}`)
        .join("\n");
      return ch.name + (units ? "\n" + units : "");
    })
    .join("\n");
  // 每块调用前刷新：同批先抽的块产出的 KP 也要进入后续块的上下文
  const buildKpNames = () => {
    const names = existingKps.map((k) => k.name);
    return names.length ? names.join("、") : "（暂无）";
  };

  let newCount = 0;
  let duplicateCount = 0;
  const errors: string[] = [];

  for (let i = 0; i < blocks.length; i++) {
    if (options?.isAborted?.()) break;
    const block = blocks[i];
    // 每块 AI 调用前回调进度（供 UI 实时显示第 X/N 块）
    options?.onProgress?.(i + 1, blocks.length, block.title);
    // 根据块的章节标题查找已建立的章节（去编号 + 归一化 + 包含匹配），用于绑定知识点归属
    const blockChapter = block.title
      ? findChapterByTitle(
          data.chapters.filter((c) => c.courseId === material.courseId),
          block.title,
        )
      : undefined;
    // 该章下的小节列表：模型返回的 section 标题匹配到具体节后，知识点挂到节而非章
    const blockUnits = blockChapter
      ? data.chapters.filter((c) => c.level === "unit" && c.parentId === blockChapter.id)
      : [];
    const locator = block.title ? `章节：${block.title}` : `文本片段（第${i + 1}/${blocks.length}块）`;
    try {
      const extractVars = {
        locator,
        blockText: block.text,
        courseName: course?.name ?? "",
        tocLines: tocLines || "（暂无目录）",
        existingKpNames: buildKpNames(),
      };
      const extractTpl = resolvePromptTemplate(data, taskKey);
      const res = await callAi({
        providerId: binding.providerId,
        modelId: binding.modelId,
        taskKey,
        scope: "material-" + material.id,
        messages: [
          { role: "system", content: renderPrompt(extractTpl.system, extractVars) },
          { role: "user", content: renderPrompt(extractTpl.user, extractVars) },
        ],
      });
      const { kps: items, parseFailed } = parseAiKpResponse(res.content);
      if (parseFailed) errors.push(`第 ${i + 1} 块 AI 输出无法解析`);
      for (const item of items) {
        const trimmedName = item.name.trim();
        if (!trimmedName) continue;
        const existing: KnowledgePoint | undefined = existingKps.find(
          (k) => isDuplicateKpName(k.name, trimmedName),
        );
        if (existing) {
          duplicateCount++;
          // 合并来源资料，让知识点反映覆盖它的全部资料
          const srcIds = existing.sourceAssetIds.split(",").map((s) => s.trim()).filter(Boolean);
            if (!srcIds.includes(String(material.id))) {
              existing.sourceAssetIds = [...srcIds, String(material.id)].join(",");
            }
        } else {
          // section 标题匹配到具体小节则挂到节，否则回退挂章
          const matchedUnit =
            item.section && blockUnits.length > 0
              ? findChapterByTitle(blockUnits, item.section)
              : undefined;
          const kpNode = matchedUnit ?? blockChapter;
          const newKp: KnowledgePoint = {
            id: data.knowledgePoints.reduce((m, k) => Math.max(m, k.id), 0) + 1,
            courseId: material.courseId,
            chapterId: kpNode?.id ?? null,
            blockId: null,
            name: trimmedName,
            content: item.description,
            mastery: "unlearn",
            sourceAssetIds: String(material.id),
            prevKpIds: "",
            chapterName: matchedUnit ? matchedUnit.name : block.title,
            sort: 0,
            createTime: new Date().toISOString(),
          };
          data.knowledgePoints.push(newKp);
          // 加入快照，确保同批后续同名知识点去重
          existingKps.push(newKp);
          newCount++;
        }
      }
    } catch (e) {
      if (e instanceof AiCanceledError) {
        // 用户取消：停止后续块，不计为失败
        break;
      }
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`第 ${i + 1} 块失败：${msg}`);
    }
  }

  await saveData(data);
  return { newCount, duplicateCount, totalChunks: blocks.length, errors };
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

export function cancelExtractTask(materialId: number): void {
  const flag = extractAbortFlags.get(materialId);
  if (flag) flag.aborted = true;
  // 打断在途 AI 调用（forwardProxy 无网络层 abort：响应返回后丢弃）
  cancelAiCall("extract_kp", "material-" + materialId);
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
    if (reporter) reporter.fail(e, "知识点抽取失败");
  } finally {
    extractAbortFlags.delete(materialId);
  }
}

/** 标签输入解析：中英文逗号/分号分隔，去空白去重 */
export function parseTagsInput(input: string): string[] {
  return [...new Set(input.split(/[,，;；]/).map((t) => t.trim()).filter(Boolean))];
}

