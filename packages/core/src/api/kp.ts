import type { AppData, Chapter, KnowledgePoint } from "../types/appData";
import { getData, saveData } from "./storage";
import { getSettings } from "./settings";
import { nextId, now } from "./format";
import { persistDocIfEnabled, removeDoc, removeDocIfExists } from "./docStore";
import { sanitizeDocSegment } from "../utils/docPath";
import { findDeepestChapterByTitle, normalizeChapterRef, normalizeKpName, pickDeepestChapter } from "./kpMatch";
import { removeCsvIds } from "../utils/csvIds";
import { getBridge } from "@/bridge";
import { effectiveNodeOf } from "../utils/kpTreeImport";
import { scheduleKpRegionSync } from "./kpDocSync";
import { nodePathOf, outlineOf } from "../utils/outline";
import type { MergeResult } from "./tocMerge";
import { queryMaterials } from "./material";

export async function queryKnowledgePoints(courseId: number): Promise<KnowledgePoint[]> {
  const data = await getData();
  return data.knowledgePoints.filter((k) => k.courseId === courseId);
}

export async function updateKnowledgePoint(kp: KnowledgePoint): Promise<void> {
  const data = await getData();
  const idx = data.knowledgePoints.findIndex((k) => k.id === kp.id);
  if (idx >= 0) {
    const old = data.knowledgePoints[idx];
    data.knowledgePoints[idx] = kp;
    await saveData(data);
    // 思源知识点区写回：换章时新旧两节点都需刷新
    const nodes = new Set([effectiveNodeOf(old, data.chapters), effectiveNodeOf(kp, data.chapters)]);
    for (const n of nodes) void scheduleKpRegionSync(kp.courseId, n);
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
  const removedKps = data.knowledgePoints.filter((k) => removed.has(k.id));
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
  for (const kp of removedKps) {
    void scheduleKpRegionSync(kp.courseId, effectiveNodeOf(kp, data.chapters));
  }
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
  // 落库思源：章作为课程文档的子文档，节作为章文档的子文档（path 含文档名；名称段斜杠转全角防幽灵层级）；
  // 文档策略：level≥3 的小节不建思源文档（siyuanBlockId=null，KP 区落最近 level≤2 祖先文档）
  const path = parentChapter
    ? `/${sanitizeDocSegment(course?.name ?? "课程")}/${sanitizeDocSegment(parentChapter.name)}/${sanitizeDocSegment(name)}`
    : `/${sanitizeDocSegment(course?.name ?? "课程")}/${sanitizeDocSegment(name)}`;
  // 直接父文档 id：消除 3.8.9 新标题模式下同名祖先的路径歧义
  const parentID = parentChapter ? parentChapter.siyuanBlockId : (course?.siyuanDocId ?? null);
  const docId = input.level <= 2 ? await persistDocIfEnabled(`# ${name}`, path, `章节「${name}」文档`, parentID) : null;
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
  // 思源知识点区写回：新章文档写入空区（siyuanBlockId 为 null 时顺带补建）
  void scheduleKpRegionSync(input.courseId, chapter.id);
  return chapter;
}

export interface ChapterTreeNode {
  name: string;
  level: Chapter["level"];
  /** 父章名称（unit 指向 chapter） */
  parentName: string | null;
}

/**
 * 从标题结构批量导入章节树（幂等）：
 * - 同名章节/小节不重复创建（新章节追加到末尾，已有章节顺序不变）
 * - 改挂：已有小节若预览父节点 ≠ 当前父节点，改挂到新父（追加新父末尾）并同步移动思源文档；
 *   不改名、不删除、不动同父下的兄弟顺序
 * - toc 传入时：导入后课程级替换式写入资料 outline 节点 → 章节映射（tocMappings）
 * nodes 需保证父节点在子节点之前。
 */
export async function importChapterTree(
  courseId: number,
  nodes: ChapterTreeNode[],
  toc?: { result: MergeResult },
): Promise<{ created: number; moved: number; linked: number; stuck: number; linkedIds: number[] }> {
  const data = await getData();
  const course = data.courses.find((c) => c.id === courseId);
  const coursePath = `/${sanitizeDocSegment(course?.name ?? "课程")}`;
  const existing = data.chapters.filter((c) => c.courseId === courseId);
  // 去空白归一化比较：AI 目录矫正可能只改空格/标点（如「第一章X」→「第一章 X」），避免误判为新章节重复建章
  const norm = (s: string) => s.replace(/\s+/g, "");
  const persistOn = (await getSettings()).persistToSiyuan;
  let created = 0;
  let docFailed = 0;
  const createdChapters: Chapter[] = [];
  // 节点下标 → 章节 id（新建取新章、已有取既有章），供 toc 映射落库定位
  const nodeIdToChapter = new Map<number, number>();
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const name = node.name.trim();
    if (!name) continue;
    const dup = existing.find((c) => norm(c.name) === norm(name));
    if (dup) {
      nodeIdToChapter.set(i, dup.id);
      continue;
    }
    const parent = node.parentName
      ? existing.find((c) => c.level === node.level - 1 && norm(c.name) === norm(node.parentName!))
      : null;
    const sort =
      data.chapters
        .filter((c) => c.courseId === courseId && c.parentId === (parent?.id ?? null))
        .reduce((m, c) => Math.max(m, c.sort), 0) + 1;
    // 落库思源：章作为课程子文档，节作为父章子文档（path 含文档名；名称段斜杠转全角防幽灵层级）
    const path = parent
      ? `${coursePath}/${sanitizeDocSegment(parent.name)}/${sanitizeDocSegment(name)}`
      : `${coursePath}/${sanitizeDocSegment(name)}`;
    // 直接父文档 id：消除 3.8.9 新标题模式下同名祖先的路径歧义
    const parentID = parent ? parent.siyuanBlockId : (course?.siyuanDocId ?? null);
    // 文档策略：level≥3 的小节不建思源文档（siyuanBlockId=null，KP 区落最近 level≤2 祖先文档）
    let docId: string | null = null;
    if (node.level <= 2) {
      docId = await persistDocIfEnabled(`# ${name}`, path, undefined, parentID);
      if (persistOn && !docId) docFailed++;
    }
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
    createdChapters.push(chapter);
    nodeIdToChapter.set(i, chapter.id);
    created++;
  }
  // 新章节已在循环内按「同父 max sort + 1」追加到末尾（nodes 文档序）；
  // 已有章节一律不动，避免分册合并时打乱全书顺序、覆盖用户手动拖拽的顺序
  // 改挂：已有小节若预览父节点 ≠ 当前父节点则纠正（重新识别目录的核心价值）；
  // 预览父节点不存在（用户在预览里删了该行）时不动，防误挂
  const reparents: Array<{ chapter: Chapter; newParentId: number | null; newSort: number | null }> = [];
  for (const node of nodes) {
    const parentName = node.parentName;
    if (node.level < 2 || !parentName) continue;
    const name = node.name.trim();
    if (!name) continue;
    const dup = existing.find((c) => norm(c.name) === norm(name));
    if (!dup || dup.level !== node.level) continue;
    const target = existing.find((c) => c.level === node.level - 1 && norm(c.name) === norm(parentName));
    if (!target || dup.parentId === target.id) continue;
    reparents.push({ chapter: dup, newParentId: target.id, newSort: null });
  }
  const moveErrors = reparents.length > 0 ? await applyParentAndSort(data, reparents) : [];
  // toc 映射落库：课程级替换（先删该课程旧映射），(materialId, materialPath) 幂等去重；
  // materialPath = 资料 outline 节点路径（祖先 > 自身）
  if (toc) {
    const nextMappings = data.tocMappings.filter((m) => m.courseId !== courseId);
    const seen = new Set<string>();
    let mid = data.tocMappings.reduce((mx, m) => Math.max(mx, m.id), 0) + 1;
    // 资料自然序（materialIdx 是 queryMaterials 列表下标，与合并侧同口径）
    const materials = await queryMaterials(courseId);
    for (const rm of toc.result.mappings) {
      const material = materials[rm.materialIdx];
      if (!material) continue;
      const path = nodePathOf(outlineOf(material), rm.materialSeq);
      if (!path) continue; // outline 损坏/节点缺失：无路径可记，跳过
      const key = `${material.id}:${path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const chapterId = nodeIdToChapter.get(rm.nodeId);
      if (chapterId == null) continue; // 映射指向空名节点：跳过防悬挂引用
      nextMappings.push({ id: mid++, materialId: material.id, courseId, materialPath: path, chapterId });
    }
    data.tocMappings = nextMappings;
  }
  // 章节后建时，把未绑定的知识点按块标题 / 知识点名重新绑定到章节
  const relink = relinkCourseKps(data, courseId);
  await saveData(data);
  // 思源知识点区写回：新建章文档写空区 + 被重新绑定的 KP 的旧/新节点
  for (const ch of createdChapters) void scheduleKpRegionSync(courseId, ch.id);
  for (const id of relink.linkedIds) {
    void scheduleKpRegionSync(courseId, null); // 原未归章 → 课程文档
    const kp = data.knowledgePoints.find((k) => k.id === id);
    if (kp) void scheduleKpRegionSync(courseId, effectiveNodeOf(kp, data.chapters));
  }
  // 批量导入不逐条弹窗，聚合提示一次（章节数据本身已落库，仅思源文档缺失/移动失败）
  const warns = [
    ...(docFailed > 0 ? [`${docFailed} 个章节文档未落库到思源（章节数据不受影响）`] : []),
    ...moveErrors,
  ];
  if (warns.length) {
    getBridge().showMessage(`章节树导入：${warns.join("；")}`, 5000, "error");
  }
  return { created, moved: reparents.length, ...relink };
}

/**
 * 批量应用章节 parentId/sort 变更：换父时同步移动思源文档（目标文档缺失/移动失败 → 数据先行、错误聚合返回）。
 * newSort=null 表示「追加到 newParent 末尾」（应用时按当时兄弟 max sort + 1 计算，支持连续改挂不撞号）。
 * 返回移动失败的章节名列表。
 */
async function applyParentAndSort(
  data: AppData,
  items: Array<{ chapter: Chapter; newParentId: number | null; newSort: number | null }>,
): Promise<string[]> {
  const errors: string[] = [];
  for (const it of items) {
    const { chapter, newParentId } = it;
    if (chapter.parentId !== newParentId && chapter.siyuanBlockId) {
      const targetDocId = newParentId
        ? data.chapters.find((c) => c.id === newParentId)?.siyuanBlockId
        : data.courses.find((c) => c.id === chapter.courseId)?.siyuanDocId;
      if (targetDocId) {
        try {
          await getBridge().moveDoc(chapter.siyuanBlockId, targetDocId);
        } catch (e) {
          console.error("同步章节移动失败:", e);
          errors.push(`章节「${chapter.name}」文档移动失败`);
        }
      }
    }
    // sort 必须在换父前按「新父现有兄弟」计算（换父后再算会把自己算进 max）
    const newSort =
      it.newSort ??
      data.chapters
        .filter((c) => c.courseId === chapter.courseId && c.parentId === newParentId)
        .reduce((m, c) => Math.max(m, c.sort), 0) + 1;
    chapter.parentId = newParentId;
    chapter.sort = newSort;
  }
  return errors;
}

export interface RelinkResult {
  linked: number;
  /** 标题与名称都匹配不上、无法自动挂钩的数量（含无标题信息的知识点） */
  stuck: number;
  /** 被成功绑定的知识点 id（供落库后调度旧/新节点文档写回） */
  linkedIds: number[];
}

/** 为单个未分配知识点找章节：先按块标题宽松匹配，再按知识点名归一化精确匹配（精确匹配防误挂）；N 级命中取最深 */
function matchChapterForKp(kp: KnowledgePoint, chapters: Chapter[]): Chapter | undefined {
  if (kp.chapterName) {
    const byTitle = findDeepestChapterByTitle(chapters, kp.chapterName);
    if (byTitle) return byTitle;
  }
  const name = normalizeChapterRef(kp.name);
  if (name.length >= 2) {
    const byName = chapters.filter((c) => normalizeChapterRef(c.name) === name);
    if (byName.length > 0) return pickDeepestChapter(byName);
  }
  return undefined;
}

function relinkCourseKps(data: AppData, courseId: number): RelinkResult {
  const courseChapters = data.chapters.filter((c) => c.courseId === courseId);
  let linked = 0;
  let stuck = 0;
  const linkedIds: number[] = [];
  for (const kp of data.knowledgePoints) {
    if (kp.courseId !== courseId || kp.chapterId !== null) continue;
    const ch = matchChapterForKp(kp, courseChapters);
    if (ch) {
      kp.chapterId = ch.id;
      linked++;
      linkedIds.push(kp.id);
    } else {
      stuck++;
    }
  }
  return { linked, stuck, linkedIds };
}

/** 将课程内未分配章节的知识点重新匹配绑定（章节后建/改名后使用），返回绑定数与无法自动挂钩数 */
export async function relinkUnassignedKps(courseId: number): Promise<RelinkResult> {
  const data = await getData();
  const result = relinkCourseKps(data, courseId);
  if (result.linked > 0) {
    await saveData(data);
    for (const id of result.linkedIds) {
      void scheduleKpRegionSync(courseId, null);
      const kp = data.knowledgePoints.find((k) => k.id === id);
      if (kp) void scheduleKpRegionSync(courseId, effectiveNodeOf(kp, data.chapters));
    }
  }
  return result;
}

export async function updateChapter(chapter: Chapter): Promise<void> {
  const data = await getData();
  const idx = data.chapters.findIndex((c) => c.id === chapter.id);
  if (idx >= 0) {
    const old = data.chapters[idx];
    data.chapters[idx] = chapter;
    await saveData(data);
    // 落库思源：改名时同步章节文档名（斜杠转全角与落库口径一致；失败不阻塞主流程）
    if (chapter.name !== old.name && old.siyuanBlockId && getBridge().isValidDocRef(old.siyuanBlockId)) {
      try {
        await getBridge().renameDoc(old.siyuanBlockId, sanitizeDocSegment(chapter.name));
      } catch (e) {
        console.error("同步章节名到思源失败:", e);
      }
    }
  }
}

/** 批量应用章节 sort/parentId 变更（拖拽排序），单次保存；换父级时同步移动思源树对应文档 */
export async function applyChapterMoves(moves: Array<{ id: number; parentId: number | null; sort: number }>): Promise<void> {
  const data = await getData();
  const items = moves
    .map((mv) => {
      const chapter = data.chapters.find((c) => c.id === mv.id);
      return chapter ? { chapter, newParentId: mv.parentId, newSort: mv.sort as number | null } : null;
    })
    .filter((x): x is { chapter: Chapter; newParentId: number | null; newSort: number | null } => x !== null);
  const moveErrors = await applyParentAndSort(data, items);
  await saveData(data);
  if (moveErrors.length) {
    getBridge().showMessage(
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
  const byCourse = new Map<number, Set<number | null>>();
  for (const kp of data.knowledgePoints) {
    const s = map.get(kp.id);
    if (s === undefined) continue;
    kp.sort = s;
    if (!byCourse.has(kp.courseId)) byCourse.set(kp.courseId, new Set());
    byCourse.get(kp.courseId)!.add(effectiveNodeOf(kp, data.chapters));
  }
  await saveData(data);
  for (const [courseId, nodes] of byCourse) {
    for (const n of nodes) void scheduleKpRegionSync(courseId, n);
  }
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
  // 归属被删章节的 KP 将变为未归章 → 其课程顶层文档需要写回
  const orphanedCourses = new Set<number>();
  for (const kp of data.knowledgePoints) {
    if (kp.chapterId !== null && removed.has(kp.chapterId)) orphanedCourses.add(kp.courseId);
  }
  // 级联删除思源文档（await 以便聚合失败提示）
  const siyuanErrors: string[] = [];
  for (const c of data.chapters) {
    if (!removed.has(c.id)) continue;
    if (c.siyuanBlockId) {
      try {
        await removeDocIfExists(c.siyuanBlockId);
      } catch (e) {
        console.error("删除思源章节文档失败:", e);
        siyuanErrors.push(`章节「${c.name}」文档删除失败`);
      }
      if (c.siyuanBlockId && data.docRegions) {
        delete data.docRegions[c.siyuanBlockId];
      }
    }
    // 学习对话文档：被删章/节的 conversationsDocs 条目一并清理
    const convEntry = data.conversationsDocs?.[String(c.id)];
    if (convEntry) {
      delete data.conversationsDocs![String(c.id)];
      try {
        await removeDocIfExists(convEntry.docId);
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
  // 级联清理资料 outline 节点 → 章节映射（指向被删章节的条目）
  data.tocMappings = data.tocMappings.filter((m) => !removed.has(m.chapterId));
  // 引用被删章节的知识点归属刷新为未分配
  for (const kp of data.knowledgePoints) {
    if (kp.chapterId !== null && removed.has(kp.chapterId)) {
      kp.chapterId = null;
    }
  }
  await saveData(data);
  for (const cid of orphanedCourses) void scheduleKpRegionSync(cid, null);
  if (siyuanErrors.length) {
    getBridge().showMessage(
      `章节数据已删除，但思源文档清理不完整：${siyuanErrors.join("；")}`,
      5000,
      "error",
    );
  }
}

