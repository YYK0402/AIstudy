import type { Course } from "../types/appData";
import { getData, saveData } from "./storage";
import { nextId, now } from "./format";
import { persistDocIfEnabled, isSiyuanDocId, removeSiyuanDoc, removeSiyuanDocIfExists } from "./siyuanDoc";
import { removeAssetIfUnused } from "./material";

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
  // 落库思源：开启持久化时建课程顶层文档（path 含文档名）；未开启或失败为 null（不阻塞主流程）
  const docId = await persistDocIfEnabled(`# ${input.name}`, `/${input.name}`, `课程「${input.name}」文档`);
  const course: Course = {
    id: nextId(data.courses),
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
  if (nameChanged && course.siyuanDocId && isSiyuanDocId(course.siyuanDocId)) {
    try {
      await window.siyuanAiStudy.renameSiyuanDoc(course.siyuanDocId, input.name);
    } catch (e) {
      console.error("同步课程名到思源失败:", e);
    }
  }
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
  if (course.siyuanDocId && isSiyuanDocId(course.siyuanDocId)) {
    // 课程文档是顶层文档，章节/资料是其子文档，删顶层即整体删除
    try {
      await removeSiyuanDoc(course.siyuanDocId);
    } catch (e) {
      siyuanCleanupErrors.push(`课程文档「${course.name}」删除失败`);
    }
  } else {
    if (course.siyuanDocId) {
      // 历史坏数据：id 格式异常，无法按顶层文档整树删除
      siyuanCleanupErrors.push(`课程「${course.name}」的思源文档 id 格式异常，无法自动删除顶层文档`);
    }
    for (const ch of data.chapters.filter((c) => c.courseId === id)) {
      if (!ch.siyuanBlockId) continue;
      try {
        await removeSiyuanDoc(ch.siyuanBlockId);
      } catch (e) {
        siyuanCleanupErrors.push(`章节「${ch.name}」删除失败`);
      }
    }
    for (const m of data.materials.filter((x) => x.courseId === id)) {
      if (!m.siyuanDocId) continue;
      try {
        await removeSiyuanDoc(m.siyuanDocId);
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
      await removeSiyuanDocIfExists(entry.docId);
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
    window.siyuanAiStudy.showMessage(
      `课程数据已删除，但思源文档清理不完整：${siyuanCleanupErrors.join("；")}`,
      6000,
      "error",
    );
  }
}

