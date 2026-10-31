import type { AppData, Material } from "../types/appData";
import type { ParsedHeading } from "../utils/documentParser";
import { getData, saveData } from "./storage";
import { removeCsvIds } from "../utils/csvIds";
import { nextId, now, truncateText } from "./format";
import { MATERIAL_SOURCE_LABELS } from "./constants";
import { findTaskBinding, callAi, cancelAiCall, AiCanceledError } from "./ai";
import { stripThinkBlocks } from "../utils/aiJson";
import { resolvePromptTemplate, renderPrompt } from "./promptTemplates";
import { startBgTask } from "./bgTask";
import { materialTaskId } from "../stores/notify";
import { useModalStore } from "../stores/modal";
import { createDoc, ensureFolder, removeDoc, persistDocIfEnabled } from "./docStore";
import { getBridge } from "@/bridge";

// 删除资料的源文件（思源资源目录）：其他资料仍引用同一文件时跳过；
// 内核仅允许删除未被任何文档引用的资源，被引用（如用户手动拖入笔记）时仅记录日志不阻塞
export async function removeAssetIfUnused(assetPath: string, remainingMaterials: Material[]): Promise<void> {
  if (!assetPath) return;
  if (remainingMaterials.some((m) => m.assetPath === assetPath)) return;
  try {
    await getBridge().removeAsset(assetPath);
  } catch (e) {
    console.error("删除思源资源文件失败:", e);
  }
}

export async function createMaterial(input: {
  courseId: number;
  name: string;
  fileType: string;
  contentText: string;
  assetPath?: string;
  headings?: string;
  source?: string;
  /** 绑定思源已有文档：直接记录其 docId，跳过落库（避免重复建档） */
  siyuanDocId?: string;
}): Promise<Material> {
  const data = await getData();
  const course = data.courses.find((c) => c.id === input.courseId);
  // 绑定已有文档时直接用其 docId；否则按设置决定是否落库思源（资料文档放课程文档下「资料库」目录）
  const docId =
    input.siyuanDocId ??
    (await persistDocIfEnabled(
      `# ${input.name}\n\n${input.contentText}`,
      `/${course?.name ?? "课程"}/资料库/${input.name}`,
      `资料「${input.name}」文档`,
    ));
  const material: Material = {
    id: nextId(data.materials),
    courseId: input.courseId,
    name: input.name,
    assetPath: input.assetPath ?? "",
    fileType: input.fileType,
    contentText: input.contentText,
    headings: input.headings ?? "[]",
    siyuanDocId: docId,
    status: "parsed",
    createTime: now(),
    source: input.source ?? (input.assetPath ? "upload" : "paste"),
  };
  data.materials.push(material);
  await saveData(data);
  return material;
}

// 模块级状态不受组件卸载影响：上传后弹窗即关、切页不中断；同一资料防并发
const organizingMaterialIds = new Set<number>();
const organizeAbortFlags = new Map<number, { aborted: boolean }>();

/** 文本切段：按空行分段聚合到 ~size 字符；单段超限（OCR 长行）硬切 */
function splitTextChunks(text: string, size = 8000): string[] {
  const chunks: string[] = [];
  let current = "";
  const push = () => {
    const t = current.trim();
    if (t) chunks.push(t);
    current = "";
  };
  for (const para of text.split(/\n\s*\n/)) {
    if (para.length > size) {
      push();
      for (let i = 0; i < para.length; i += size) {
        chunks.push(para.slice(i, i + size));
      }
      continue;
    }
    if (current.length + para.length + 2 > size) push();
    current += (current ? "\n\n" : "") + para;
  }
  push();
  return chunks;
}

export interface OrganizeResult {
  content: string;
  /** AI 是否实际参与（未配置任务模型时为 false，返回原文） */
  organized: boolean;
  /** 输出异常被弃用、保留原文的段数 */
  failedChunks: number;
}

/**
 * AI 文档结构梳理：分段 → 逐段调 callAi（删页眉页脚噪声/拼断行/标注章 # 节 ##）→ 拼接。
 * 安全网：段输出长度不足输入 40% 视为异常（防 AI 概括丢内容），该段保留原文。
 */
export async function organizeDocWithAi(
  text: string,
  materialId: number,
  courseId?: number,
  onProgress?: (done: number, total: number) => void,
  isAborted?: () => boolean,
): Promise<OrganizeResult> {
  const data = await getData();
  const binding = findTaskBinding(data, "organize_doc", courseId);
  if (!binding || !text.trim()) {
    return { content: text, organized: false, failedChunks: 0 };
  }
  const tpl = resolvePromptTemplate(data, "organize_doc");
  const chunks = splitTextChunks(text);
  const out: string[] = [];
  let failedChunks = 0;
  for (let i = 0; i < chunks.length; i++) {
    if (isAborted?.()) {
      out.push(...chunks.slice(i));
      break;
    }
    onProgress?.(i, chunks.length);
    const chunk = chunks[i];
    let cleaned = chunk;
    try {
      const res = await callAi({
        providerId: binding.providerId,
        modelId: binding.modelId,
        taskKey: "organize_doc",
        scope: "material-" + materialId,
        messages: [
          { role: "system", content: renderPrompt(tpl.system, {}) },
          { role: "user", content: renderPrompt(tpl.user, { chunk }) },
        ],
      });
      let candidate = res.content.trim();
      const fence = candidate.match(/^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/);
      if (fence) candidate = fence[1].trim();
      // 推理模型思考泄漏：content 混入思考文本时，取思考结束标记之后的正文
      candidate = stripThinkBlocks(candidate);
      if (candidate && candidate.length >= chunk.length * 0.4) {
        cleaned = candidate;
      } else {
        failedChunks++;
      }
    } catch (e) {
      if (e instanceof AiCanceledError) {
        // 用户取消：剩余段落保留原文，任务状态由调用方按 aborted 标为取消
        out.push(...chunks.slice(i));
        break;
      }
      console.error(`AI 梳理第 ${i + 1}/${chunks.length} 段失败:`, e);
      failedChunks++;
    }
    out.push(cleaned);
  }
  onProgress?.(chunks.length, chunks.length);
  return { content: out.join("\n\n").trim(), organized: true, failedChunks };
}

/**
 * 启动资料的后台 AI 梳理任务（不阻塞调用方）。
 * text 省略时：有源文件则重读重解析，无源文件（粘贴/思源）用已存内容。
 * 同一资料已有任务在跑时忽略重复启动。
 */
export function startOrganizeTask(materialId: number, courseId: number, text?: string): void {
  if (organizingMaterialIds.has(materialId)) return;
  organizingMaterialIds.add(materialId);
  const flag = { aborted: false };
  organizeAbortFlags.set(materialId, flag);
  void runOrganizeTask(materialId, courseId, text, flag);
}

export function cancelOrganizeTask(materialId: number): void {
  const flag = organizeAbortFlags.get(materialId);
  if (flag) flag.aborted = true;
  // 打断在途 AI 调用（forwardProxy 无网络层 abort：响应返回后丢弃）
  cancelAiCall("organize_doc", "material-" + materialId);
}

async function runOrganizeTask(
  materialId: number,
  courseId: number,
  text: string | undefined,
  flag: { aborted: boolean },
): Promise<void> {
  const orgTaskId = materialTaskId(materialId, "organize");
  let orgTask: ReturnType<typeof startBgTask> | null = null;
  try {
    const data = await getData();
    const material = data.materials.find((m) => m.id === materialId);
    if (!material) throw new Error("资料不存在或已删除");
    // 取待梳理文本：优先调用方提供的（上传即用内存文本，免二次下载）
    let source = text;
    if (!source) {
      if (material.assetPath) {
        const res = await fetch(material.assetPath);
        if (!res.ok) throw new Error("读取源文件失败，请重新上传");
        const blob = await res.blob();
        const { parseDocument } = await import("../utils/documentParser");
        const fileName = /\.(pdf|docx|pptx|txt|md|markdown)$/i.test(material.name)
          ? material.name
          : `${material.name}.${material.fileType}`;
        source = (await parseDocument(new File([blob], fileName))).contentText;
      } else {
        source = material.contentText;
      }
    }
    if (!source.trim()) throw new Error("资料没有可梳理的文本内容");
    orgTask = startBgTask({
      taskId: orgTaskId,
      taskType: "organize",
      label: material.name,
      materialId,
      courseId,
      message: "准备中…",
    });
    const res = await organizeDocWithAi(
      source,
      materialId,
      courseId,
      (done, total) => {
        if (total > 0) {
          orgTask?.progress({ done, total, message: `AI 梳理中：第 ${Math.min(done + 1, total)}/${total} 段…` });
        }
      },
      () => flag.aborted,
    );
    if (flag.aborted) {
      orgTask?.canceled();
      return;
    }
    if (!res.organized) {
      orgTask?.failWith("未配置「文档结构梳理」模型：请到「模型配置 → 任务模型」为该任务指定模型");
      return;
    }
    // 回写：整理后正文 + 标题结构（从 # / ## 行提取）+ 同步思源文档
    const latest = await getData();
    const mat = latest.materials.find((m) => m.id === materialId);
    if (!mat) throw new Error("资料已在任务期间被删除");
    const { extractHeadingsFromMarkdown } = await import("../utils/documentParser");
    const headings = extractHeadingsFromMarkdown(res.content);
    mat.contentText = res.content;
    mat.headings = JSON.stringify(headings);
    await saveData(latest);
    let siyuanSyncFailed = false;
    if (mat.siyuanDocId && getBridge().isValidDocRef(mat.siyuanDocId)) {
      try {
        await getBridge().updateDoc(mat.siyuanDocId, `# ${mat.name}\n\n${res.content}`);
      } catch (e) {
        siyuanSyncFailed = true;
        console.error("同步梳理结果到思源失败:", e);
      }
    }
    const chCount = headings.filter((h) => h.level === 1).length;
    let msg = `梳理完成：识别 ${chCount} 章 ${headings.length - chCount} 节`;
    if (res.failedChunks > 0) msg += `；${res.failedChunks} 段输出异常已保留原文`;
    if (siyuanSyncFailed) msg += "；同步思源文档失败";
    orgTask?.done(msg);
    // 自动目录模式：弹目录预览。目录从课程全部资料聚合识别（而非只弹本份），
    // 多份资料并行梳理时等全部梳理完（本份是最后一个）再弹，保证聚合目录完整
    const otherOrganizing = [...organizingMaterialIds].some((id) => id !== materialId);
    if (latest.settings.chapterMode === "auto" && headings.length > 0 && !otherOrganizing) {
      const { aggregateCourseToc } = await import("./kp");
      const agg = await aggregateCourseToc(courseId);
      if (agg.headings.length === 0) return;
      if (agg.corrected) {
        getBridge().showMessage("已用 AI 矫正目录，请在预览中核对后确认");
      } else if (agg.failed) {
        getBridge().showMessage("AI 目录矫正失败或结果不可用，已显示原始识别结果", 4000, "error");
      }
      useModalStore().openChapterPreview(courseId, agg.headings, materialId, agg.materialCount);
    }
  } catch (e) {
    orgTask?.fail(e, "AI 梳理失败");
  } finally {
    organizingMaterialIds.delete(materialId);
    organizeAbortFlags.delete(materialId);
  }
}

async function siyuanApi<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { code: number; msg?: string; data?: T };
  if (json.code !== 0) throw new Error(json.msg || "思源接口调用失败");
  return json.data as T;
}

export interface SiyuanDocEntry {
  id: string;
  path: string;
  name: string;
  subFileCount: number;
}

export async function listSiyuanNotebooks(): Promise<Array<{ id: string; name: string }>> {
  const data = await siyuanApi<{ notebooks: Array<{ id: string; name: string }> }>("notebook/lsNotebooks", {});
  return data.notebooks;
}

export async function listSiyuanDocs(notebookId: string, path: string): Promise<SiyuanDocEntry[]> {
  const data = await siyuanApi<{ files: SiyuanDocEntry[] }>("filetree/listDocsByPath", { notebook: notebookId, path });
  return data.files ?? [];
}

export async function getDocMarkdown(docId: string): Promise<{ hPath: string; content: string }> {
  return await siyuanApi<{ hPath: string; content: string }>("export/exportMdContent", { id: docId });
}

export interface SiyuanBlockEntry {
  id: string;
  content: string;
  type: string;
  subtype: string;
}

/** 文档直属块列表（blocks 表 parent_id = docId，3.8.8 实证）；占位符绑定防注入，LIMIT 200 截断时返回标记 */
export async function listSiyuanBlocks(docId: string): Promise<{ entries: SiyuanBlockEntry[]; truncated: boolean }> {
  const stmt = "SELECT id, content, type, subtype FROM blocks WHERE parent_id = ? ORDER BY sort LIMIT 200";
  const data = await siyuanApi<SiyuanBlockEntry[]>("query/sql", { stmt, binds: [docId] });
  const entries = data ?? [];
  return { entries, truncated: entries.length >= 200 };
}

/** 文档选择结果（资料导入 / 知识点绑定共用） */
export interface SiyuanDocSelection {
  docId: string;
  docName: string;
  /** 文档 markdown（已去 front-matter）；知识点绑定场景不使用 */
  markdown?: string;
  /** null/缺省 = 文档级绑定 */
  blockId: string | null;
  /** 展示名（文档级=文档名；块级=文档名 › 块预览） */
  label: string;
}

// 3.8.8 无 HTTP 打开接口，前端也不消费 URL hash（已实证）。
// 方案：钩取宿主应用的 webpack 运行时，取内部 openFileById({app,id}) 直接调用。
// 模块 ID 89925 为 3.8.8 的 openFileById 定义模块；其他版本回退扫描模块工厂源码。

interface WebpackRequireFn {
  (id: string): unknown;
  m?: Record<string, unknown>;
}

interface OpenFileByIdParams {
  app: unknown;
  id: string;
  action?: string[];
}

function hasWebpackChunk(w: Window): boolean {
  return Array.isArray((w as unknown as Record<string, unknown>).webpackChunkSiYuan);
}

/** 插件 UI 与主窗口可能同源同窗口，也可能在 iframe 内，两种都取宿主 */
function getHostWindow(): Window | null {
  if (hasWebpackChunk(window)) return window;
  try {
    const parent = window.parent;
    if (parent && parent !== window && hasWebpackChunk(parent)) return parent;
  } catch {
    // 跨域（理论上不存在，插件与内核同源）
  }
  return null;
}

function getWebpackRequire(host: Window): WebpackRequireFn | null {
  const hostRec = host as unknown as Record<string, unknown>;
  const cached = hostRec.__aiStudySyRequire;
  if (typeof cached === "function") return cached as WebpackRequireFn;
  const chunk = hostRec.webpackChunkSiYuan;
  if (!Array.isArray(chunk)) return null;
  let req: WebpackRequireFn | null = null;
  try {
    (chunk as unknown[]).push([
      ["__ai_study_probe"],
      {},
      (r: unknown) => {
        if (typeof r === "function") req = r as WebpackRequireFn;
      },
    ]);
  } catch {
    return null;
  }
  if (req) hostRec.__aiStudySyRequire = req;
  return req;
}

interface SiyuanGlobalState {
  siyuan?: { ws?: { app?: unknown } };
}

const OPEN_FILE_EXPORT_RE = /openFileById\s*:\s*(\(\)\s*=>|function)/;

function findOpenFileById(req: WebpackRequireFn): ((p: OpenFileByIdParams) => Promise<unknown>) | null {
  const tryId = (id: string): ((p: OpenFileByIdParams) => Promise<unknown>) | null => {
    try {
      const exp = req(id) as Record<string, unknown> | null;
      if (exp && typeof exp.openFileById === "function") {
        return exp.openFileById as (p: OpenFileByIdParams) => Promise<unknown>;
      }
    } catch {
      // 模块不存在或依赖缺失，继续
    }
    return null;
  };
  const known = tryId("89925");
  if (known) return known;
  const m = req.m;
  if (m) {
    for (const id of Object.keys(m)) {
      let src = "";
      try {
        src = String(m[id]);
      } catch {
        continue;
      }
      if (src.length > 300000 || !OPEN_FILE_EXPORT_RE.test(src)) continue;
      const found = tryId(id);
      if (found) return found;
    }
  }
  return null;
}

/** 在思源主工作区打开指定文档（当前标签页激活） */
export async function openSiyuanDoc(docId: string): Promise<void> {
  const host = getHostWindow();
  if (!host) throw new Error("无法访问思源主窗口");
  const req = getWebpackRequire(host);
  if (!req) throw new Error("无法访问思源内部模块（版本不支持）");
  const openFileById = findOpenFileById(req);
  if (!openFileById) throw new Error("未找到思源打开文档函数（版本不支持）");
  const app = (host as unknown as SiyuanGlobalState).siyuan?.ws?.app;
  if (!app) throw new Error("无法获取思源工作空间对象");
  await openFileById({ app, id: docId, action: ["cb-get-focus", "cb-get-scroll"] });
}

// 上传文件到思源资源目录，返回 asset 路径（用于重新解析）
export async function uploadAsset(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file[]", file);
  const res = await fetch("/api/asset/upload", { method: "POST", body: formData });
  const json = (await res.json()) as { code: number; data?: { succMap?: Record<string, string> | null } };
  const path = Object.values(json?.data?.succMap ?? {})[0] ?? "";
  if (!path) throw new Error("上传资源文件失败");
  return path;
}



export async function deleteMaterial(id: number): Promise<void> {
  const data = await getData();
  const material = data.materials.find((m) => m.id === id);
  data.materials = data.materials.filter((m) => m.id !== id);
  // 级联清理资料-章节关联与知识点的来源资料引用，避免悬挂引用
  data.materialChapters = data.materialChapters.filter((mc) => mc.materialId !== id);
  const removedMaterialIds = new Set([id]);
  for (const k of data.knowledgePoints) {
    k.sourceAssetIds = removeCsvIds(k.sourceAssetIds, removedMaterialIds);
  }
  await saveData(data);
  if (material?.siyuanDocId) {
    removeDoc(material.siyuanDocId).catch((e) => console.error("删除思源文档失败:", e));
  }
  if (material?.assetPath) {
    await removeAssetIfUnused(material.assetPath, data.materials);
  }
}

export async function queryMaterials(courseId: number): Promise<Material[]> {
  const data = await getData();
  // 按名称自然排序（数字感知），保证资料顺序稳定、目录识别按资料顺序
  return data.materials
    .filter((m) => m.courseId === courseId)
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true }));
}

