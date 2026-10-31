import type { AppData, Chapter, KnowledgePoint, Material } from "../types/appData";
import type { ParsedHeading } from "../utils/documentParser";
import { getData, saveData } from "./storage";
import { getSettings } from "./settings";
import { nextId, now } from "./format";
import { findTaskBinding, callAi } from "./ai";
import { extractJsonCandidates, parseJsonCandidates, unwrapArray } from "../utils/aiJson";
import { resolvePromptTemplate, renderPrompt } from "./promptTemplates";
import { persistDocIfEnabled, isSiyuanDocId, removeSiyuanDoc, removeSiyuanDocIfExists } from "./siyuanDoc";
import { findChapterByTitle, normalizeChapterRef, normalizeKpName } from "./kpMatch";
import { removeCsvIds } from "../utils/csvIds";

export async function queryKnowledgePoints(courseId: number): Promise<KnowledgePoint[]> {
  const data = await getData();
  return data.knowledgePoints.filter((k) => k.courseId === courseId);
}

export async function updateKnowledgePoint(kp: KnowledgePoint): Promise<void> {
  const data = await getData();
  const idx = data.knowledgePoints.findIndex((k) => k.id === kp.id);
  if (idx >= 0) {
    data.knowledgePoints[idx] = kp;
    await saveData(data);
  }
}

export async function deleteKnowledgePoint(id: number): Promise<void> {
  await deleteKnowledgePoints([id]);
}

/** 批量删除知识点（级联清理复习触点、讲解记录与前置引用） */
export async function deleteKnowledgePoints(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const data = await getData();
  const removed = new Set(ids);
  data.knowledgePoints = data.knowledgePoints.filter((k) => !removed.has(k.id));
  // 级联清理复习触点与讲解记录，避免悬挂引用
  data.reviewSchedules = data.reviewSchedules.filter((s) => s.kpId === null || !removed.has(s.kpId));
  data.explainRecords = data.explainRecords.filter((r) => r.kpId === null || !removed.has(r.kpId));
  // 级联删除闪卡（绑定被删知识点）及其复习触点
  const removedCardIds = new Set(data.flashCards.filter((c) => removed.has(c.kpId)).map((c) => c.id));
  data.flashCards = data.flashCards.filter((c) => !removed.has(c.kpId));
  data.reviewSchedules = data.reviewSchedules.filter((s) => s.cardId == null || !removedCardIds.has(s.cardId));
  // 题目保留，仅从 kpIds 中移除被删知识点
  for (const q of data.questions) {
    q.kpIds = removeCsvIds(q.kpIds, removed);
  }
  // 计划任务命中被删知识点直接删除；studyLogs 保留历史不清理
  data.studyTasks = data.studyTasks.filter((t) => t.kpId === null || !removed.has(t.kpId));
  // 从其他知识点的前置列表中移除被删知识点
  for (const k of data.knowledgePoints) {
    const parts = k.prevKpIds.split(",").map((s) => s.trim()).filter(Boolean);
    const kept = parts.filter((s) => !removed.has(Number(s)));
    if (kept.length !== parts.length) {
      k.prevKpIds = kept.join(",");
    }
  }
  await saveData(data);
}

export async function queryChapters(courseId: number): Promise<Chapter[]> {
  const data = await getData();
  return data.chapters.filter((c) => c.courseId === courseId);
}

export async function createChapter(input: {
  courseId: number;
  name: string;
  parentId: number | null;
  level: Chapter["level"];
}): Promise<Chapter> {
  const data = await getData();
  const course = data.courses.find((c) => c.id === input.courseId);
  const name = input.name.trim();
  // 判重口径与知识点章节匹配一致（normalizeChapterRef）：「第X章/节」前缀、空格差异都视为同名
  const dup = data.chapters.find(
    (c) => c.courseId === input.courseId && normalizeChapterRef(c.name) === normalizeChapterRef(name),
  );
  if (dup) {
    throw new Error(`已存在同名章节「${dup.name}」，请换一个名称（知识点按章节名匹配，重名会导致归属混乱）`);
  }
  const parentChapter = input.parentId ? data.chapters.find((c) => c.id === input.parentId) : null;
  // 落库思源：章作为课程文档的子文档，节作为章文档的子文档（path 含文档名）
  const path = parentChapter
    ? `/${course?.name ?? "课程"}/${parentChapter.name}/${name}`
    : `/${course?.name ?? "课程"}/${name}`;
  // 直接父文档 id：消除 3.8.9 新标题模式下同名祖先的路径歧义
  const parentID = parentChapter ? parentChapter.siyuanBlockId : (course?.siyuanDocId ?? null);
  const docId = await persistDocIfEnabled(`# ${name}`, path, `章节「${name}」文档`, parentID);
  const sort =
    data.chapters.filter((c) => c.courseId === input.courseId && c.parentId === input.parentId).reduce((m, c) => Math.max(m, c.sort), 0) + 1;
  const chapter: Chapter = {
    id: nextId(data.chapters),
    courseId: input.courseId,
    parentId: input.parentId,
    siyuanBlockId: docId,
    name,
    level: input.level,
    sort,
  };
  data.chapters.push(chapter);
  await saveData(data);
  return chapter;
}

export interface ChapterTreeNode {
  name: string;
  level: Chapter["level"];
  /** 父章名称（unit 指向 chapter） */
  parentName: string | null;
}

/** 从标题结构批量导入章节树（幂等：同名章节不重复创建，新章节追加到末尾，已有章节顺序不变）。nodes 需保证父章在子节之前。 */
export async function importChapterTree(
  courseId: number,
  nodes: ChapterTreeNode[],
): Promise<{ created: number; linked: number; stuck: number }> {
  const data = await getData();
  const course = data.courses.find((c) => c.id === courseId);
  const coursePath = `/${course?.name ?? "课程"}`;
  const existing = data.chapters.filter((c) => c.courseId === courseId);
  // 去空白归一化比较：AI 目录矫正可能只改空格/标点（如「第一章X」→「第一章 X」），避免误判为新章节重复建章
  const norm = (s: string) => s.replace(/\s+/g, "");
  const persistOn = (await getSettings()).persistToSiyuan;
  let created = 0;
  let docFailed = 0;
  for (const node of nodes) {
    const name = node.name.trim();
    if (!name) continue;
    const dup = existing.find((c) => norm(c.name) === norm(name));
    if (dup) continue;
    const parent = node.parentName
      ? existing.find((c) => c.level === "chapter" && norm(c.name) === norm(node.parentName!))
      : null;
    const sort =
      data.chapters
        .filter((c) => c.courseId === courseId && c.parentId === (parent?.id ?? null))
        .reduce((m, c) => Math.max(m, c.sort), 0) + 1;
    // 落库思源：章作为课程子文档，节作为父章子文档（path 含文档名）
    const path = parent ? `${coursePath}/${parent.name}/${name}` : `${coursePath}/${name}`;
    // 直接父文档 id：消除 3.8.9 新标题模式下同名祖先的路径歧义
    const parentID = parent ? parent.siyuanBlockId : (course?.siyuanDocId ?? null);
    const docId = await persistDocIfEnabled(`# ${name}`, path, undefined, parentID);
    if (persistOn && !docId) docFailed++;
    const chapter: Chapter = {
      id: nextId(data.chapters),
      courseId,
      parentId: parent?.id ?? null,
      siyuanBlockId: docId,
      name,
      level: node.level,
      sort,
    };
    data.chapters.push(chapter);
    existing.push(chapter);
    created++;
  }
  // 新章节已在循环内按「同父 max sort + 1」追加到末尾（nodes 文档序）；
  // 已有章节一律不动，避免分册合并时打乱全书顺序、覆盖用户手动拖拽的顺序
  // 批量导入不逐条弹窗，聚合提示一次（章节数据本身已落库，仅思源文档缺失）
  if (docFailed > 0) {
    window.siyuanAiStudy.showMessage(`章节树导入：${docFailed} 个章节文档未落库到思源（章节数据不受影响）`, 5000, "error");
  }
  // 章节后建时，把未绑定的知识点按块标题 / 知识点名重新绑定到章节
  const relink = relinkCourseKps(data, courseId);
  await saveData(data);
  return { created, ...relink };
}

export interface RelinkResult {
  linked: number;
  /** 标题与名称都匹配不上、无法自动挂钩的数量（含无标题信息的知识点） */
  stuck: number;
}

/** 为单个未分配知识点找章节：先按块标题宽松匹配，再按知识点名归一化精确匹配（精确匹配防误挂） */
function matchChapterForKp(kp: KnowledgePoint, chapters: Chapter[]): Chapter | undefined {
  if (kp.chapterName) {
    const byTitle = findChapterByTitle(chapters, kp.chapterName);
    if (byTitle) return byTitle;
  }
  const name = normalizeChapterRef(kp.name);
  if (name.length >= 2) {
    const byName = chapters.find((c) => normalizeChapterRef(c.name) === name);
    if (byName) return byName;
  }
  return undefined;
}

function relinkCourseKps(data: AppData, courseId: number): RelinkResult {
  const courseChapters = data.chapters.filter((c) => c.courseId === courseId);
  let linked = 0;
  let stuck = 0;
  for (const kp of data.knowledgePoints) {
    if (kp.courseId !== courseId || kp.chapterId !== null) continue;
    const ch = matchChapterForKp(kp, courseChapters);
    if (ch) {
      kp.chapterId = ch.id;
      linked++;
    } else {
      stuck++;
    }
  }
  return { linked, stuck };
}

/** 将课程内未分配章节的知识点重新匹配绑定（章节后建/改名后使用），返回绑定数与无法自动挂钩数 */
export async function relinkUnassignedKps(courseId: number): Promise<RelinkResult> {
  const data = await getData();
  const result = relinkCourseKps(data, courseId);
  if (result.linked > 0) {
    await saveData(data);
  }
  return result;
}

/**
 * AI 矫正自动识别的标题列表（去噪 / 合并重复 / 修正层级），在目录预览前可选调用。
 * 未配置「recognize_toc」任务模型时原样返回；调用或解析失败时回退原列表（failed=true 供 UI 提示）。
 */
export async function correctTocWithAi(
  headings: ParsedHeading[],
  courseId?: number,
): Promise<{ headings: ParsedHeading[]; corrected: boolean; failed: boolean }> {
  if (headings.length === 0) return { headings, corrected: false, failed: false };
  const data = await getData();
  const binding = findTaskBinding(data, "recognize_toc", courseId);
  if (!binding) return { headings, corrected: false, failed: false };
  try {
    const lines = headings.map((h, i) => `${i + 1}. [L${h.level}] ${h.text}`).join("\n");
    // prompt 上限：目录过长的文档不做 AI 矫正，直接回退原列表（非报错，矫正只是增强）
    if (headings.length > 200 || lines.length > 60000) {
      return { headings, corrected: false, failed: false };
    }
    const tocVars = { lines };
    const tocTpl = resolvePromptTemplate(data, "recognize_toc");
    const res = await callAi({
      providerId: binding.providerId,
      modelId: binding.modelId,
      taskKey: "recognize_toc",
      scope: courseId != null ? "course-" + courseId : undefined,
      messages: [
        { role: "system", content: renderPrompt(tocTpl.system, tocVars) },
        { role: "user", content: renderPrompt(tocTpl.user, tocVars) },
      ],
    });
    const arr = unwrapArray(parseJsonCandidates(extractJsonCandidates(res.content, "array")));
    if (!arr) return { headings, corrected: false, failed: true };
    const corrected: ParsedHeading[] = [];
    for (const it of arr) {
      const rec = (it ?? {}) as { text?: unknown; level?: unknown };
      const text = typeof rec.text === "string" ? rec.text.trim() : "";
      const level = Number(rec.level);
      if (!text || text.length > 60 || (level !== 1 && level !== 2)) continue;
      corrected.push({ level, text });
    }
    return corrected.length > 0 ? { headings: corrected, corrected: true, failed: false } : { headings, corrected: false, failed: true };
  } catch (e) {
    console.error("AI 目录矫正失败:", e);
    return { headings, corrected: false, failed: true };
  }
}

/**
 * 聚合课程全部资料的标题结构生成课程级目录（目录永远从所有资料一起识别，而非单份资料）：
 * 合并各资料 headings → 按「层级+标题」去重 → AI 矫正（可选）。
 */
export interface AggregateTocResult {
  headings: ParsedHeading[];
  corrected: boolean;
  failed: boolean;
  materialCount: number;
}

export async function aggregateCourseToc(courseId: number): Promise<AggregateTocResult> {
  const data = await getData();
  const mats = data.materials.filter((m) => m.courseId === courseId);
  const allHeadings: ParsedHeading[] = [];
  for (const m of mats) {
    try {
      const hs = JSON.parse(m.headings || "[]") as Array<{ level: number; text: string }>;
      for (const h of hs) {
        if (h && typeof h.level === "number" && typeof h.text === "string" && h.text.trim()) {
          allHeadings.push({ level: h.level, text: h.text.trim() });
        }
      }
    } catch {
      // 忽略无法解析的 headings
    }
  }
  // 按「层级 + 标题」去重
  const seen = new Set<string>();
  const deduped = allHeadings.filter((h) => {
    const key = `${h.level}:${h.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const { headings, corrected, failed } = await correctTocWithAi(deduped, courseId);
  return { headings, corrected, failed, materialCount: mats.length };
}

export async function updateChapter(chapter: Chapter): Promise<void> {
  const data = await getData();
  const idx = data.chapters.findIndex((c) => c.id === chapter.id);
  if (idx >= 0) {
    const old = data.chapters[idx];
    data.chapters[idx] = chapter;
    await saveData(data);
    // 落库思源：改名时同步章节文档名（失败不阻塞主流程）
    if (chapter.name !== old.name && old.siyuanBlockId && isSiyuanDocId(old.siyuanBlockId)) {
      try {
        await window.siyuanAiStudy.renameSiyuanDoc(old.siyuanBlockId, chapter.name);
      } catch (e) {
        console.error("同步章节名到思源失败:", e);
      }
    }
  }
}

/** 批量应用章节 sort/parentId 变更（拖拽排序），单次保存；换父级时同步移动思源树对应文档 */
export async function applyChapterMoves(moves: Array<{ id: number; parentId: number | null; sort: number }>): Promise<void> {
  const data = await getData();
  const moveErrors: string[] = [];
  for (const mv of moves) {
    const idx = data.chapters.findIndex((c) => c.id === mv.id);
    if (idx < 0) continue;
    const cur = data.chapters[idx];
    if (cur.parentId !== mv.parentId) {
      // 仅换父级需要移动文档（同父换序不同步，减少内核调用）
      const docId = cur.siyuanBlockId;
      if (docId) {
        const targetDocId = mv.parentId
          ? data.chapters.find((c) => c.id === mv.parentId)?.siyuanBlockId
          : data.courses.find((c) => c.id === cur.courseId)?.siyuanDocId;
        if (targetDocId) {
          try {
            await window.siyuanAiStudy.moveSiyuanDoc(docId, targetDocId);
          } catch (e) {
            console.error("同步章节移动失败:", e);
            moveErrors.push(`章节「${cur.name}」文档移动失败`);
          }
        }
      }
    }
    data.chapters[idx] = { ...cur, parentId: mv.parentId, sort: mv.sort };
  }
  await saveData(data);
  if (moveErrors.length) {
    window.siyuanAiStudy.showMessage(
      `章节数据已调整，但思源文档树未完全同步：${moveErrors.join("；")}`,
      5000,
      "error",
    );
  }
}

/** 批量应用知识点 sort（拖拽换序），单次保存 */
export async function applyKnowledgePointSort(items: Array<{ id: number; sort: number }>): Promise<void> {
  const data = await getData();
  const map = new Map(items.map((it) => [it.id, it.sort]));
  for (const kp of data.knowledgePoints) {
    const s = map.get(kp.id);
    if (s !== undefined) {
      kp.sort = s;
    }
  }
  await saveData(data);
}

export async function deleteChapter(id: number): Promise<void> {
  await deleteChapters([id]);
}

/** 批量删除章节（级联删除子孙章节与思源文档，知识点归属刷新为未分配） */
export async function deleteChapters(ids: number[]): Promise<void> {
  const data = await getData();
  // 收集自身及所有子孙章节 id
  const removed = new Set<number>(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of data.chapters) {
      if (c.parentId !== null && removed.has(c.parentId) && !removed.has(c.id)) {
        removed.add(c.id);
        grew = true;
      }
    }
  }
  // 级联删除思源文档（await 以便聚合失败提示）
  const siyuanErrors: string[] = [];
  for (const c of data.chapters) {
    if (!removed.has(c.id)) continue;
    if (c.siyuanBlockId) {
      try {
        await removeSiyuanDocIfExists(c.siyuanBlockId);
      } catch (e) {
        console.error("删除思源章节文档失败:", e);
        siyuanErrors.push(`章节「${c.name}」文档删除失败`);
      }
    }
    // 学习对话文档：被删章/节的 conversationsDocs 条目一并清理
    const convEntry = data.conversationsDocs?.[String(c.id)];
    if (convEntry) {
      delete data.conversationsDocs![String(c.id)];
      try {
        await removeSiyuanDocIfExists(convEntry.docId);
      } catch (e) {
        console.error("删除学习对话文档失败:", e);
        siyuanErrors.push(`「${c.name}」学习对话文档删除失败`);
      }
    }
  }
  data.chapters = data.chapters.filter((c) => !removed.has(c.id));
  // 章末测评（test）任务命中被删章节直接删除：chapterId 置 null 会被当成结业模考入口
  data.studyTasks = data.studyTasks.filter(
    (t) => !(t.taskType === "test" && t.chapterId !== null && removed.has(t.chapterId)),
  );
  // 其他类型任务命中被删章节：章节引用置 null，任务保留
  for (const t of data.studyTasks) {
    if (t.chapterId !== null && removed.has(t.chapterId)) t.chapterId = null;
  }
  // 清理资料-章节关联
  data.materialChapters = data.materialChapters.filter((mc) => !removed.has(mc.chapterId));
  // 引用被删章节的知识点归属刷新为未分配
  for (const kp of data.knowledgePoints) {
    if (kp.chapterId !== null && removed.has(kp.chapterId)) {
      kp.chapterId = null;
    }
  }
  await saveData(data);
  if (siyuanErrors.length) {
    window.siyuanAiStudy.showMessage(
      `章节数据已删除，但思源文档清理不完整：${siyuanErrors.join("；")}`,
      5000,
      "error",
    );
  }
}

