import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  applyImportToData,
  buildCoursePackageData,
  buildCoursePackageZip,
  parseCoursePackageZip,
  remapCoursePackage,
} from "../coursePackage";
import type { AppData, Chapter, Course, KnowledgePoint, Material, Question } from "../../types/appData";

const T = "2026-01-01T00:00:00.000Z";
function course(over: Partial<Course> = {}): Course {
  return { id: 1, siyuanDocId: "doc-1", name: "高等数学", description: "微积分", target: "90+", totalCycle: "12 周", status: "active", createTime: T, modelId: 7, ...over };
}
function chapter(over: Partial<Chapter> = {}): Chapter {
  return { id: 1, courseId: 1, parentId: null, siyuanBlockId: "blk-1", name: "第一章", level: "chapter", sort: 1, ...over };
}
function kp(over: Partial<KnowledgePoint> = {}): KnowledgePoint {
  return { id: 1, courseId: 1, chapterId: 1, blockId: "blk-kp", name: "极限", content: "极限的内容", mastery: "mastered", sourceAssetIds: "1", prevKpIds: "", chapterName: "第一章", sort: 1, createTime: T, ...over };
}
function material(over: Partial<Material> = {}): Material {
  return { id: 1, courseId: 1, name: "课本.pdf", assetPath: "/assets/abc.pdf", fileType: "pdf", contentText: "课本正文", headings: "[]", siyuanDocId: "doc-mat", status: "ok", createTime: T, source: "upload", ...over };
}
function question(over: Partial<Question> = {}): Question {
  return { id: 1, courseId: 1, kpIds: "1", title: "什么是极限？", options: "[]", answer: "A", analysis: "", qType: "single", difficulty: "medium", source: "ai", paperId: null, createTime: T, ...over };
}
function makeData(over: Partial<AppData> = {}): AppData {
  return {
    providers: [], models: [], taskModels: [], logs: [],
    courses: [course()],
    chapters: [chapter()],
    knowledgePoints: [kp()],
    materials: [material()],
    materialChapters: [{ id: 1, materialId: 1, chapterId: 1 }],
    questions: [question()],
    examPapers: [],
    answerRecords: [], wrongQuestions: [], studyPlans: [], studyTasks: [], explainRecords: [], reviewSchedules: [],
    flashCards: [],
    studyLogs: [], studyLogMonthly: [], answerStatsMonthly: [],
    settings: { chapterMode: "manual", persistToSiyuan: false, notebookName: "AI 研习" },
    ...over,
  };
}

describe("课程包 zip round-trip", () => {
  it("打包 → 序列化 → 解析，数据无损", async () => {
    const data = makeData();
    const pkg = buildCoursePackageData(data, 1, { includeQuestions: true });
    const { zip } = await buildCoursePackageZip(pkg, data, { includeQuestions: true });
    const buf = await zip.generateAsync({ type: "arraybuffer" });
    const loaded = await JSZip.loadAsync(buf);
    const parsed = await parseCoursePackageZip(loaded);
    expect(parsed.course.name).toBe("高等数学");
    expect(parsed.knowledgePoints).toHaveLength(1);
    expect(parsed.knowledgePoints[0].mastery).toBe("unlearn"); // 个人状态已在 build 阶段重置
    expect(parsed.questions).toHaveLength(1);
    expect(parsed.materials[0].contentText).toBe("课本正文");
  });

  it("解析后的包可重映射并入已有数据（id 不冲突）", async () => {
    const src = makeData();
    const pkg = buildCoursePackageData(src, 1, { includeQuestions: true });
    const { zip } = await buildCoursePackageZip(pkg, src, { includeQuestions: true });
    const buf = await zip.generateAsync({ type: "arraybuffer" });
    const parsed = await parseCoursePackageZip(await JSZip.loadAsync(buf));

    // 接收方已有一门同名课程
    const existing = makeData();
    const remapped = remapCoursePackage(parsed, existing);
    expect(remapped.courseId).toBe(2); // 现有 max(1)+1
    expect(remapped.course.name).toBe("高等数学（导入）"); // 同名加后缀
    const merged = applyImportToData(existing, remapped);
    expect(merged.courses).toHaveLength(2);
    expect(merged.knowledgePoints).toHaveLength(2);
    expect(merged.questions).toHaveLength(2);
    // 外键指向新课程
    expect(merged.knowledgePoints[1].courseId).toBe(2);
    expect(merged.questions[1].courseId).toBe(2);
  });

  it("缺 manifest 的 zip 解析报错", async () => {
    const zip = new JSZip();
    zip.file("data.json", "{}");
    await expect(parseCoursePackageZip(zip)).rejects.toThrow("缺少 manifest.json");
  });

  it("格式不符的 zip 解析报错", async () => {
    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify({ format: "other", version: 1 }));
    zip.file("data.json", "{}");
    await expect(parseCoursePackageZip(zip)).rejects.toThrow("格式不符");
  });
});
