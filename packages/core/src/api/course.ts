import type { Course, ExtraQuestionType } from "../types/appData";
import { getData, saveData } from "./storage";
import { validateExtraTypeName } from "../utils/questionTypes";
import { QUESTION_TYPES as BUILTIN_QUESTION_KEYS_ARRAY } from "./constants";
const BUILTIN_QUESTION_KEYS = new Set<string>(BUILTIN_QUESTION_KEYS_ARRAY);
import { now } from "./format";
import { nextCourseId } from "../utils/courseFileIds";
import { persistDocIfEnabled, removeDoc, removeDocIfExists } from "./docStore";
import { sanitizeDocSegment } from "../utils/docPath";
import { removeAssetIfUnused } from "./material";
import { getBridge } from "@/bridge";

export async function queryCourses(): Promise<Course[]> {
  const data = await getData();
  return data.courses;
}

export async function createCourse(input: {
  name: string;
  description?: string;
  target?: string;
  totalCycle?: string;
  modelId?: number | null;
}): Promise<Course> {
  const data = await getData();
  // id 分配同时考虑磁盘课程文件（删课遗留孤儿文件）：注册表丢失/重置后 id 序列重排会覆盖孤儿文件
  const diskIds = (await getBridge().listCourseFileIds?.()) ?? [];
  // 落库思源：开启持久化时建课程顶层文档（path 含文档名；名称段斜杠转全角防幽灵层级）；未开启或失败为 null（不阻塞主流程）
  const docId = await persistDocIfEnabled(`# ${input.name}`, `/${sanitizeDocSegment(input.name)}`, `课程「${input.name}」文档`);
  const course: Course = {
    id: nextCourseId(data.courses, diskIds),
    siyuanDocId: docId,
    name: input.name,
    description: input.description ?? "",
    target: input.target ?? "",
    totalCycle: input.totalCycle ?? "",
    status: "active",
    createTime: now(),
    modelId: input.modelId ?? null,
  };
  data.courses.push(course);
  await saveData(data);
  return course;
}

export async function updateCourse(id: number, input: {
  name: string;
  description?: string;
  target?: string;
  totalCycle?: string;
  modelId?: number | null;
}): Promise<Course> {
  const data = await getData();
  const course = data.courses.find((c) => c.id === id);
  if (!course) {
    throw new Error("课程不存在，可能已被删除");
  }
  const nameChanged = course.name !== input.name;
  course.name = input.name;
  course.description = input.description ?? "";
  course.target = input.target ?? "";
  course.totalCycle = input.totalCycle ?? "";
  course.modelId = input.modelId ?? null;
  await saveData(data);
  // 落库思源：改名时同步课程顶层文档名（失败不阻塞主流程）
  if (nameChanged && course.siyuanDocId && getBridge().isValidDocRef(course.siyuanDocId)) {
    try {
      await getBridge().renameDoc(course.siyuanDocId, sanitizeDocSegment(input.name));
    } catch (e) {
      console.error("同步课程名到思源失败:", e);
    }
  }
  return course;
}

/** 课程附加题型：课程绑定（非通用），内置扩展引用或自定义；题目 qType 用此处 name */
function courseOf(id: number, data: Awaited<ReturnType<typeof getData>>): Course {
  const course = data.courses.find((c) => c.id === id);
  if (!course) throw new Error("课程不存在，可能已被删除");
  return course;
}

/** 为课程添加附加题型（内置扩展引用或自定义） */
export async function addCourseQuestionType(id: number, input: ExtraQuestionType): Promise<Course> {
  const data = await getData();
  const course = courseOf(id, data);
  const err = validateExtraTypeName(input.name, course);
  if (err) throw new Error(err);
  const name = input.name.trim();
  course.extraQuestionTypes = [...(course.extraQuestionTypes ?? []), { name, mode: input.mode }];
  await saveData(data);
  return course;
}

/** 移除课程附加题型（内置扩展引用/自定义均可）；存量题目保留原 qType（标签/模式按注册表或简答回退） */
export async function removeCourseQuestionType(id: number, name: string): Promise<Course> {
  const data = await getData();
  const course = courseOf(id, data);
  const list = course.extraQuestionTypes ?? [];
  const next = list.filter((t) => (t.name ?? "").trim() !== name.trim());
  if (next.length === list.length) throw new Error("题型不存在或不是课程附加题型");
  course.extraQuestionTypes = next;
  await saveData(data);
  return course;
}

/** 重命名自定义题型：同步改本课程全部题目 qType（级联，不留悬挂引用）；内置扩展引用不可改名 */
export async function renameCourseQuestionType(id: number, from: string, to: string): Promise<Course> {
  const data = await getData();
  const course = courseOf(id, data);
  const target = (course.extraQuestionTypes ?? []).find((t) => (t.name ?? "").trim() === from.trim());
  if (!target) throw new Error("题型不存在或不是课程附加题型");
  if (BUILTIN_QUESTION_KEYS.has(from.trim())) throw new Error("内置题型不可改名");
  const err = validateExtraTypeName(to, course);
  if (err) throw new Error(err);
  target.name = to.trim();
  for (const q of data.questions) {
    if (q.courseId === id && q.qType === from.trim()) {
      q.qType = to.trim();
    }
  }
  await saveData(data);
  return course;
}

/** 课程级复习暂停开关：挂起/恢复该课程到期复习触点的浮现（SM-2 排期数据不动） */
export async function setCourseReviewPaused(id: number, paused: boolean): Promise<Course> {
  const data = await getData();
  const course = data.courses.find((c) => c.id === id);
  if (!course) {
    throw new Error("课程不存在，可能已被删除");
  }
  course.reviewPaused = paused;
  await saveData(data);
  return course;
}

/** 归档 / 取消归档课程（active ↔ archived）；归档后前端隐藏写入口，仅查看 */
export async function setCourseStatus(id: number, status: "active" | "archived"): Promise<Course> {
  const data = await getData();
  const course = data.courses.find((c) => c.id === id);
  if (!course) {
    throw new Error("课程不存在，可能已被删除");
  }
  course.status = status;
  await saveData(data);
  return course;
}

/** 删除课程：级联删除其下章节/知识点/资料/题目/计划/记录；已落库思源时整体删除课程文档（子文档随树删除） */
export async function deleteCourse(id: number): Promise<void> {
  const data = await getData();
  const course = data.courses.find((c) => c.id === id);
  if (!course) {
    throw new Error("课程不存在，可能已被删除");
  }
  const kpIds = new Set(data.knowledgePoints.filter((k) => k.courseId === id).map((k) => k.id));
  const materialIds = new Set(data.materials.filter((m) => m.courseId === id).map((m) => m.id));
  const removedMaterials = data.materials.filter((m) => m.courseId === id);
  const questionIds = new Set(data.questions.filter((q) => q.courseId === id).map((q) => q.id));
  const planIds = new Set(data.studyPlans.filter((p) => p.courseId === id).map((p) => p.id));
  const flashCardIds = new Set(data.flashCards.filter((c) => c.courseId === id).map((c) => c.id));
  const siyuanCleanupErrors: string[] = [];
  if (course.siyuanDocId && getBridge().isValidDocRef(course.siyuanDocId)) {
    // 课程文档是顶层文档，章节/资料是其子文档，删顶层即整体删除
    try {
      await removeDoc(course.siyuanDocId);
    } catch (e) {
      siyuanCleanupErrors.push(`课程文档「${course.name}」删除失败`);
    }
    if (data.docRegions) {
      delete data.docRegions[course.siyuanDocId];
      // 章文档随树级联删除，写入状态一并清理
      for (const ch of data.chapters.filter((c) => c.courseId === id)) {
        if (ch.siyuanBlockId) delete data.docRegions[ch.siyuanBlockId];
      }
    }
  } else {
    if (course.siyuanDocId) {
      // 历史坏数据：id 格式异常，无法按顶层文档整树删除
      siyuanCleanupErrors.push(`课程「${course.name}」的思源文档 id 格式异常，无法自动删除顶层文档`);
      // 课程已删，写入状态无用（读回删除消歧对全部课程的 docRegions 取 ids 并集，
      // 残留条目会被复用同 id 的新 KP 命中，把待写 KP 误判成「用户删除」）
      if (data.docRegions) delete data.docRegions[course.siyuanDocId];
    }
    for (const ch of data.chapters.filter((c) => c.courseId === id)) {
      if (!ch.siyuanBlockId) continue;
      try {
        await removeDoc(ch.siyuanBlockId);
      } catch (e) {
        siyuanCleanupErrors.push(`章节「${ch.name}」删除失败`);
      }
      if (data.docRegions) delete data.docRegions[ch.siyuanBlockId];
    }
    for (const m of data.materials.filter((x) => x.courseId === id)) {
      if (!m.siyuanDocId) continue;
      try {
        await removeDoc(m.siyuanDocId);
      } catch (e) {
        siyuanCleanupErrors.push(`资料「${m.name}」删除失败`);
      }
    }
  }
  // 学习对话文档条目：随章节删除清理（思源文档已随课程文档级联删除，幂等兜底）
  const removedChapterIds = new Set(
    data.chapters.filter((c) => c.courseId === id).map((c) => String(c.id)),
  );
  for (const key of [...removedChapterIds, `course-${id}`]) {
    const entry = data.conversationsDocs?.[key];
    if (!entry) continue;
    delete data.conversationsDocs![key];
    try {
      await removeDocIfExists(entry.docId);
    } catch (e) {
      siyuanCleanupErrors.push(`学习对话文档删除失败（${key}）`);
    }
  }
  data.courses = data.courses.filter((c) => c.id !== id);
  data.chapters = data.chapters.filter((c) => c.courseId !== id);
  data.knowledgePoints = data.knowledgePoints.filter((k) => k.courseId !== id);
  data.flashCards = data.flashCards.filter((c) => c.courseId !== id);
  data.materials = data.materials.filter((m) => m.courseId !== id);
  data.materialChapters = data.materialChapters.filter((mc) => !materialIds.has(mc.materialId));
  data.tocMappings = data.tocMappings.filter((m) => m.courseId !== id);
  data.questions = data.questions.filter((q) => q.courseId !== id);
  data.answerRecords = data.answerRecords.filter((r) => !questionIds.has(r.qId));
  data.wrongQuestions = data.wrongQuestions.filter((w) => !questionIds.has(w.qId));
  data.studyPlans = data.studyPlans.filter((p) => p.courseId !== id);
  data.studyTasks = data.studyTasks.filter((t) => !planIds.has(t.planId));
  data.explainRecords = data.explainRecords.filter((r) => r.courseId !== id);
  data.reviewSchedules = data.reviewSchedules.filter((s) => {
    if (s.kpId !== null && kpIds.has(s.kpId)) return false;
    if (s.qId !== null && questionIds.has(s.qId)) return false;
    if (s.cardId != null && flashCardIds.has(s.cardId)) return false;
    return true;
  });
  data.studyLogs = data.studyLogs.filter((l) => l.courseId !== id);
  await saveData(data);
  // 同步清理课程资料的源文件（仍被其他课程资料引用的跳过）
  for (const m of removedMaterials) {
    await removeAssetIfUnused(m.assetPath, data.materials);
  }
  if (siyuanCleanupErrors.length) {
    getBridge().showMessage(
      `课程数据已删除，但思源文档清理不完整：${siyuanCleanupErrors.join("；")}`,
      6000,
      "error",
    );
  }
}

