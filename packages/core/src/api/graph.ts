import type { AppData } from "../types/appData";
import { getData, saveData } from "./storage";
import { findTaskBinding, callAi } from "./ai";
import { formatLocalDate, parseKpPrevIds, truncateText } from "./format";
import { resolvePromptTemplate, renderPrompt } from "./promptTemplates";
import { getSettings } from "./settings";
import { ensureFolder, createDoc } from "./docStore";

const GRAPH_BATCH_SIZE = 30;

/**
 * AI 推理课程内知识点的前置关系，写入 prevKpIds（按批调用，批间关系不推理）。
 * reset=true 时先清空本课程既有关系再写入。返回推理得到的关系条数。
 */
export async function inferGraphRelations(courseId: number, reset = true): Promise<number> {
  const data: AppData = await getData();
  const kps = data.knowledgePoints.filter((k) => k.courseId === courseId);
  if (kps.length === 0) {
    throw new Error("该课程暂无知识点，请先在「课程内容」抽取知识点");
  }
  const binding = findTaskBinding(data, "infer_graph", courseId);
  if (!binding) {
    throw new Error(
      "未配置 AI 任务模型，请前往「模型配置 → AI 任务模型分配」设置「infer_graph」任务或「全局默认模型」",
    );
  }
  if (reset) {
    for (const k of kps) k.prevKpIds = "";
  }
  let totalEdges = 0;
  for (let i = 0; i < kps.length; i += GRAPH_BATCH_SIZE) {
    const batch = kps.slice(i, i + GRAPH_BATCH_SIZE);
    const byId = new Map(batch.map((k) => [k.id, k]));
    const kpLines = batch.map((k) => `- ${k.id}. ${k.name}：${truncateText(k.content, 120) || "暂无描述"}`).join("\n");
    const graphVars = { kpLines };
    const graphTpl = resolvePromptTemplate(data, "infer_graph");
    const res = await callAi({
      providerId: binding.providerId,
      modelId: binding.modelId,
      taskKey: "infer_graph",
      scope: "course-" + courseId,
      messages: [
        { role: "system", content: renderPrompt(graphTpl.system, graphVars) },
        { role: "user", content: renderPrompt(graphTpl.user, graphVars) },
      ],
    });
    const trimmed = res.content.trim();
    const jsonMatch =
      trimmed.match(/```(?:json)?\s*([\s\S]*?)```/) || trimmed.match(/(\[[\s\S]*\])/);
    const candidate = (jsonMatch ? jsonMatch[1] : trimmed).trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      parsed = null;
    }
    const items = Array.isArray(parsed) ? parsed : [];
    for (const it of items) {
      const rec = (it ?? {}) as { kpId?: unknown; prevKpIds?: unknown };
      if (typeof rec !== "object") continue;
      const kpId = Number(rec.kpId);
      const kp = byId.get(kpId);
      if (!kp) continue;
      const prevs = Array.isArray(rec.prevKpIds)
        ? [...new Set(rec.prevKpIds.map((n) => Number(n)).filter((n) => Number.isFinite(n) && byId.has(n) && n !== kpId))]
        : [];
      kp.prevKpIds = prevs.join(",");
      totalEdges += prevs.length;
    }
    await saveData(data);
  }
  return totalEdges;
}

/** 手动添加一条前置关系（prevKpId 是 kpId 的前置）；已存在时直接返回 */
export async function addKpEdge(kpId: number, prevKpId: number): Promise<void> {
  if (kpId === prevKpId) {
    throw new Error("知识点不能是自己的前置");
  }
  const data = await getData();
  const kp = data.knowledgePoints.find((k) => k.id === kpId);
  if (!kp) {
    throw new Error("知识点不存在，可能已被删除");
  }
  const ids = kp.prevKpIds.split(",").map((s) => s.trim()).filter(Boolean);
  if (!ids.includes(String(prevKpId))) {
    kp.prevKpIds = [...ids, String(prevKpId)].join(",");
    await saveData(data);
  }
}

/** 手动移除一条前置关系 */
export async function removeKpEdge(kpId: number, prevKpId: number): Promise<void> {
  const data = await getData();
  const kp = data.knowledgePoints.find((k) => k.id === kpId);
  if (!kp) {
    throw new Error("知识点不存在，可能已被删除");
  }
  kp.prevKpIds = kp.prevKpIds
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && s !== String(prevKpId))
    .join(",");
  await saveData(data);
}

/** 将课程知识图谱写为思源文档（课程文档下的「知识图谱」子文档，已存在时带日期后缀），返回文档名 */
export async function writeGraphToSiyuan(courseId: number): Promise<string> {
  const data = await getData();
  const course = data.courses.find((c) => c.id === courseId);
  if (!course) {
    throw new Error("课程不存在");
  }
  const settings = await getSettings();
  if (!settings.persistToSiyuan) {
    throw new Error("请先在「模型配置 → 数据与存储」开启「资料持久化到思源」");
  }
  const kps = data.knowledgePoints.filter((k) => k.courseId === courseId);
  const nameById = new Map(kps.map((k) => [k.id, k.name]));
  const lines = kps.map((k) => {
    const prevs = parseKpPrevIds(k)
      .map((id) => nameById.get(id))
      .filter((n): n is string => Boolean(n));
    return `- **${k.name}**${prevs.length ? `（前置：${prevs.join("、")}）` : ""}`;
  });
  const markdown =
    `# 知识图谱\n\n课程：${course.name}\n\n## 前置关系\n\n${lines.join("\n") || "（暂无知识点）"}`;
  const notebook = await ensureFolder(settings.notebookName);
  const baseName = "知识图谱";
  // 直接父文档 id（课程文档）：消除 3.8.9 新标题模式下同名祖先的路径歧义
  const parentID = course.siyuanDocId;
  try {
    await createDoc(markdown, `/${course.name}/${baseName}`, notebook, parentID);
    return baseName;
  } catch {
    // 同名文档已存在时回退为带日期的文档名
    const stamped = `${baseName} ${formatLocalDate()}`;
    await createDoc(markdown, `/${course.name}/${stamped}`, notebook, parentID);
    return stamped;
  }
}
