import type { Chapter, Course, ExplainRecord, KnowledgePoint } from "../types/appData";
import { getData, saveData } from "./storage";
import { getSettings } from "./settings";
import { ensureNotebook } from "./siyuanDoc";

const CONV_BEGIN = "<!-- ai-study:conversations:begin -->";
const CONV_END = "<!-- ai-study:conversations:end -->";

/** 按 KP 挂载节点定位对话文档：章 → /课程/章/学习对话；节 → /课程/章/节/学习对话；未挂载 → 课程级兜底 */
function convDocTarget(
  course: Course,
  chapters: Chapter[],
  kp: KnowledgePoint,
): { path: string; key: string; label: string } {
  const base = `/${course.name}`;
  const fallback = { path: `${base}/学习对话`, key: `course-${course.id}`, label: course.name };
  if (kp.chapterId == null) return fallback;
  const node = chapters.find((c) => c.id === kp.chapterId);
  if (!node) return fallback;
  if (node.level === "chapter" || node.parentId == null) {
    return { path: `${base}/${node.name}/学习对话`, key: String(node.id), label: node.name };
  }
  const parent = chapters.find((c) => c.id === node.parentId);
  if (!parent) {
    return { path: `${base}/${node.name}/学习对话`, key: String(node.id), label: node.name };
  }
  return {
    path: `${base}/${parent.name}/${node.name}/学习对话`,
    key: String(node.id),
    label: `${parent.name} · ${node.name}`,
  };
}

/** 构建对话文档 markdown（只含本节点下有记录的 KP，sort 序；轮次时间升序） */
function buildConvMarkdown(label: string, kps: KnowledgePoint[], records: ExplainRecord[]): string {
  const byKp = new Map<number, ExplainRecord[]>();
  for (const r of records) {
    const list = byKp.get(r.kpId) ?? [];
    list.push(r);
    byKp.set(r.kpId, list);
  }
  const sections: string[] = [];
  for (const kp of [...kps].sort((a, b) => a.sort - b.sort)) {
    const list = byKp.get(kp.id);
    if (!list || list.length === 0) continue;
    list.sort((a, b) => a.createTime.localeCompare(b.createTime) || a.id - b.id);
    const rounds = list.map((r, i) => {
      const time = new Date(r.createTime).toLocaleString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      return [
        `### 第 ${i + 1} 轮 · ${time} · ${r.aiScore} 分`,
        `**AI 提问**：${r.askPrompt || "（历史轮次未记录提问）"}`,
        `**我的讲解**：${r.userContent}`,
        `**AI 评估**：${r.aiFeedback || "（无点评）"}`,
      ].join("\n\n");
    });
    sections.push(`## ${kp.name}\n\n${rounds.join("\n\n")}`);
  }
  return (
    `# 学习对话\n\n> 本文档由「AI 研习」插件自动维护（${label}）。锚点外内容不会被插件修改。\n\n` +
    `${CONV_BEGIN}\n\n${sections.join("\n\n") || "（暂无学习对话）"}\n\n${CONV_END}\n`
  );
}

/** 把新锚点区合并进旧文档：两锚点齐全 → 只替换中间；缺锚点 → 重建并保留旧文（去标题）到锚点后 */
function mergeConvMarkdown(oldMd: string, newMd: string): string {
  const beginIdx = oldMd.indexOf(CONV_BEGIN);
  const endIdx = oldMd.indexOf(CONV_END);
  if (beginIdx >= 0 && endIdx > beginIdx) {
    const newBegin = newMd.indexOf(CONV_BEGIN);
    const newEnd = newMd.indexOf(CONV_END);
    const header = newMd.slice(0, newBegin);
    const managed = newMd.slice(newBegin, newEnd + CONV_END.length);
    const tail = oldMd.slice(endIdx + CONV_END.length).trim();
    return header + managed + (tail ? `\n\n${tail}\n` : "\n");
  }
  const oldBody = oldMd.replace(/^\s*#\s+[^\n]*\n/, "").trim();
  return newMd + (oldBody ? `\n\n${oldBody}\n` : "");
}

/**
 * 同步 KP 所属章/节节点的讲解对话到思源（幂等：整段重建锚点区）。
 * fire-and-forget 语义：不阻塞主流程，失败仅提示。
 */
export async function syncExplainConversations(courseId: number, kpId: number): Promise<void> {
  const data = await getData();
  const settings = await getSettings();
  if (!settings.persistToSiyuan) return;
  const course = data.courses.find((c) => c.id === courseId);
  const kp = data.knowledgePoints.find((k) => k.id === kpId);
  if (!course || !kp) return;
  const target = convDocTarget(course, data.chapters, kp);

  const nodeKps = data.knowledgePoints.filter(
    (k) => k.courseId === courseId && convDocTarget(course, data.chapters, k).key === target.key,
  );
  const nodeKpIds = new Set(nodeKps.map((k) => k.id));
  const records = data.explainRecords.filter((r) => nodeKpIds.has(r.kpId));
  const newMd = buildConvMarkdown(target.label, nodeKps, records);

  try {
    if (!data.conversationsDocs) data.conversationsDocs = {};
    const entry = data.conversationsDocs[target.key];
    if (entry?.docId) {
      const current =
        (await window.siyuanAiStudy.getSiyuanDocMarkdown(entry.docId)) ?? entry.lastMarkdown ?? null;
      if (!current) {
        window.siyuanAiStudy.showMessage("学习对话文档读取失败，本次跳过同步", 4000, "error");
        return;
      }
      const merged = mergeConvMarkdown(current, newMd);
      await window.siyuanAiStudy.updateSiyuanDoc(entry.docId, merged);
      data.conversationsDocs[target.key] = { docId: entry.docId, lastMarkdown: merged };
    } else {
      const notebook = await ensureNotebook(settings.notebookName);
      const { id } = await window.siyuanAiStudy.createSiyuanDoc(newMd, target.path, notebook);
      data.conversationsDocs[target.key] = { docId: id, lastMarkdown: newMd };
    }
    await saveData(data);
  } catch (e) {
    console.error("学习对话落库失败:", e);
    window.siyuanAiStudy.showMessage(e instanceof Error ? e.message : "学习对话落库失败", 4000, "error");
  }
}

/** 开启持久化时落库思源，返回文档 id；未开启或失败时返回 null（不阻塞主流程） */
