import type { Chapter, Course, ExplainRecord, KnowledgePoint } from "../types/appData";
import { getData, saveData } from "./storage";
import { getSettings } from "./settings";
import { ensureFolder } from "./docStore";
import { getBridge } from "@/bridge";

const CONV_BEGIN = "<!-- ai-study:conversations:begin -->";
const CONV_END = "<!-- ai-study:conversations:end -->";
/** 单个 KP 在对话文档中最多渲染的轮数：超出只渲染最近 N 轮（讲解记录不删除，数据仍在插件库里） */
export const CONV_MAX_ROUNDS = 50;

/** 按 KP 挂载节点定位对话文档：章 → /课程/章/学习对话；节 → /课程/章/节/学习对话；未挂载 → 课程级兜底 */
function convDocTarget(
  course: Course,
  chapters: Chapter[],
  kp: KnowledgePoint,
): { path: string; key: string; label: string; parentID: string | null } {
  const base = `/${course.name}`;
  const fallback = {
    path: `${base}/学习对话`,
    key: `course-${course.id}`,
    label: course.name,
    parentID: course.siyuanDocId,
  };
  if (kp.chapterId == null) return fallback;
  const node = chapters.find((c) => c.id === kp.chapterId);
  if (!node) return fallback;
  if (node.level === "chapter" || node.parentId == null) {
    return { path: `${base}/${node.name}/学习对话`, key: String(node.id), label: node.name, parentID: node.siyuanBlockId };
  }
  const parent = chapters.find((c) => c.id === node.parentId);
  if (!parent) {
    return { path: `${base}/${node.name}/学习对话`, key: String(node.id), label: node.name, parentID: node.siyuanBlockId };
  }
  return {
    path: `${base}/${parent.name}/${node.name}/学习对话`,
    key: String(node.id),
    label: `${parent.name} · ${node.name}`,
    parentID: node.siyuanBlockId,
  };
}

/** 构建对话文档 markdown（只含本节点下有记录的 KP，sort 序；轮次时间升序）。
 *  单 KP 超过 CONV_MAX_ROUNDS 轮时只渲染最近 N 轮（编号保留原始轮次），开头加归档注记。 */
export function buildConvMarkdown(label: string, kps: KnowledgePoint[], records: ExplainRecord[]): string {
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
    const hidden = list.length > CONV_MAX_ROUNDS ? list.length - CONV_MAX_ROUNDS : 0;
    const visible = hidden > 0 ? list.slice(hidden) : list;
    const rounds = visible.map((r, i) => {
      const time = new Date(r.createTime).toLocaleString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      return [
        `### 第 ${hidden + i + 1} 轮 · ${time} · ${r.aiScore} 分`,
        `**AI 提问**：${r.askPrompt || "（历史轮次未记录提问）"}`,
        `**我的讲解**：${r.userContent}`,
        `**AI 评估**：${r.aiFeedback || "（无点评）"}`,
      ].join("\n\n");
    });
    const note =
      hidden > 0 ? `> 共 ${list.length} 轮，仅显示最近 ${CONV_MAX_ROUNDS} 轮（更早的 ${hidden} 轮未删除，数据保留在插件中）\n\n` : "";
    sections.push(`## ${kp.name}\n\n${note}${rounds.join("\n\n")}`);
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

// per-doc 串行队列（storage.ts saveChain 同款）：同一目标节点的两轮对话同步串行，
// 避免并发读旧文档→各自合并→后写覆盖先写，丢一轮对话
const convSyncChains = new Map<string, Promise<unknown>>();

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

  const run = (convSyncChains.get(target.key) ?? Promise.resolve()).then(() =>
    syncConvDocSerial(courseId, target),
  );
  convSyncChains.set(target.key, run.catch(() => undefined));
  return run;
}

async function syncConvDocSerial(
  courseId: number,
  target: ReturnType<typeof convDocTarget>,
): Promise<void> {
  // 串行段内重新取数，确保上一轮同步已落库的讲解记录不丢
  const data = await getData();
  const settings = await getSettings();
  const course = data.courses.find((c) => c.id === courseId);
  if (!course) return;
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
      const current = await getBridge().getDocMarkdown(entry.docId);
      if (current != null) {
        const merged = mergeConvMarkdown(current, newMd);
        await getBridge().updateDoc(entry.docId, merged);
        data.conversationsDocs[target.key] = { docId: entry.docId, lastMarkdown: merged };
      } else if (await getBridge().docExists(entry.docId)) {
        // 文档存在但读取失败（瞬时错误）→ 跳过，避免用旧副本覆盖用户在思源里的改动
        getBridge().showMessage("学习对话文档读取失败，本次跳过同步", 4000, "error");
      } else {
        // 文档已被删除 → 重建（轮次数据都在库里，重建不丢内容）
        const notebook = await ensureFolder(settings.notebookName);
        const { id } = await getBridge().createDoc(newMd, target.path, notebook, target.parentID);
        data.conversationsDocs[target.key] = { docId: id, lastMarkdown: newMd };
        getBridge().showMessage("学习对话文档曾被删除，已自动重建", 3000);
      }
    } else {
      const notebook = await ensureFolder(settings.notebookName);
      const { id } = await getBridge().createDoc(newMd, target.path, notebook, target.parentID);
      data.conversationsDocs[target.key] = { docId: id, lastMarkdown: newMd };
    }
    await saveData(data);
  } catch (e) {
    console.error("学习对话落库失败:", e);
    getBridge().showMessage(e instanceof Error ? e.message : "学习对话落库失败", 4000, "error");
  }
}

/** 开启持久化时落库思源，返回文档 id；未开启或失败时返回 null（不阻塞主流程） */
