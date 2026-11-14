// 阶段⑤ 按节点题目识别：资料 → 映射覆盖的章节节点（无映射回落整段正文），
// AI 按节点识别正文中实际出现的题目（例题/练习/考点条目，不新编），
// 题干归一化去重、kpNames → kpIds、source=material 入库
import { getData } from "./storage";
import { callAi, AiCanceledError, findTaskBinding, cancelAiCall } from "./ai";
import { resolvePromptTemplate, renderPrompt } from "./promptTemplates";
import { buildChapterTree, chapterPathText, type NestedChapter } from "../utils/outline";
import { extractJsonCandidates, parseJsonCandidates, unwrapArray } from "../utils/aiJson";
import { QUESTION_TYPES, type QuestionType } from "./constants";
import { importQuestions, type QuestionDraft } from "./question";
import { startBgTask, type BgTaskReporter } from "./bgTask";
import { materialTaskId } from "../stores/notify";
import { buildNodeText, sliceNodeText } from "./nodeExtract";
import type { AppData } from "../types/appData";

/** 资料 → 映射覆盖的章节节点集合（章节树文档序）；空映射返回空数组（调用方回落整段正文） */
export function resolveMaterialQuestionNodes(data: AppData, materialId: number): number[] {
  const material = data.materials.find((m) => m.id === materialId);
  if (!material) return [];
  const courseId = material.courseId;
  const nodes = [
    ...new Set(
      data.tocMappings
        .filter((m) => m.courseId === courseId && m.materialId === materialId)
        .map((m) => m.chapterId),
    ),
  ];
  const order = new Map<number, number>();
  let i = 0;
  const walk = (list: NestedChapter[]): void => {
    for (const n of list) {
      order.set(n.chapter.id, i++);
      walk(n.children);
    }
  };
  walk(buildChapterTree(data.chapters.filter((c) => c.courseId === courseId), courseId));
  return nodes.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
}

export interface RawQuestionItem {
  qType: QuestionType;
  title: string;
  options: string[];
  answer: string;
  analysis: string;
  kpNames: string[];
}

/** 题干归一化（本地去重）：小写、去空白与标点。题干长，只做精确匹配不做相互包含（防误判） */
export function normalizeQuestionTitle(s: string): string {
  return s.toLowerCase().replace(/[\s、，。；：！？（）()【】\[\]{}'"“”‘’·\-—/\\,.!?]/g, "");
}

/** 解析题目识别响应 [{qType,title,options,answer,analysis,kpNames}]；条目不合格（无题干）丢弃 */
export function parseQuestionItems(content: string): RawQuestionItem[] {
  const arr = unwrapArray(parseJsonCandidates(extractJsonCandidates(content, "array"))) as
    | Record<string, unknown>[]
    | null;
  if (!arr) return [];
  const out: RawQuestionItem[] = [];
  for (const it of arr) {
    const title = typeof it.title === "string" ? it.title.trim() : "";
    if (!title) continue;
    const qTypeRaw = typeof it.qType === "string" ? it.qType : "";
    let qType = QUESTION_TYPES.includes(qTypeRaw as QuestionType) ? (qTypeRaw as QuestionType) : "essay";
    let options: string[] = [];
    if (Array.isArray(it.options)) {
      options = (it.options as unknown[])
        .filter((o): o is string => typeof o === "string")
        .map((o) => o.trim())
        .filter(Boolean);
    }
    if (options.length === 1) options = []; // 单选项不合格，视为无选项
    // 无选项不得标为单选/多选（刷题页按选项渲染，会无法作答）→ 回落 essay
    if ((qType === "single" || qType === "multiple") && options.length < 2) qType = "essay";
    const answer = typeof it.answer === "string" ? it.answer.trim() : "";
    const analysis = typeof it.analysis === "string" ? it.analysis.trim() : "";
    let kpNames: string[] = [];
    if (Array.isArray(it.kpNames)) {
      kpNames = (it.kpNames as unknown[])
        .filter((n): n is string => typeof n === "string")
        .map((n) => n.trim())
        .filter(Boolean);
    } else if (typeof it.kpNames === "string" && it.kpNames.trim()) {
      kpNames = [it.kpNames.trim()];
    }
    out.push({ qType, title, options, answer, analysis, kpNames });
  }
  return out;
}

export interface ExtractNodeQuestionResult {
  created: number;
  skippedDup: number;
  skippedNoAnswer: number;
}

/**
 * 识别单个节点：正文（>60K 分片）→ AI → 校验（带选项无答案丢弃）→ 题干去重 → kpNames 挂接 → 入库。
 * nodeId=null 为整段回落（资料无结构映射）：正文=资料 contentText，kpNames 无候选。
 */
export async function extractNodeQuestions(
  courseId: number,
  nodeId: number | null,
  materialId: number,
  onProgress?: (done: number, total: number) => void,
  isAborted?: () => boolean,
): Promise<ExtractNodeQuestionResult> {
  const data = await getData();
  const binding = findTaskBinding(data, "extract_question", courseId);
  if (!binding) {
    throw new Error("未配置「文档题目识别」模型：请到「模型配置 → 任务模型」为该任务指定模型");
  }
  const tpl = resolvePromptTemplate(data, "extract_question");
  const course = data.courses.find((c) => c.id === courseId);
  if (!course) throw new Error("课程不存在或已删除");
  const chapters = data.chapters.filter((c) => c.courseId === courseId);

  let text = "";
  let nodePath = "整份资料";
  let siblings: string[] = [];
  let nodeKps: { id: number; name: string }[] = [];
  if (nodeId != null) {
    ({ text } = buildNodeText(data, nodeId));
    const node = chapters.find((c) => c.id === nodeId);
    nodePath = node ? chapterPathText(chapters, nodeId) : "";
    // 兄弟节点 = 同父的其他子节点（提示词边界：不得识别兄弟内容）
    siblings = node
      ? chapters
          .filter((c) => (node.parentId === null ? c.parentId === null : c.parentId === node.parentId) && c.id !== nodeId)
          .map((c) => c.name)
      : [];
    nodeKps = data.knowledgePoints
      .filter((k) => k.courseId === courseId && k.chapterId === nodeId)
      .map((k) => ({ id: k.id, name: k.name }));
  } else {
    const material = data.materials.find((m) => m.id === materialId);
    if (!material) throw new Error("资料不存在");
    text = material.contentText;
  }
  if (!text.trim()) return { created: 0, skippedDup: 0, skippedNoAnswer: 0 };

  const courseQuestions = data.questions.filter((q) => q.courseId === courseId);
  const chunks = sliceNodeText(text);
  const scope = nodeId != null ? `node-${nodeId}` : `material-${materialId}`;

  let raw: RawQuestionItem[] = [];
  for (let i = 0; i < chunks.length; i++) {
    if (isAborted?.()) throw new AiCanceledError();
    onProgress?.(i, chunks.length);
    const partNote = chunks.length > 1 ? `\n（本节点正文较长，以下为第 ${i + 1}/${chunks.length} 片）` : "";
    const res = await callAi({
      providerId: binding.providerId,
      modelId: binding.modelId,
      taskKey: "extract_question",
      scope,
      messages: [
        { role: "system", content: renderPrompt(tpl.system, {}) },
        {
          role: "user",
          content: renderPrompt(tpl.user, {
            courseName: course.name,
            chapter: nodePath,
            siblings: siblings.length ? siblings.join("、") : "（无）",
            nodeKps: nodeKps.map((k) => k.name).join("、") || "（无）",
            existingQuestions: courseQuestions.map((q) => q.title).slice(0, 300).join("\n") || "（无）",
            text: chunks[i] + partNote,
          }),
        },
      ],
    });
    raw = raw.concat(parseQuestionItems(res.content));
  }
  onProgress?.(chunks.length, chunks.length);

  // 去重：课程已有题目 + 本批（题干归一化精确匹配）；importQuestions 内部重取最新数据落库（防脏写）
  const latest = await getData();
  const courseLatest = latest.questions.filter((q) => q.courseId === courseId);
  const seenTitles = new Set(courseLatest.map((q) => normalizeQuestionTitle(q.title)));
  const kpByName = new Map(nodeKps.map((k) => [k.name, k.id]));
  const drafts: QuestionDraft[] = [];
  let created = 0;
  let skippedDup = 0;
  let skippedNoAnswer = 0;
  for (const item of raw) {
    const norm = normalizeQuestionTitle(item.title);
    if (!norm || seenTitles.has(norm)) {
      skippedDup++;
      continue;
    }
    // 带选项的客观题缺答案无法作答：prompt 已禁止输出，此处双保险丢弃
    if (item.options.length > 0 && !item.answer) {
      skippedNoAnswer++;
      continue;
    }
    const kpIds = [
      ...new Set(
        item.kpNames.map((n) => kpByName.get(n)).filter((id): id is number => id != null),
      ),
    ];
    seenTitles.add(norm);
    drafts.push({
      title: item.title,
      options: item.options,
      answer: item.answer,
      analysis: item.analysis,
      qType: item.qType,
      difficulty: "medium",
      kpIds,
    });
    created++;
  }
  if (created > 0) await importQuestions(courseId, drafts, { source: "material" });
  return { created, skippedDup, skippedNoAnswer };
}

export interface ExtractQuestionsResult {
  created: number;
  skippedDup: number;
  skippedNoAnswer: number;
  nodeTotal: number;
}

/** 资料级题目识别：节点集（无映射回落整段单节点），逐节点识别并汇总 */
export async function extractQuestionsFromMaterial(
  materialId: number,
  options?: {
    isAborted?: () => boolean;
    onProgress?: (current: number, total: number, nodePath: string) => void;
  },
): Promise<ExtractQuestionsResult> {
  const data = await getData();
  const material = data.materials.find((m) => m.id === materialId);
  if (!material) throw new Error("资料不存在");
  const courseId = material.courseId;
  const nodes = resolveMaterialQuestionNodes(data, materialId);
  const targets: { nodeId: number | null; path: string }[] =
    nodes.length > 0
      ? nodes.map((nid) => ({ nodeId: nid, path: chapterPathText(data.chapters.filter((c) => c.courseId === courseId), nid) }))
      : [{ nodeId: null, path: "整份资料" }];
  let created = 0;
  let skippedDup = 0;
  let skippedNoAnswer = 0;
  for (let i = 0; i < targets.length; i++) {
    if (options?.isAborted?.()) throw new AiCanceledError();
    options?.onProgress?.(i, targets.length, targets[i].path);
    const r = await extractNodeQuestions(courseId, targets[i].nodeId, materialId, undefined, options?.isAborted);
    created += r.created;
    skippedDup += r.skippedDup;
    skippedNoAnswer += r.skippedNoAnswer;
  }
  return { created, skippedDup, skippedNoAnswer, nodeTotal: targets.length };
}

const qExtractAbortFlags = new Map<number, { aborted: boolean }>();
const extractingQuestions = new Set<number>();

export function isExtractingQuestions(materialId: number): boolean {
  return extractingQuestions.has(materialId);
}

export function startExtractQuestionTask(materialId: number, courseId: number): void {
  if (extractingQuestions.has(materialId)) return;
  const flag = { aborted: false };
  qExtractAbortFlags.set(materialId, flag);
  void runQExtractTask(materialId, courseId, flag);
}

export async function cancelExtractQuestionTask(materialId: number): Promise<void> {
  const flag = qExtractAbortFlags.get(materialId);
  if (flag) flag.aborted = true;
  // 打断在途 AI 调用（forwardProxy 无网络层 abort：响应返回后丢弃）；
  // 在途节点必在资料映射覆盖的节点内（整段回落时补 material scope）
  const data = await getData();
  const nodeIds = [
    ...new Set(
      data.tocMappings.filter((m) => m.materialId === materialId).map((m) => m.chapterId),
    ),
  ];
  for (const nid of nodeIds) cancelAiCall("extract_question", `node-${nid}`);
  cancelAiCall("extract_question", `material-${materialId}`);
}

async function runQExtractTask(
  materialId: number,
  courseId: number,
  flag: { aborted: boolean },
): Promise<void> {
  const taskId = materialTaskId(materialId, "qextract");
  let reporter: BgTaskReporter | null = null;
  extractingQuestions.add(materialId);
  try {
    const data = await getData();
    const material = data.materials.find((m) => m.id === materialId);
    if (!material) throw new Error("资料不存在");
    reporter = startBgTask({
      taskId,
      taskType: "qextract",
      label: material.name,
      materialId,
      courseId,
      message: "准备中…",
    });
    const result = await extractQuestionsFromMaterial(materialId, {
      isAborted: () => flag.aborted,
      onProgress: (current, total, nodePath) => {
        if (total > 0) {
          reporter?.progress({
            done: current,
            total,
            message: `题目识别：第 ${current + 1}/${total} 块${nodePath ? " · " + nodePath : ""}`,
          });
        }
      },
    });
    if (flag.aborted) {
      reporter.canceled();
      return;
    }
    let msg = `题目识别完成：新增 ${result.created} 题，跳过重复 ${result.skippedDup} 题`;
    if (result.skippedNoAnswer > 0) msg += `，${result.skippedNoAnswer} 题缺答案未入库`;
    if (result.created === 0 && result.skippedDup === 0) msg = "未识别到新题目（正文中可能没有带题干的题目/考点）";
    reporter.done(msg);
  } catch (e) {
    // 用户取消（flag 或节点层 AiCanceledError 上抛）：按取消处理，不计为失败
    if (e instanceof AiCanceledError || flag.aborted) {
      if (reporter) reporter.canceled();
    } else {
      if (reporter) reporter.fail(e, "题目识别失败");
    }
  } finally {
    qExtractAbortFlags.delete(materialId);
    extractingQuestions.delete(materialId);
  }
}
