import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  backupCounts,
  buildBackupData,
  buildBackupManifest,
  buildBackupZip,
  mergeBackupIntoData,
  normalizeBackupData,
  parseBackupZip,
  prepareRestoreData,
} from "../backup";
import { createEmptyData } from "../../types/appData";
import type {
  AnswerRecord,
  AppData,
  Chapter,
  Course,
  ExplainRecord,
  FlashCard,
  KnowledgePoint,
  Material,
  MaterialChapter,
  Question,
  QuestionAsk,
  ReviewSchedule,
  StudyLog,
  StudyPlan,
  StudyTask,
  WrongQuestion,
} from "../../types/appData";

const T = "2026-01-01T00:00:00.000Z";

function course(over: Partial<Course> = {}): Course {
  return {
    id: 10,
    siyuanDocId: "doc-old",
    name: "乙",
    description: "",
    target: "",
    totalCycle: "",
    status: "active",
    createTime: T,
    modelId: 99,
    ...over,
  };
}

function makeBackupData(over: Partial<AppData> = {}): AppData {
  const chapters: Chapter[] = [
    { id: 100, courseId: 10, parentId: null, siyuanBlockId: "blk-100", name: "第一章", level: 1, sort: 1 },
    { id: 101, courseId: 10, parentId: 100, siyuanBlockId: "blk-101", name: "第一节", level: 2, sort: 2 },
  ];
  const kps: KnowledgePoint[] = [
    {
      id: 200,
      courseId: 10,
      chapterId: 100,
      blockId: "blk-kp-1",
      blockName: "KP1 文档",
      name: "极限",
      content: "极限内容",
      mastery: "mastered",
      sourceAssetIds: "300",
      prevKpIds: "",
      chapterName: "第一章",
      sort: 1,
      createTime: T,
    },
    {
      id: 201,
      courseId: 10,
      chapterId: 101,
      blockId: null,
      name: "连续",
      content: "连续内容",
      mastery: "known",
      sourceAssetIds: "301",
      prevKpIds: "200",
      chapterName: "第一节",
      sort: 2,
      createTime: T,
    },
  ];
  const materials: Material[] = [
    {
      id: 300,
      courseId: 10,
      name: "课本.pdf",
      assetPath: "/data/storage/petal/ai-study/kb.pdf",
      fileType: "pdf",
      contentText: "正文",
      headings: "[]",
      siyuanDocId: "doc-mat",
      status: "ok",
      createTime: T,
      source: "upload",
    },
    {
      id: 301,
      courseId: 10,
      name: "NAS 资料.pdf",
      assetPath: "api/nas/file?path=%2Fvol1%2Fa.pdf",
      fileType: "pdf",
      contentText: "NAS 正文",
      headings: "[]",
      siyuanDocId: null,
      status: "ok",
      createTime: T,
      source: "nas",
    },
  ];
  const materialChapters: MaterialChapter[] = [{ id: 400, materialId: 300, chapterId: 100 }];
  const questions: Question[] = [
    {
      id: 500,
      courseId: 10,
      kpIds: "200,201",
      title: "题",
      options: "[]",
      answer: "A",
      analysis: "",
      qType: "single",
      difficulty: "medium",
      source: "ai",
      paperId: 600,
      createTime: T,
    },
  ];
  const cards: FlashCard[] = [{ id: 700, courseId: 10, kpId: 200, front: "f", back: "b", source: "ai", createTime: T }];
  const answerRecords: AnswerRecord[] = [
    { id: 800, qId: 500, userAnswer: "A", isCorrect: true, score: "", createTime: T },
  ];
  const wrongs: WrongQuestion[] = [{ id: 900, recordId: 800, qId: 500, reviewTimes: 1, createTime: T }];
  const plans: StudyPlan[] = [
    { id: 1000, courseId: 10, planContent: "", targetDate: "2026-02-01", dailyHour: "1", createTime: T },
  ];
  const tasks: StudyTask[] = [
    {
      id: 1100,
      planId: 1000,
      chapterId: 100,
      kpId: 200,
      taskType: "study",
      title: "任务",
      scheduledDate: "2026-01-02",
      status: "todo",
      sort: 1,
    },
  ];
  const explains: ExplainRecord[] = [
    { id: 1200, courseId: 10, kpId: 200, userContent: "u", aiFeedback: "a", aiScore: "80", createTime: T },
  ];
  const asks: QuestionAsk[] = [
    { id: 1300, qId: 500, courseId: 10, turns: [], updateTime: T },
  ];
  const reviews: ReviewSchedule[] = [
    {
      id: 1400,
      kpId: 200,
      qId: null,
      cardId: 700,
      stage: 2,
      dueTime: T,
      easeFactor: 2.5,
      intervalDays: 3,
      lastReviewTime: T,
      reviewTimes: 2,
    },
  ];
  const logs: StudyLog[] = [
    { id: 1500, courseId: 10, kpId: 200, taskId: 1100, action: "study", duration: 60, createTime: T },
  ];

  return {
    ...createEmptyData(),
    providers: [{ id: 1, name: "P", baseUrl: "https://x", apiKey: "enc1:abc", timeout: 30, enabled: true, createTime: T }],
    models: [{ id: 99, providerId: 1, modelId: "m", displayName: "M", maxContext: null }],
    courses: [course()],
    chapters,
    knowledgePoints: kps,
    materials,
    materialChapters,
    questions,
    examPapers: [{ id: 600, courseId: 10, name: "卷", year: 2026, createTime: T }],
    answerRecords,
    questionAsks: asks,
    wrongQuestions: wrongs,
    studyPlans: plans,
    studyTasks: tasks,
    explainRecords: explains,
    reviewSchedules: reviews,
    flashCards: cards,
    studyLogs: logs,
    studyLogMonthly: [{ courseId: 10, month: "2026-01", seconds: 60, actions: 1, lastDay: "2026-01-01" }],
    answerStatsMonthly: [{ courseId: 10, month: "2026-01", total: 1, correct: 1, essayTotalScore: 0, essayCount: 0 }],
    conversationsDocs: {
      "course-10": { docId: "d1" },
      "100": { docId: "d2" },
    },
    docRegions: { d1: { h: "x", ids: [200] } },
    ...over,
  };
}

function makeExisting(): AppData {
  const data = createEmptyData();
  data.courses = [course({ id: 1, name: "甲", createTime: "2025-01-01T00:00:00.000Z" })];
  data.chapters = [{ id: 1, courseId: 1, parentId: null, siyuanBlockId: null, name: "旧章", level: 1, sort: 1 }];
  data.knowledgePoints = [
    {
      id: 1,
      courseId: 1,
      chapterId: 1,
      blockId: null,
      name: "旧点",
      content: "c",
      mastery: "unlearn",
      sourceAssetIds: "",
      prevKpIds: "",
      chapterName: "旧章",
      sort: 1,
      createTime: T,
    },
  ];
  data.materials = [
    {
      id: 1,
      courseId: 1,
      name: "旧资料",
      assetPath: "",
      fileType: "txt",
      contentText: "t",
      headings: "[]",
      siyuanDocId: null,
      status: "ok",
      createTime: T,
      source: "paste",
    },
  ];
  data.questions = [
    {
      id: 1,
      courseId: 1,
      kpIds: "1",
      title: "旧题",
      options: "[]",
      answer: "A",
      analysis: "",
      qType: "single",
      difficulty: "easy",
      source: "ai",
      paperId: null,
      createTime: T,
    },
  ];
  data.answerRecords = [{ id: 1, qId: 1, userAnswer: "A", isCorrect: true, score: "", createTime: T }];
  data.studyPlans = [{ id: 1, courseId: 1, planContent: "", targetDate: "2026-02-01", dailyHour: "1", createTime: T }];
  data.studyTasks = [
    {
      id: 1,
      planId: 1,
      chapterId: 1,
      kpId: 1,
      taskType: "study",
      title: "旧任务",
      scheduledDate: "2026-01-02",
      status: "todo",
      sort: 1,
    },
  ];
  data.flashCards = [{ id: 1, courseId: 1, kpId: 1, front: "f", back: "b", source: "ai", createTime: T }];
  data.reviewSchedules = [
    {
      id: 1,
      kpId: 1,
      qId: null,
      cardId: 1,
      stage: 1,
      dueTime: T,
      easeFactor: 2.5,
      intervalDays: 1,
      lastReviewTime: null,
      reviewTimes: 0,
    },
  ];
  data.studyLogs = [{ id: 1, courseId: 1, kpId: 1, taskId: 1, action: "study", duration: 10, createTime: T }];
  return data;
}

describe("备份数据构建", () => {
  it("统计各项数量", () => {
    const c = backupCounts(makeBackupData());
    expect(c.courses).toBe(1);
    expect(c.kps).toBe(2);
    expect(c.questions).toBe(1);
    expect(c.answerRecords).toBe(1);
  });

  it("默认保留 API Key，关闭时清空", () => {
    const data = makeBackupData();
    expect(buildBackupData(data).providers[0].apiKey).toBe("enc1:abc");
    expect(buildBackupData(data, { includeApiKeys: false }).providers[0].apiKey).toBe("");
  });

  it("导出数据为深拷贝，不污染原数据", () => {
    const data = makeBackupData();
    const out = buildBackupData(data);
    out.courses[0].name = "改";
    expect(data.courses[0].name).toBe("乙");
  });

  it("manifest 记录格式/版本/宿主与选项", () => {
    const m = buildBackupManifest(makeBackupData(), { includeAssets: false, includeApiKeys: false });
    expect(m.format).toBe(BACKUP_FORMAT);
    expect(m.version).toBe(BACKUP_VERSION);
    expect(m.options).toEqual({ assets: false, apiKeys: false });
  });
});

describe("备份 zip 打包与解析", () => {
  it("打包 → 解析 round-trip 数据一致", async () => {
    const data = makeBackupData();
    const { zip, manifest } = await buildBackupZip(data, { includeAssets: false });
    const parsed = await parseBackupZip(zip);
    expect(parsed.manifest.format).toBe(BACKUP_FORMAT);
    expect(parsed.manifest.counts.courses).toBe(manifest.counts.courses);
    expect(parsed.data.courses[0].name).toBe("乙");
    expect(parsed.data.knowledgePoints).toHaveLength(2);
    expect(parsed.data.settings.chapterMode).toBe("manual");
  });

  it("拒绝格式不符 / 版本过新 / 缺 data.json", async () => {
    const wrongFormat = new JSZip();
    wrongFormat.file("manifest.json", JSON.stringify({ format: "other", version: 1 }));
    wrongFormat.file("data.json", JSON.stringify(makeBackupData()));
    await expect(parseBackupZip(wrongFormat)).rejects.toThrow("格式不符");

    const tooNew = new JSZip();
    tooNew.file("manifest.json", JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION + 1 }));
    tooNew.file("data.json", JSON.stringify(makeBackupData()));
    await expect(parseBackupZip(tooNew)).rejects.toThrow("版本过新");

    const noData = new JSZip();
    noData.file("manifest.json", JSON.stringify({ format: BACKUP_FORMAT, version: 1 }));
    await expect(parseBackupZip(noData)).rejects.toThrow("缺少 data.json");
  });
});

describe("normalizeBackupData", () => {
  it("缺少关键数组 / settings 视为损坏", () => {
    expect(() => normalizeBackupData({})).toThrow("备份数据损坏");
    const raw = JSON.parse(JSON.stringify(makeBackupData())) as Record<string, unknown>;
    delete raw.chapters;
    expect(() => normalizeBackupData(raw)).toThrow("缺少 chapters");
    const noSettings = JSON.parse(JSON.stringify(makeBackupData())) as Record<string, unknown>;
    delete noSettings.settings;
    expect(() => normalizeBackupData(noSettings)).toThrow("缺少 settings");
  });

  it("tocMappings 保留；缺失视为损坏", () => {
    const withToc = makeBackupData({
      tocMappings: [{ id: 1, materialId: 300, courseId: 10, materialPath: "第一章", chapterId: 100 }],
    });
    expect(normalizeBackupData(JSON.parse(JSON.stringify(withToc))).tocMappings).toHaveLength(1);
    const noToc = JSON.parse(JSON.stringify(makeBackupData())) as Record<string, unknown>;
    delete noToc.tocMappings;
    expect(() => normalizeBackupData(noToc)).toThrow("缺少 tocMappings");
  });
});

describe("prepareRestoreData", () => {
  const manifest = {
    format: BACKUP_FORMAT,
    version: 1,
    createdAt: T,
    host: "siyuan",
    options: { assets: true, apiKeys: true },
    counts: backupCounts(makeBackupData()),
    note: "",
  };

  it("同端保留宿主绑定与资源路径", () => {
    const out = prepareRestoreData(makeBackupData(), manifest, "siyuan");
    expect(out.courses[0].siyuanDocId).toBe("doc-old");
    expect(out.materials[0].assetPath).toBe("/data/storage/petal/ai-study/kb.pdf");
    expect(out.conversationsDocs).toBeDefined();
  });

  it("跨端剥离文档/资源绑定与落库开关", () => {
    const out = prepareRestoreData(makeBackupData(), manifest, "fnos");
    expect(out.courses[0].siyuanDocId).toBeNull();
    expect(out.chapters[0].siyuanBlockId).toBeNull();
    expect(out.knowledgePoints[0].blockId).toBeNull();
    expect(out.knowledgePoints[0].blockName).toBeUndefined();
    expect(out.materials[0].siyuanDocId).toBeNull();
    expect(out.materials[0].assetPath).toBe("");
    expect(out.settings.persistToSiyuan).toBe(false);
    expect(out.conversationsDocs).toBeUndefined();
    expect(out.docRegions).toBeUndefined();
  });
});

describe("mergeBackupIntoData", () => {
  it("重映射全部外键并保留学习进度", () => {
    const existing = makeExisting();
    const { data, stats } = mergeBackupIntoData(makeBackupData(), existing, {
      host: "siyuan",
      backupHost: "siyuan",
    });

    expect(stats.courses).toBe(1);
    expect(stats.kps).toBe(2);
    expect(stats.skippedCourses).toBe(0);
    expect(data.courses).toHaveLength(2);

    const imported = data.courses.find((c) => c.name === "乙")!;
    expect(imported.id).toBe(2);
    expect(imported.modelId).toBeNull();
    expect(imported.siyuanDocId).toBe("doc-old");

    const ch1 = data.chapters.find((c) => c.name === "第一章")!;
    const ch2 = data.chapters.find((c) => c.name === "第一节")!;
    expect(ch1.id).toBe(2);
    expect(ch2.id).toBe(3);
    expect(ch2.parentId).toBe(2);
    expect(ch1.courseId).toBe(2);

    const kp1 = data.knowledgePoints.find((k) => k.name === "极限")!;
    const kp2 = data.knowledgePoints.find((k) => k.name === "连续")!;
    expect(kp1.id).toBe(2);
    expect(kp1.chapterId).toBe(2);
    expect(kp1.mastery).toBe("mastered");
    expect(kp1.sourceAssetIds).toBe("2");
    expect(kp1.blockId).toBe("blk-kp-1");
    expect(kp2.prevKpIds).toBe("2");
    expect(kp2.chapterId).toBe(3);

    const mat = data.materials.find((m) => m.name === "课本.pdf")!;
    expect(mat.id).toBe(2);
    expect(mat.courseId).toBe(2);
    expect(mat.assetPath).toBe("/data/storage/petal/ai-study/kb.pdf");

    const mc = data.materialChapters.find((x) => x.materialId === mat.id)!;
    expect(mc.chapterId).toBe(ch1.id);

    const q = data.questions.find((x) => x.title === "题")!;
    expect(q.id).toBe(2);
    expect(q.kpIds).toBe("2,3");
    expect(q.paperId).toBe(1);

    const rec = data.answerRecords.find((r) => r.qId === q.id)!;
    expect(rec.id).toBe(2);
    const wrong = data.wrongQuestions.find((w) => w.qId === q.id)!;
    expect(wrong.recordId).toBe(2);

    const plan = data.studyPlans.find((p) => p.courseId === 2)!;
    const task = data.studyTasks.find((t) => t.planId === plan.id)!;
    expect(task.chapterId).toBe(ch1.id);
    expect(task.kpId).toBe(kp1.id);

    const card = data.flashCards.find((c) => c.courseId === 2)!;
    expect(card.kpId).toBe(kp1.id);
    const review = data.reviewSchedules.find((r) => r.cardId === card.id)!;
    expect(review.kpId).toBe(kp1.id);
    expect(review.stage).toBe(2);

    const log = data.studyLogs.find((l) => l.courseId === 2)!;
    expect(log.taskId).toBe(task.id);
    expect(log.kpId).toBe(kp1.id);

    expect(data.studyLogMonthly.find((m) => m.courseId === 2)).toBeTruthy();
    expect(data.answerStatsMonthly.find((m) => m.courseId === 2)).toBeTruthy();

    expect(data.conversationsDocs?.["course-2"]).toEqual({ docId: "d1" });
    expect(data.conversationsDocs?.["2"]).toEqual({ docId: "d2" });
    expect(data.docRegions?.d1).toEqual({ h: "x", ids: [200] });

    // 现有数据保持不变
    expect(existing.courses).toHaveLength(1);
    expect(existing.knowledgePoints).toHaveLength(1);
  });

  it("tocMappings 三外键重映射；悬挂行丢弃", () => {
    const backup = makeBackupData({
      tocMappings: [
        { id: 1, materialId: 300, courseId: 10, materialPath: "第一章>1.1 概述", chapterId: 100 },
        { id: 2, materialId: 301, courseId: 10, materialPath: "第二章", chapterId: 101 },
        { id: 3, materialId: 999, courseId: 10, materialPath: "悬挂", chapterId: 100 },
      ],
    });
    const { data } = mergeBackupIntoData(backup, makeExisting(), { host: "siyuan", backupHost: "siyuan" });
    expect(data.tocMappings).toEqual([
      { id: 1, materialId: 2, courseId: 2, materialPath: "第一章>1.1 概述", chapterId: 2 },
      { id: 2, materialId: 3, courseId: 2, materialPath: "第二章", chapterId: 3 },
    ]);
  });

  it("跨端清空文档/资源绑定，保留正文与进度", () => {
    const { data } = mergeBackupIntoData(makeBackupData(), makeExisting(), {
      host: "fnos",
      backupHost: "siyuan",
    });
    const imported = data.courses.find((c) => c.name === "乙")!;
    expect(imported.siyuanDocId).toBeNull();
    expect(data.chapters.find((c) => c.courseId === imported.id)!.siyuanBlockId).toBeNull();
    expect(data.knowledgePoints.find((k) => k.courseId === imported.id)!.blockId).toBeNull();
    const mat = data.materials.find((m) => m.name === "课本.pdf")!;
    expect(mat.siyuanDocId).toBeNull();
    expect(mat.assetPath).toBe("");
    expect(mat.contentText).toBe("正文");
    expect(data.knowledgePoints.find((k) => k.name === "极限")!.mastery).toBe("mastered");
    expect(data.conversationsDocs).toBeUndefined();
    expect(data.docRegions).toBeUndefined();
  });

  it("重复合并幂等：第二次全部跳过", () => {
    const existing = makeExisting();
    const backup = makeBackupData();
    const first = mergeBackupIntoData(backup, existing, { host: "siyuan", backupHost: "siyuan" });
    expect(first.stats.skippedCourses).toBe(0);
    const second = mergeBackupIntoData(backup, first.data, { host: "siyuan", backupHost: "siyuan" });
    expect(second.stats.skippedCourses).toBe(1);
    expect(second.stats.courses).toBe(0);
    expect(second.data.courses).toHaveLength(2);
  });

  it("同名同创建时间跳过；同名不同时间加「（导入）」后缀", () => {
    const existing = makeExisting();
    const backup = makeBackupData({
      courses: [
        course({ id: 10, name: "甲", createTime: "2025-01-01T00:00:00.000Z" }),
        course({ id: 11, name: "甲", createTime: "2026-05-01T00:00:00.000Z" }),
      ],
      chapters: [],
      knowledgePoints: [],
      materials: [],
      materialChapters: [],
      questions: [],
      examPapers: [],
      answerRecords: [],
      questionAsks: [],
      wrongQuestions: [],
      studyPlans: [],
      studyTasks: [],
      explainRecords: [],
      reviewSchedules: [],
      flashCards: [],
      studyLogs: [],
      studyLogMonthly: [],
      answerStatsMonthly: [],
      conversationsDocs: undefined,
      docRegions: undefined,
    });
    const { data, stats } = mergeBackupIntoData(backup, existing, { host: "siyuan", backupHost: "siyuan" });
    expect(stats.skippedCourses).toBe(1);
    expect(stats.courses).toBe(1);
    expect(data.courses.map((c) => c.name)).toEqual(["甲", "甲（导入）"]);
  });
});
