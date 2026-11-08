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
