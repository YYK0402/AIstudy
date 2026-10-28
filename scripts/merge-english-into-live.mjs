// 把英语（专升本）种子数据合并进插件真实数据文件
// 真实文件: ~/SiYuan/data/storage/petal/siyuan-ai-study/data（插件实际读写的文件，无扩展名）
// 种子文件: <repo>/dist/data/data.json（build-english-seed.mjs 的产物）
// 原则: 近代史课程与全部学习记录原样保留；英语课程实体重编号后并入真实课程 id=2
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repo = join(__dirname, "..");
const livePath = join(os.homedir(), "SiYuan/data/storage/petal/siyuan-ai-study/data");
const seedPath = join(repo, "dist/data/data.json");

const COURSE_NAME = "英语（专升本）";
const CHAPTER_OFFSET = 1000; // 种子章节 id +1000，避开真实区间 365-412
const KP_OFFSET = 371; // 种子知识点 id +371（真实最大 371）
const LECTURE_MATERIAL_ID = 2; // 真实文件里已有的讲义资料 id，种子讲义并入它

const live = JSON.parse(readFileSync(livePath, "utf8"));
const seed = JSON.parse(readFileSync(seedPath, "utf8"));

const liveCourses = live.courses;
const engLive = liveCourses.find((c) => c.name === COURSE_NAME);
if (!engLive) throw new Error(`真实文件中未找到课程「${COURSE_NAME}」`);
const ENG_ID = engLive.id;
const seedEng = seed.courses.find((c) => c.name === COURSE_NAME);
if (!seedEng) throw new Error(`种子文件中未找到课程「${COURSE_NAME}」`);

// 备份（先备份再改动）
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = `${livePath}.bak-${stamp}`;
copyFileSync(livePath, backupPath);
console.log(`已备份: ${backupPath}`);

// --- 章节: id +1000，courseId → 真实英语课程，parentId 同步映射
const liveChapterIds = new Set(live.chapters.map((c) => c.id));
const chapterMap = new Map();
for (const c of seed.chapters) {
  const nid = c.id + CHAPTER_OFFSET;
  if (liveChapterIds.has(nid) || chapterMap.has(c.id)) {
    throw new Error(`章节 id 冲突: ${c.id} -> ${nid}`);
  }
  chapterMap.set(c.id, nid);
}
const mergedChapters = [
  ...live.chapters,
  ...seed.chapters.map((c) => ({
    ...c,
    id: chapterMap.get(c.id),
    parentId: c.parentId == null ? null : chapterMap.get(c.parentId),
    courseId: ENG_ID,
  })),
];

// --- 知识点: id +371，chapterId 映射，courseId → 英语课程
const liveKpIds = new Set(live.knowledgePoints.map((k) => k.id));
for (const k of seed.knowledgePoints) {
  if (liveKpIds.has(k.id + KP_OFFSET)) throw new Error(`知识点 id 冲突: ${k.id}`);
}
const mergedKps = [
  ...live.knowledgePoints,
  ...seed.knowledgePoints.map((k) => ({
    ...k,
    id: k.id + KP_OFFSET,
    chapterId: chapterMap.get(k.chapterId),
    courseId: ENG_ID,
  })),
];

// --- 资料: 讲义并入真实 id=2（用种子全文 contentText 与资料库 docId），其余 +2
const liveMaterialIds = new Set(live.materials.map((m) => m.id));
const seedMaterials = [...seed.materials].sort((a, b) => a.id - b.id);
const lecture = seedMaterials[0]; // 种子讲义（id=1），与真实 material id=2 是同一份 PDF
const liveLecture = live.materials.find((m) => m.id === LECTURE_MATERIAL_ID);
if (!liveLecture || liveLecture.courseId !== ENG_ID) {
  throw new Error(`真实文件中未找到英语课程的讲义资料 id=${LECTURE_MATERIAL_ID}`);
}
const materialMap = new Map([[lecture.id, LECTURE_MATERIAL_ID]]);
let nextMaterialId = Math.max(...liveMaterialIds) + 1;
const mergedMaterials = live.materials.map((m) =>
  m.id === LECTURE_MATERIAL_ID
    ? {
        ...m,
        contentText: lecture.contentText,
        siyuanDocId: lecture.siyuanDocId ?? m.siyuanDocId,
      }
    : m,
);
for (const m of seedMaterials.slice(1)) {
  if (liveMaterialIds.has(nextMaterialId)) throw new Error(`资料 id 冲突: ${nextMaterialId}`);
  materialMap.set(m.id, nextMaterialId);
  mergedMaterials.push({ ...m, id: nextMaterialId, courseId: ENG_ID });
  nextMaterialId += 1;
}

// --- materialChapters: 真实为空，种子 24 条重映射
const mergedMaterialChapters = [
  ...live.materialChapters,
  ...seed.materialChapters.map((mc) => ({
    ...mc,
    materialId: materialMap.get(mc.materialId),
    chapterId: chapterMap.get(mc.chapterId),
  })),
];

// --- 题目: 真实为空，种子 298 条，courseId → 英语课程，kpIds +371
const mergedQuestions = [
  ...live.questions,
  ...seed.questions.map((q) => ({
    ...q,
    courseId: ENG_ID,
    kpIds: q.kpIds
      ? q.kpIds
          .split(",")
          .filter(Boolean)
          .map((s) => String(Number(s) + KP_OFFSET))
          .join(",")
      : q.kpIds,
  })),
];

// --- 课程: 保留真实两条，英语课程补种子简介/目标，其余字段（createTime 等）以真实为准
const mergedCourses = liveCourses.map((c) =>
  c.id === ENG_ID ? { ...c, description: seedEng.description, target: seedEng.target } : c,
);

// --- 汇总: 以真实文件的键顺序为准，实体数组用合并结果
const merged = { ...live };
merged.courses = mergedCourses;
merged.chapters = mergedChapters;
merged.knowledgePoints = mergedKps;
merged.materials = mergedMaterials;
merged.materialChapters = mergedMaterialChapters;
merged.questions = mergedQuestions;

// --- 写回并自检
writeFileSync(livePath, JSON.stringify(merged));
const check = JSON.parse(readFileSync(livePath, "utf8"));
const engCh = check.chapters.filter((c) => c.courseId === ENG_ID).length;
const engKp = check.knowledgePoints.filter((k) => k.courseId === ENG_ID).length;
const engQ = check.questions.filter((q) => q.courseId === ENG_ID).length;
const engMat = check.materials.filter((m) => m.courseId === ENG_ID).length;
const otherKp = check.knowledgePoints.filter((k) => k.courseId !== ENG_ID).length;
const otherTask = check.studyTasks.length;
console.log("合并完成，自检:");
console.log(`  课程: ${check.courses.length}（${check.courses.map((c) => c.name).join(" / ")}）`);
console.log(`  章节: ${check.chapters.length}（英语 ${engCh}）`);
console.log(`  知识点: ${check.knowledgePoints.length}（英语 ${engKp}，其他课程 ${otherKp}）`);
console.log(`  题目: ${check.questions.length}（英语 ${engQ}）`);
console.log(`  资料: ${check.materials.length}（英语 ${engMat}）`);
console.log(`  学习任务: ${otherTask}（应保持不变）`);
const badCh = mergedChapters.some((c) => c.parentId != null && !mergedChapters.some((p) => p.id === c.parentId));
const badKp = mergedKps.some((k) => !mergedChapters.some((c) => c.id === k.chapterId));
const badKpRef = mergedQuestions.some((q) =>
  (q.kpIds ?? "").split(",").filter(Boolean).some((s) => !mergedKps.some((k) => k.id === Number(s))),
);
if (badCh || badKp || badKpRef) throw new Error("引用完整性校验失败");
console.log("  引用完整性: 通过（章节父子 / 知识点挂章 / 题目引用知识点）");
