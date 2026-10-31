import { describe, expect, it } from "vitest";
import { applyImportToData, buildCoursePackageData, remapCoursePackage } from "../coursePackage";
import type {
  AppData,
  Chapter,
  Course,
  ExamPaper,
  FlashCard,
  KnowledgePoint,
  Material,
  MaterialChapter,
  Question,
} from "../../types/appData";

const T = "2026-01-01T00:00:00.000Z";

function course(over: Partial<Course> = {}): Course {
  return {
    id: 1,
    siyuanDocId: "doc-1",
    name: "高等数学",
    description: "微积分",
    target: "90+",
    totalCycle: "12 周",
    status: "active",
    createTime: T,
    modelId: 7,
    ...over,
  };
}
function chapter(over: Partial<Chapter> = {}): Chapter {
  return { id: 1, courseId: 1, parentId: null, siyuanBlockId: "blk-1", name: "第一章", level: "chapter", sort: 1, ...over };
}
function kp(over: Partial<KnowledgePoint> = {}): KnowledgePoint {
  return {
    id: 1,
    courseId: 1,
    chapterId: 1,
    blockId: "blk-kp",
    blockName: "某块",
    name: "极限",
    content: "极限的内容",
    mastery: "mastered",
    sourceAssetIds: "1,2",
    prevKpIds: "",
    chapterName: "第一章",
    sort: 1,
    createTime: T,
    askPrompt: "什么是极限？",
    askPromptContent: "极限|极限的内容",
    ...over,
  };
}
function material(over: Partial<Material> = {}): Material {
  return {
    id: 1,
    courseId: 1,
    name: "课本.pdf",
    assetPath: "/assets/abc.pdf",
    fileType: "pdf",
    contentText: "课本正文",
    headings: "[]",
    siyuanDocId: "doc-mat",
    status: "ok",
    createTime: T,
    source: "upload",
    ...over,
  };
}
function mc(over: Partial<MaterialChapter> = {}): MaterialChapter {
  return { id: 1, materialId: 1, chapterId: 1, ...over };
}
function question(over: Partial<Question> = {}): Question {
  return {
    id: 1,
    courseId: 1,
    kpIds: "1",
    title: "什么是极限？",
    options: "[]",
    answer: "A",
    analysis: "解析",
    qType: "single",
    difficulty: "medium",
    source: "ai",
    paperId: 1,
    createTime: T,
    ...over,
  };
}
function paper(over: Partial<ExamPaper> = {}): ExamPaper {
  return { id: 1, courseId: 1, name: "模考一", year: 2026, createTime: T, ...over };
}
function card(over: Partial<FlashCard> = {}): FlashCard {
  return { id: 1, courseId: 1, kpId: 1, front: "什么是极限？", back: "答案", source: "ai", createTime: T, ...over };
}

/** 两门课程的完整数据：课程1（目标）+ 课程2（干扰项，验证只取目标课程） */
function makeData(over: Partial<AppData> = {}): AppData {
  return {
    providers: [],
    models: [],
    taskModels: [],
    logs: [],
    courses: [course(), course({ id: 2, name: "物理", siyuanDocId: "doc-2", modelId: null })],
    chapters: [chapter(), chapter({ id: 2, courseId: 2, name: "力学", siyuanBlockId: "blk-2" })],
    knowledgePoints: [
      kp(),
      kp({ id: 2, courseId: 2, chapterId: 2, name: "牛顿", mastery: "proficient", blockId: "blk-kp2", blockName: "块2", sourceAssetIds: "", askPrompt: undefined, askPromptContent: undefined }),
    ],
    materials: [material(), material({ id: 2, courseId: 2, name: "力学.pdf", assetPath: "/assets/def.pdf", siyuanDocId: "doc-mat2" })],
    materialChapters: [mc(), mc({ id: 2, materialId: 2, chapterId: 2 })],
    questions: [question(), question({ id: 2, courseId: 2, kpIds: "2", paperId: null })],
    examPapers: [paper()],
    answerRecords: [],
    questionAsks: [],
    wrongQuestions: [],
    studyPlans: [],
    studyTasks: [],
    explainRecords: [],
    reviewSchedules: [],
    flashCards: [card(), card({ id: 2, courseId: 2, kpId: 2 })],
    studyLogs: [],
    studyLogMonthly: [],
    answerStatsMonthly: [],
    settings: { chapterMode: "manual", persistToSiyuan: false, notebookName: "AI 研习" },
    ...over,
  };
}

describe("buildCoursePackageData", () => {
  it("只取目标课程的实体，剔除其他课程的干扰项", () => {
    const pkg = buildCoursePackageData(makeData(), 1, { includeCards: true });
    expect(pkg.course.id).toBe(1);
    expect(pkg.chapters.map((c) => c.id)).toEqual([1]);
    expect(pkg.knowledgePoints.map((k) => k.id)).toEqual([1]);
    expect(pkg.materials.map((m) => m.id)).toEqual([1]);
    expect(pkg.materialChapters.map((m) => m.id)).toEqual([1]);
    expect(pkg.questions.map((q) => q.id)).toEqual([1]);
    expect(pkg.examPapers.map((p) => p.id)).toEqual([1]);
    expect(pkg.flashCards.map((c) => c.id)).toEqual([1]);
  });

  it("重置课程本地绑定（siyuanDocId / modelId）", () => {
    const pkg = buildCoursePackageData(makeData(), 1);
    expect(pkg.course.siyuanDocId).toBeNull();
    expect(pkg.course.modelId ?? null).toBeNull();
    // 共享内容保留
    expect(pkg.course.name).toBe("高等数学");
    expect(pkg.course.description).toBe("微积分");
  });

  it("重置章节本地绑定 siyuanBlockId", () => {
    const pkg = buildCoursePackageData(makeData(), 1);
    expect(pkg.chapters[0].siyuanBlockId).toBeNull();
    expect(pkg.chapters[0].name).toBe("第一章");
  });

  it("重置知识点个人学习状态与 AI 缓存", () => {
    const pkg = buildCoursePackageData(makeData(), 1);
    const k = pkg.knowledgePoints[0];
    expect(k.mastery).toBe("unlearn");
    expect(k.blockId).toBeNull();
    expect(k.blockName).toBeUndefined();
    expect(k.askPrompt).toBeUndefined();
    expect(k.askPromptContent).toBeUndefined();
    // 共享内容保留
    expect(k.name).toBe("极限");
    expect(k.content).toBe("极限的内容");
    expect(k.chapterName).toBe("第一章");
  });

  it("默认不含原始资料文件：assetPath 置空，但保留文本", () => {
    const pkg = buildCoursePackageData(makeData(), 1);
    expect(pkg.materials[0].assetPath).toBe("");
    expect(pkg.materials[0].contentText).toBe("课本正文");
    expect(pkg.materials[0].headings).toBe("[]");
    expect(pkg.materials[0].siyuanDocId).toBeNull();
  });

  it("includeAssets=true：assetPath 为包内资产引用（id 前缀 + 安全文件名）", () => {
    const pkg = buildCoursePackageData(makeData(), 1, { includeAssets: true });
    expect(pkg.materials[0].assetPath).toBe("1-课本.pdf");
  });

  it("默认含题库：questions/examPapers 包含；includeQuestions=false 显式关闭后为空", () => {
    const def = buildCoursePackageData(makeData(), 1);
    expect(def.questions.map((q) => q.id)).toEqual([1]);
    expect(def.examPapers.map((p) => p.id)).toEqual([1]);
    const noQ = buildCoursePackageData(makeData(), 1, { includeQuestions: false });
    expect(noQ.questions).toEqual([]);
    expect(noQ.examPapers).toEqual([]);
  });

  it("默认不含闪卡；includeCards=true 后包含", () => {
    expect(buildCoursePackageData(makeData(), 1).flashCards).toEqual([]);
    expect(buildCoursePackageData(makeData(), 1, { includeCards: true }).flashCards.map((c) => c.id)).toEqual([1]);
  });

  it("materialChapters 仅保留资料与章节同属本课程的映射", () => {
    const data = makeData({
      // 资料1(课程1) 映射到 章节2(课程2)：越界映射，应被剔除
      materialChapters: [mc(), mc({ id: 3, materialId: 1, chapterId: 2 }), mc({ id: 2, materialId: 2, chapterId: 2 })],
    });
    const pkg = buildCoursePackageData(data, 1);
    expect(pkg.materialChapters.map((m) => m.id)).toEqual([1]);
  });

  it("课程不存在时抛错", () => {
    expect(() => buildCoursePackageData(makeData(), 999)).toThrow();
  });
});

describe("remapCoursePackage", () => {
  it("导入空数据：新 id 从 1 起，外键重写为新课程", () => {
    const pkg = buildCoursePackageData(makeData(), 1, { includeQuestions: true, includeCards: true });
    const empty: AppData = { ...makeData(), courses: [], chapters: [], knowledgePoints: [], materials: [], materialChapters: [], questions: [], examPapers: [], flashCards: [] };
    const r = remapCoursePackage(pkg, empty);
    expect(r.courseId).toBe(1);
    expect(r.course.id).toBe(1);
    expect(r.chapters[0].courseId).toBe(1);
    expect(r.knowledgePoints[0].courseId).toBe(1);
    expect(r.knowledgePoints[0].chapterId).toBe(1);
    expect(r.materials[0].courseId).toBe(1);
    expect(r.questions[0].courseId).toBe(1);
    expect(r.questions[0].kpIds).toBe("1");
    expect(r.flashCards[0].courseId).toBe(1);
    expect(r.flashCards[0].kpId).toBe(1);
  });

  it("导入已有数据：新 id 不冲突（从现有 max+1 起），外键全部重写", () => {
    // 现有数据已有 课程1/2、章节1/2、知识点1/2、资料1/2、题目1/2、卡片1/2
    const existing = makeData();
    const src = makeData({
      // 目标课程 id=10，内部 id 独立（章 11/12，含父子；知识点 21 指向章 11，prevKp 指向 22）
      courses: [course({ id: 10, name: "化学", siyuanDocId: "doc-10" })],
      chapters: [chapter({ id: 11, courseId: 10, name: "有机" }), chapter({ id: 12, courseId: 10, parentId: 11, name: "烃", level: "unit" })],
      knowledgePoints: [kp({ id: 21, courseId: 10, chapterId: 11, name: "烷烃", prevKpIds: "22", sourceAssetIds: "31" }), kp({ id: 22, courseId: 10, chapterId: 12, name: "烯烃" })],
      materials: [material({ id: 31, courseId: 10, name: "化学.pdf", assetPath: "/assets/chem.pdf" })],
      materialChapters: [mc({ id: 41, materialId: 31, chapterId: 11 })],
      questions: [question({ id: 51, courseId: 10, kpIds: "21,22", paperId: 61 }), question({ id: 52, courseId: 10, kpIds: "22", paperId: null })],
      examPapers: [paper({ id: 61, courseId: 10, name: "化学模考" })],
      flashCards: [card({ id: 71, courseId: 10, kpId: 21 })],
    });
    const pkg = buildCoursePackageData(src, 10, { includeQuestions: true, includeCards: true, includeAssets: true });
    const r = remapCoursePackage(pkg, existing);

    // 新课程 id = 现有 max(2)+1 = 3
    expect(r.courseId).toBe(3);
    expect(r.course.id).toBe(3);
    // 章节 11/12 → 3/4；父子关系保持
    const ch = Object.fromEntries(r.chapters.map((c) => [c.id, c]));
    expect(Object.keys(ch).map(Number).sort((a, b) => a - b)).toEqual([3, 4]);
    expect(ch[3].courseId).toBe(3);
    expect(ch[4].parentId).toBe(3);
    // 知识点 21/22 → 3/4；chapterId、prevKpIds、sourceAssetIds 重写
    const k = Object.fromEntries(r.knowledgePoints.map((x) => [x.id, x]));
    expect(k[3].chapterId).toBe(3);
    expect(k[3].prevKpIds).toBe("4"); // 22 → 4
    expect(k[3].sourceAssetIds).toBe(String(r.materials[0].id)); // 31 → 新资料 id
    // 资料 31 → 3
    expect(r.materials[0].id).toBe(3);
    expect(r.materials[0].courseId).toBe(3);
    // 资料-章节映射重写
    expect(r.materialChapters[0].materialId).toBe(3);
    expect(r.materialChapters[0].chapterId).toBe(3);
    // 题目 kpIds / paperId 重写
    const q = Object.fromEntries(r.questions.map((x) => [x.id, x]));
    const qOf31 = r.questions.find((x) => x.kpIds.includes(String(r.knowledgePoints[0].id)));
    expect(qOf31?.paperId).toBe(r.examPapers[0].id);
    expect(qOf31?.courseId).toBe(3);
    // 试卷重写
    expect(r.examPapers[0].courseId).toBe(3);
    // 闪卡 kpId 重写
    expect(r.flashCards[0].courseId).toBe(3);
    expect(r.flashCards[0].kpId).toBe(r.knowledgePoints.find((x) => x.name === "烷烃")!.id);
    // 数量守恒
    expect(r.chapters).toHaveLength(2);
    expect(r.knowledgePoints).toHaveLength(2);
    expect(r.materials).toHaveLength(1);
    expect(r.questions).toHaveLength(2);
    expect(r.examPapers).toHaveLength(1);
    expect(r.flashCards).toHaveLength(1);
  });

  it("同名课程自动加「（导入）」后缀，避免与现有课程重名", () => {
    const existing = makeData(); // 已有「高等数学」
    const pkg = buildCoursePackageData(makeData(), 1);
    const r = remapCoursePackage(pkg, existing);
    expect(r.course.name).toBe("高等数学（导入）");
  });

  it("CSV 外键只重写包内已知 id，悬挂引用被丢弃", () => {
    const src = makeData({
      courses: [course({ id: 10, name: "化学" })],
      chapters: [chapter({ id: 11, courseId: 10 })],
      knowledgePoints: [kp({ id: 21, courseId: 10, chapterId: 11, prevKpIds: "22,999" })],
      materials: [],
      materialChapters: [],
      questions: [],
      examPapers: [],
      flashCards: [],
    });
    const pkg = buildCoursePackageData(src, 10);
    const r = remapCoursePackage(pkg, makeData());
    // 22 不在包内（只有 21），999 也不在 → prevKpIds 只剩被重写的 21? 不，22 不在包内 → 全丢
    expect(r.knowledgePoints[0].prevKpIds).toBe("");
  });

  it("空课程（无章节/知识点）也能重映射，数量守恒为 0", () => {
    const src = makeData({
      courses: [course({ id: 10, name: "空课程" })],
      chapters: [],
      knowledgePoints: [],
      materials: [],
      materialChapters: [],
      questions: [],
      examPapers: [],
      flashCards: [],
    });
    const pkg = buildCoursePackageData(src, 10);
    const r = remapCoursePackage(pkg, makeData());
    expect(r.courseId).toBe(3);
    expect(r.chapters).toEqual([]);
    expect(r.knowledgePoints).toEqual([]);
    expect(r.materials).toEqual([]);
  });
});

describe("applyImportToData", () => {
  it("把重映射结果并入现有数据：新增课程与实体，原有实体保持不变", () => {
    const existing = makeData();
    const pkg = buildCoursePackageData(makeData(), 1, { includeQuestions: true, includeCards: true });
    const r = remapCoursePackage(pkg, existing);
    const merged = applyImportToData(existing, r);

    expect(merged.courses).toHaveLength(3); // 原 2 + 新 1
    expect(merged.courses.some((c) => c.id === r.courseId)).toBe(true);
    expect(merged.chapters).toHaveLength(3); // 原 2 + 新 1
    expect(merged.knowledgePoints).toHaveLength(3);
    expect(merged.materials).toHaveLength(3);
    expect(merged.questions).toHaveLength(3);
    expect(merged.examPapers).toHaveLength(2);
    expect(merged.flashCards).toHaveLength(3);
    // 原有课程仍在
    expect(merged.courses.some((c) => c.id === 2 && c.name === "物理")).toBe(true);
    // 未触碰学习过程字段
    expect(merged.answerRecords).toEqual(existing.answerRecords);
  });
});
