// @vitest-environment jsdom
// "siyuan" 由 vitest.config.ts 的 alias 解析到 __tests__/stubs/siyuan.ts（types-only 包无运行时入口）
import { describe, expect, it, vi } from "vitest";
import AiStudyPlugin from "../index";
import type { App } from "siyuan";
import { createEmptyData, type AppData, type CourseData, type Question } from "../../../core/src/types/appData";
import { mergeAppData, normalizeCourseData } from "../../../core/src/utils/courseSplit";

// TS private 仅编译期约束：测试经结构视图访问插件内部方法
type PluginInternals = {
  loadCourseFile(courseId: number): Promise<CourseData | null>;
  readPetalFileRaw(name: string): Promise<unknown>;
  detectExternalModifications(global: AppData, courses: Map<number, CourseData>): Promise<string[]>;
  hasExternalChange(): Promise<boolean>;
  setMergedView(view: AppData | null): void;
  initBaselines(): void;
  writtenBaselines: Map<string, string>;
  saveData: ReturnType<typeof vi.fn>;
};

const fakeApp = {} as App;

function makePlugin(diskFiles: Record<string, unknown>): PluginInternals {
  const plugin = new AiStudyPlugin({ app: fakeApp, name: "AIstudy", displayName: "AI 智能学习", i18n: {} });
  const internals = plugin as unknown as PluginInternals;
  internals.saveData = vi.fn(async (_name: string, _value: unknown) => ({ code: 0 }));
  vi.spyOn(internals, "readPetalFileRaw").mockImplementation(async (name: string) =>
    name in diskFiles ? diskFiles[name] : null,
  );
  return internals;
}

// 旧版本课程文件：缺新 schema 键 tocMappings
const LEGACY_COURSE: Record<string, unknown> = {
  chapters: [{ id: 1, courseId: 1, parentId: null, siyuanBlockId: null, name: "第 1 章", level: 1, sort: 1 }],
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
};

// 递归反转对象键序：语义不变，但 JSON 序列化结果与规范键序不同
function shuffleKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => shuffleKeysDeep(v));
  if (value !== null && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort().reverse()) out[key] = shuffleKeysDeep(src[key]);
    return out;
  }
  return value;
}

describe("loadCourseFile 归一化一次性写盘", () => {
  it("旧形态课程文件（缺新 schema 键）→ 加载时一次性写盘归一化形态，基线与磁盘一致", async () => {
    const internals = makePlugin({ "course-1": LEGACY_COURSE });
    const cd = await internals.loadCourseFile(1);
    // 内存已归一化
    expect(cd).not.toBeNull();
    expect(cd!.tocMappings).toEqual([]);
    // 触发一次写盘，内容为归一化形态
    expect(internals.saveData).toHaveBeenCalledTimes(1);
    const [name, written] = internals.saveData.mock.calls[0] as [string, CourseData];
    expect(name).toBe("course-1");
    expect(written.tocMappings).toEqual([]);
    expect(JSON.stringify(written)).toContain('"tocMappings":[]');
    // 基线一致性：写盘后重建基线（模拟 initData 末尾 initBaselines），
    // 必须等于磁盘写入内容，否则下次保存会误报「并发修改」重新死锁。
    // 全局部分必须含课程注册表（真实 initData 中 courses 列表始终在全局文件）
    const global = createEmptyData();
    global.courses = [
      {
        id: 1,
        siyuanDocId: null,
        name: "测试课",
        description: "",
        target: "",
        totalCycle: "14 天",
        status: "learning",
        createTime: "2026-01-01T00:00:00Z",
      },
    ];
    internals.setMergedView(mergeAppData(global, new Map([[1, cd!]])));
    internals.initBaselines();
    expect(internals.writtenBaselines.get("course-1")).toBe(JSON.stringify(written));
  });

  it("第二次加载（磁盘已是归一化形态）→ 零写盘（幂等）", async () => {
    const first = makePlugin({ "course-1": LEGACY_COURSE });
    await first.loadCourseFile(1);
    expect(first.saveData).toHaveBeenCalledTimes(1);
    const written = first.saveData.mock.calls[0][1] as CourseData;
    // 新实例 + 磁盘=刚写入的内容（模拟插件重启）
    const second = makePlugin({ "course-1": written });
    const cd = await second.loadCourseFile(1);
    expect(cd).toEqual(written);
    expect(second.saveData).not.toHaveBeenCalled();
  });

  it("键序不同但语义相同的文件 → 零写盘（语义比较防误写）", async () => {
    const normalized = normalizeCourseData(LEGACY_COURSE);
    const reshuffled = shuffleKeysDeep(normalized);
    // 自检：序列化不同（朴素字符串比较会触发重写）但语义相同
    expect(JSON.stringify(reshuffled)).not.toBe(JSON.stringify(normalized));
    expect(reshuffled).toEqual(normalized);
    const internals = makePlugin({ "course-1": reshuffled });
    await internals.loadCourseFile(1);
    expect(internals.saveData).not.toHaveBeenCalled();
  });

  it("课程文件缺失 → 返回 null 且不写盘（现有行为不回归）", async () => {
    const internals = makePlugin({});
    const cd = await internals.loadCourseFile(1);
    expect(cd).toBeNull();
    expect(internals.saveData).not.toHaveBeenCalled();
  });

  it("旧文章词形填空 → 触发迁移写盘且内容为合并后结构（既有 changed 路径不回归）", async () => {
    const passage = "For language __41__ (learner), these forms are __42__ (usual) in daily life.";
    const legacyQ = (id: number, no: number, word: string, answer: string): Question => ({
      id,
      courseId: 1,
      kpIds: "3",
      title: `${passage}\n\n第 ${no} 题：用所给单词 ${word} 的适当形式填空`,
      options: "[]",
      answer,
      analysis: `第${no}题解析`,
      qType: "cloze",
      difficulty: "medium",
      source: "manual",
      paperId: null,
      createTime: "2026-01-01T00:00:00Z",
    });
    const oldCourse: Record<string, unknown> = {
      ...normalizeCourseData(LEGACY_COURSE),
      questions: [legacyQ(175, 41, "learner", "learners"), legacyQ(176, 42, "usual", "unusual")],
    };
    const internals = makePlugin({ "course-1": oldCourse });
    const cd = await internals.loadCourseFile(1);
    expect(internals.saveData).toHaveBeenCalledTimes(1);
    const [name, written] = internals.saveData.mock.calls[0] as [string, CourseData];
    expect(name).toBe("course-1");
    expect(written.questions).toHaveLength(1);
    expect(written.questions[0].qType).toBe("fill");
    expect(written.questions[0].answer).toBe("41:learners|42:unusual");
    expect(cd?.questions[0].id).toBe(177);
  });

  it("归一化写盘失败（内核错误码）→ 不抛出，返回可用内存结构（下次加载重试）", async () => {
    const internals = makePlugin({ "course-1": LEGACY_COURSE });
    internals.saveData.mockResolvedValueOnce({ code: -1 });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const cd = await internals.loadCourseFile(1);
    expect(cd?.tocMappings).toEqual([]);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe("detectExternalModifications 语义比对加固", () => {
  // content 与 baseline 必不同（模拟用户真实改动触发读盘比对）
  const changedContent = (base: CourseData): CourseData => ({
    ...base,
    chapters: [...base.chapters, { ...base.chapters[0], id: 999 }],
  });

  it("磁盘键序与基线不同但语义相同 → 不判外部变更（T6 语义写盘防误报死锁）", async () => {
    const normalized = normalizeCourseData(LEGACY_COURSE);
    const reshuffled = shuffleKeysDeep(normalized) as CourseData;
    expect(JSON.stringify(reshuffled)).not.toBe(JSON.stringify(normalized));
    const internals = makePlugin({ "course-1": reshuffled });
    internals.writtenBaselines.set("course-1", JSON.stringify(normalized));
    const changed = await internals.detectExternalModifications(
      createEmptyData(),
      new Map([[1, changedContent(normalized)]]),
    );
    expect(changed).not.toContain("course-1");
  });

  it("磁盘值真实变更 → 仍判外部变更（加固不吞真实冲突）", async () => {
    const normalized = normalizeCourseData(LEGACY_COURSE);
    const tampered = { ...normalized, chapters: [] };
    const internals = makePlugin({ "course-1": tampered });
    internals.writtenBaselines.set("course-1", JSON.stringify(normalized));
    const changed = await internals.detectExternalModifications(
      createEmptyData(),
      new Map([[1, changedContent(normalized)]]),
    );
    expect(changed).toContain("course-1");
  });

  it("磁盘损坏（非 JSON）→ 仍判外部变更（fail-closed）", async () => {
    const normalized = normalizeCourseData(LEGACY_COURSE);
    const internals = makePlugin({ "course-1": "not-a-json{" });
    internals.writtenBaselines.set("course-1", JSON.stringify(normalized));
    const changed = await internals.detectExternalModifications(
      createEmptyData(),
      new Map([[1, changedContent(normalized)]]),
    );
    expect(changed).toContain("course-1");
  });

  it("磁盘缺失 → 保持原 changed 语义（语义复核不误放行）", async () => {
    const normalized = normalizeCourseData(LEGACY_COURSE);
    const internals = makePlugin({}); // course-1 不在磁盘
    internals.writtenBaselines.set("course-1", JSON.stringify(normalized));
    const changed = await internals.detectExternalModifications(
      createEmptyData(),
      new Map([[1, changedContent(normalized)]]),
    );
    expect(changed).toContain("course-1");
  });
});

describe("hasExternalChange 语义复核（与 detect 口径统一）", () => {
  it("磁盘键序不同但语义相同 → 无外部变更（overwrite 回显不触发无效重建）", async () => {
    const normalized = normalizeCourseData(LEGACY_COURSE);
    const reshuffled = shuffleKeysDeep(normalized) as CourseData;
    // 自检：字节必须不同（否则测试经字节快路径假绿，未走到语义复核）
    expect(JSON.stringify(reshuffled)).not.toBe(JSON.stringify(normalized));
    const internals = makePlugin({ "course-1": reshuffled });
    internals.writtenBaselines.set("course-1", JSON.stringify(normalized));
    expect(await internals.hasExternalChange()).toBe(false);
  });

  it("读盘失败（抛异常）→ 有外部变更（fail-closed 保持）", async () => {
    const normalized = normalizeCourseData(LEGACY_COURSE);
    const internals = makePlugin({ "course-1": normalized });
    internals.writtenBaselines.set("course-1", JSON.stringify(normalized));
    vi.mocked(internals.readPetalFileRaw).mockRejectedValueOnce(new Error("读盘异常"));
    expect(await internals.hasExternalChange()).toBe(true);
  });

  it("全局 data 文件缺失 → 有外部变更（钉住与 detect 的有意分叉：回显侧无空结构特判）", async () => {
    const internals = makePlugin({});
    internals.writtenBaselines.set("data", JSON.stringify(createEmptyData()));
    expect(await internals.hasExternalChange()).toBe(true);
  });

  it("磁盘值真实变更 → 有外部变更", async () => {
    const normalized = normalizeCourseData(LEGACY_COURSE);
    const tampered = { ...normalized, chapters: [] };
    const internals = makePlugin({ "course-1": tampered });
    internals.writtenBaselines.set("course-1", JSON.stringify(normalized));
    expect(await internals.hasExternalChange()).toBe(true);
  });

  it("磁盘损坏（非 JSON）→ 有外部变更（fail-closed）", async () => {
    const normalized = normalizeCourseData(LEGACY_COURSE);
    const internals = makePlugin({ "course-1": "not-a-json{" });
    internals.writtenBaselines.set("course-1", JSON.stringify(normalized));
    expect(await internals.hasExternalChange()).toBe(true);
  });

  it("磁盘缺失 → 有外部变更（保持原语义）", async () => {
    const normalized = normalizeCourseData(LEGACY_COURSE);
    const internals = makePlugin({});
    internals.writtenBaselines.set("course-1", JSON.stringify(normalized));
    expect(await internals.hasExternalChange()).toBe(true);
  });
});
