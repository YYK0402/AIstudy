// 知识点自动归位：未分配 + 孤儿 KP 两级匹配——本地确定性匹配（零成本）先行，
// 剩余走 AI 语义匹配（kp_relink 任务，每批 100 个）兜底；AI 输出 fail-loud 校验后直接落库，
// 并调度 KP 思源文档区域同步。孤儿 = chapterId 非空但对应章节已不存在（如章节被删）。
import type { AppData, Chapter, KnowledgePoint } from "../types/appData";
import { getData, saveData } from "./storage";
import { callAiWithRetry, AiCanceledError, findTaskBinding } from "./ai";
import { resolvePromptTemplate, renderPrompt } from "./promptTemplates";
import { extractJsonCandidates, parseJsonCandidates, stripThinkBlocks, unwrapArray } from "../utils/aiJson";
import { matchChapterForKp } from "./kpMatch";
import { buildChapterTree, type NestedChapter } from "../utils/outline";
import { effectiveNodeOf } from "../utils/kpTreeImport";
import { scheduleKpRegionSync } from "./kpDocSync";

const AI_BATCH_SIZE = 100;

export interface RelinkLink {
  kpId: number;
  chapterId: number;
  reason: string;
}

export interface RelinkOutcome {
  /** 归位总数（本地 + AI） */
  linked: number;
  /** 本地确定性匹配归位数 */
  linkedLocal: number;
  /** AI 匹配归位数 */
  linkedAi: number;
  /** 仍无法挂钩数（保持未分配/孤儿） */
  stuck: number;
  linkedIds: number[];
  /** 未配置模型，AI 阶段跳过 */
  aiSkipped: boolean;
  /** AI 阶段失败原因（null = 无失败） */
  aiError: string | null;
}

/** 归位范围：当前课程内未分配（chapterId=null）或孤儿（chapterId 指向已删章节）的知识点 */
export function findRelinkableKps(data: AppData, courseId: number): KnowledgePoint[] {
  const chapterIds = new Set(data.chapters.filter((c) => c.courseId === courseId).map((c) => c.id));
  return data.knowledgePoints.filter(
    (k) => k.courseId === courseId && (k.chapterId === null || !chapterIds.has(k.chapterId)),
  );
}

/** 校验 AI 的 [{"id","chapterId","reason"}] 数组（fail-loud：任一条非法即拒绝整批，防误挂） */
export function parseRelinkResponse(
  content: string,
  kpIds: Set<number>,
  chapterIds: Set<number>,
): RelinkLink[] {
  const parsed = parseJsonCandidates(extractJsonCandidates(stripThinkBlocks(content), "array"));
  const arr = unwrapArray(parsed);
  if (!arr) throw new Error("AI 归位结果不是合法 JSON 数组");
  const seen = new Set<number>();
  const out: RelinkLink[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("AI 归位结果含非对象条目");
    }
    const o = item as Record<string, unknown>;
    const kpId = o.id;
    const chapterId = o.chapterId;
    if (typeof kpId !== "number" || !kpIds.has(kpId)) {
      throw new Error("AI 返回了不存在的知识点 id");
    }
    if (seen.has(kpId)) throw new Error(`AI 重复归位了知识点 ${kpId}`);
    if (typeof chapterId !== "number" || !chapterIds.has(chapterId)) {
      throw new Error("AI 返回了不存在的章节 id");
    }
    seen.add(kpId);
    out.push({ kpId, chapterId, reason: typeof o.reason === "string" ? o.reason : "" });
  }
  return out;
}

/** 章节树 → 提示词行（树序，「id. L层级 名称」） */
function buildTreeLines(chapters: Chapter[], courseId: number): string {
  const lines: string[] = [];
  const walk = (nodes: NestedChapter[]) => {
    for (const n of nodes) {
      lines.push(`${n.chapter.id}. L${n.chapter.level} ${n.chapter.name}`);
      walk(n.children);
    }
  };
  walk(buildChapterTree(chapters, courseId));
  return lines.join("\n");
}

/** 待归位知识点 → 提示词行（内容摘要 100 字；保留原章节名供语义参考） */
function buildKpLines(kps: KnowledgePoint[]): string {
  return kps
    .map((k) => {
      const desc = k.content.trim().replace(/\s+/g, " ").slice(0, 100);
      return `- ${k.id}. ${k.name}${desc ? `：${desc}` : ""}${k.chapterName ? ` [原章节名：${k.chapterName}]` : ""}`;
    })
    .join("\n");
}

/** 两级归位主入口：本地先行 + AI 兜底，结果直接落库并调度文档同步 */
export async function relinkKps(courseId: number): Promise<RelinkOutcome> {
  const data = await getData();
  const course = data.courses.find((c) => c.id === courseId);
  if (!course) throw new Error("课程不存在或已删除");
  const targets = findRelinkableKps(data, courseId);
  if (targets.length === 0) {
    return { linked: 0, linkedLocal: 0, linkedAi: 0, stuck: 0, linkedIds: [], aiSkipped: false, aiError: null };
  }
  const courseChapters = data.chapters.filter((c) => c.courseId === courseId);

  // 阶段 A：本地确定性匹配（chapterName 宽松 + 名称精确，取最深）
  const localLinks = new Map<number, number>();
  for (const kp of targets) {
    const ch = matchChapterForKp(kp, courseChapters);
    if (ch) localLinks.set(kp.id, ch.id);
  }

  // 阶段 B：剩余走 AI（每批 100，顺序调用）
  const aiLinks = new Map<number, number>();
  let aiSkipped = false;
  let aiError: string | null = null;
  const remaining = targets.filter((k) => !localLinks.has(k.id));
  if (remaining.length > 0) {
    const binding = findTaskBinding(data, "kp_relink", courseId);
    if (!binding) {
      aiSkipped = true;
    } else {
      const tpl = resolvePromptTemplate(data, "kp_relink");
      const chapterIdSet = new Set(courseChapters.map((c) => c.id));
      const tree = buildTreeLines(courseChapters, courseId);
      try {
        for (let i = 0; i < remaining.length; i += AI_BATCH_SIZE) {
          const batch = remaining.slice(i, i + AI_BATCH_SIZE);
          const res = await callAiWithRetry({
            providerId: binding.providerId,
            modelId: binding.modelId,
            taskKey: "kp_relink",
            scope: `course-${courseId}`,
            messages: [
              { role: "system", content: renderPrompt(tpl.system, {}) },
              {
                role: "user",
                content: renderPrompt(tpl.user, { courseName: course.name, tree, kpLines: buildKpLines(batch) }),
              },
            ],
          });
          for (const link of parseRelinkResponse(res.content, new Set(batch.map((k) => k.id)), chapterIdSet)) {
            aiLinks.set(link.kpId, link.chapterId);
          }
        }
      } catch (e) {
        if (e instanceof AiCanceledError) throw e;
        aiError = e instanceof Error ? e.message : String(e);
      }
    }
  }

  const allLinks = new Map([...localLinks, ...aiLinks]);
  if (allLinks.size > 0) {
    // 落库前重取最新数据，防 AI 调用期间其他写入被覆盖（脏写）
    const latest = await getData();
    const latestChapters = latest.chapters.filter((c) => c.courseId === courseId);
    let linked = 0;
    let linkedLocal = 0;
    let linkedAi = 0;
    const linkedIds: number[] = [];
    for (const kp of latest.knowledgePoints) {
      const targetId = allLinks.get(kp.id);
      if (targetId === undefined) continue;
      kp.chapterId = targetId;
      kp.chapterName = latestChapters.find((c) => c.id === targetId)?.name ?? "";
      linked++;
      if (localLinks.has(kp.id)) linkedLocal++;
      else linkedAi++;
      linkedIds.push(kp.id);
    }
    await saveData(latest);
    for (const id of linkedIds) {
      void scheduleKpRegionSync(courseId, null);
      const kp = latest.knowledgePoints.find((k) => k.id === id);
      if (kp) void scheduleKpRegionSync(courseId, effectiveNodeOf(kp, latest.chapters));
    }
    return { linked, linkedLocal, linkedAi, stuck: targets.length - linked, linkedIds, aiSkipped, aiError };
  }
  return {
    linked: 0,
    linkedLocal: 0,
    linkedAi: 0,
    stuck: targets.length,
    linkedIds: [],
    aiSkipped,
    aiError,
  };
}
