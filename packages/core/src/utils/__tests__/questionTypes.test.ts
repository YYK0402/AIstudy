import { describe, expect, it } from "vitest";
import { createEmptyData } from "../../types/appData";
import {
  addableBuiltinTypes,
  courseTypeList,
  normalizeAllCourseExtraTypes,
  normalizeCourseExtraTypes,
  typeLabelOf,
  typeModeOf,
  validateExtraTypeName,
} from "../questionTypes";
import type { AppData, Course, Question } from "../../types/appData";

function course(partial: Partial<Course> = {}): Course {
  return {
    id: 1,
    siyuanDocId: null,
    name: "英语",
    description: "",
    target: "",
    totalCycle: "",
    status: "active",
    createTime: "2026-01-01T00:00:00",
    ...partial,
  };
}

function question(qType: string): Question {
  return {
    id: 1,
    courseId: 1,
    qType,
    title: "t",
    options: "[]",
    answer: "",
    analysis: "",
    difficulty: "medium",
    kpIds: "",
    source: "ai",
    paperId: null,
    createTime: "2026-01-01T00:00:00",
  };
}

function emptyAppData(): AppData {
  return createEmptyData();
}

describe("courseTypeList", () => {
  it("无附加：仅 4 通用题型", () => {
    const list = courseTypeList(course());
    expect(list.map((t) => t.key)).toEqual(["single", "multiple", "judge", "essay"]);
    expect(list.every((t) => t.builtin && !t.extra)).toBe(true);
  });

  it("内置扩展引用：name=注册表键，label/mode 取注册表（忽略 ex.mode 脏值）", () => {
    const list = courseTypeList(
      course({ extraQuestionTypes: [{ name: "cloze", mode: "essay" }, { name: "translation", mode: "essay" }] }),
    );
    const cloze = list.find((t) => t.key === "cloze")!;
    const trans = list.find((t) => t.key === "translation")!;
    expect(cloze).toMatchObject({ label: "完形", mode: "passage", builtin: true, extra: true });
    expect(trans).toMatchObject({ label: "翻译", mode: "essay", builtin: true, extra: true });
  });

  it("自定义类型：label=名称，mode=其 mode", () => {
    const list = courseTypeList(course({ extraQuestionTypes: [{ name: "写作", mode: "essay" }] }));
    expect(list.find((t) => t.key === "写作")).toMatchObject({ label: "写作", mode: "essay", builtin: false, extra: true });
  });

  it("自定义 mode 非法（passage/脏值）回退 essay；与通用键重名跳过", () => {
    const list = courseTypeList(
      course({ extraQuestionTypes: [{ name: "写作", mode: "passage" }, { name: "single", mode: "essay" }] }),
    );
    expect(list.find((t) => t.key === "写作")!.mode).toBe("essay");
    expect(list.filter((t) => t.key === "single")).toHaveLength(1);
  });

  it("course 为空：仅通用", () => {
    expect(courseTypeList(null).map((t) => t.key)).toEqual(["single", "multiple", "judge", "essay"]);
  });
});

describe("typeLabelOf / typeModeOf（解析链：课程清单 → 注册表 → 回退）", () => {
  const c = course({ extraQuestionTypes: [{ name: "写作", mode: "essay" }] });

  it("课程清单命中（自定义）", () => {
    expect(typeLabelOf(c, "写作")).toBe("写作");
    expect(typeModeOf(c, "写作")).toBe("essay");
  });

  it("注册表兜底（课程未添加的内置类型，存量题不坏）", () => {
    expect(typeLabelOf(c, "translation")).toBe("翻译");
    expect(typeModeOf(c, "translation")).toBe("essay");
    expect(typeLabelOf(c, "cloze")).toBe("完形");
    expect(typeModeOf(c, "cloze")).toBe("passage");
    expect(typeModeOf(c, "judge")).toBe("single");
  });

  it("自定义类型被删：标签原样、模式回退 essay", () => {
    expect(typeLabelOf(c, "口语")).toBe("口语");
    expect(typeModeOf(c, "口语")).toBe("essay");
  });
});

describe("addableBuiltinTypes", () => {
  it("未添加：4 个内置扩展（注册表顺序）", () => {
    expect(addableBuiltinTypes(course()).map((t) => t.key)).toEqual(["fill", "banked", "cloze", "translation"]);
  });

  it("已添加的不再出现", () => {
    const c = course({ extraQuestionTypes: [{ name: "cloze", mode: "passage" }] });
    expect(addableBuiltinTypes(c).map((t) => t.key)).toEqual(["fill", "banked", "translation"]);
  });
});

describe("validateExtraTypeName", () => {
  const c = course({ extraQuestionTypes: [{ name: "写作", mode: "essay" }] });

  it("空名/超长/通用键/内置标签/课程重名 均报错", () => {
    expect(validateExtraTypeName("  ", c)).toBe("题型名不能为空");
    expect(validateExtraTypeName("一二三四五六七八九十一二三", c)).toBe("题型名最多 12 个字");
    expect(validateExtraTypeName("single", c)).toBe("与通用题型重名");
    expect(validateExtraTypeName("完形", c)).toBe("与内置题型名称重复");
    expect(validateExtraTypeName("写作", c)).toBe("本课程已有同名题型");
  });

  it("合法名返回 null（含与课程无关的内置键名，如未添加 cloze 前可用 cloze 做自定义名）", () => {
    expect(validateExtraTypeName("cloze", c)).toBeNull();
  });
});

describe("normalizeCourseExtraTypes（存量非通用内置型自动补入，幂等）", () => {
  it("存量 cloze 题：补入课程清单并带注册表 mode", () => {
    const c = course();
    const changed = normalizeCourseExtraTypes(c, [question("cloze"), question("single")]);
    expect(changed).toBe(true);
    expect(c.extraQuestionTypes).toEqual([{ name: "cloze", mode: "passage" }]);
  });

  it("幂等：再次执行无变更", () => {
    const c = course();
    normalizeCourseExtraTypes(c, [question("cloze")]);
    expect(normalizeCourseExtraTypes(c, [question("cloze")])).toBe(false);
    expect(c.extraQuestionTypes).toEqual([{ name: "cloze", mode: "passage" }]);
  });

  it("自定义题型不自动补入（仅内置注册表键）", () => {
    const c = course();
    expect(normalizeCourseExtraTypes(c, [question("写作")])).toBe(false);
    expect(c.extraQuestionTypes).toBeUndefined();
  });

  it("多类型去重：同型多题只补一条", () => {
    const c = course();
    normalizeCourseExtraTypes(c, [question("translation"), question("translation"), question("cloze")]);
    expect(c.extraQuestionTypes).toEqual([
      { name: "translation", mode: "essay" },
      { name: "cloze", mode: "passage" },
    ]);
  });

  it("normalizeAllCourseExtraTypes：按课程分组归一化", () => {
    const q1 = question("cloze");
    q1.courseId = 1;
    const q2 = question("translation");
    q2.courseId = 2;
    const c2 = course({ id: 2 });
    const data = emptyAppData();
    data.courses = [course(), c2];
    data.questions = [q1, q2];
    normalizeAllCourseExtraTypes(data);
    expect(data.courses[0].extraQuestionTypes).toEqual([{ name: "cloze", mode: "passage" }]);
    expect(data.courses[1].extraQuestionTypes).toEqual([{ name: "translation", mode: "essay" }]);
  });
});
