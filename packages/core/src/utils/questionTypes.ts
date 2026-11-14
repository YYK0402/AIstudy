// 课程绑定题型：4 通用题型（单选/多选/判断/简答）恒有 + 课程附加（内置扩展引用 翻译/完形/填空/选择填空，或自定义）。
// Question.qType = 内置注册表键或自定义名；作答/判分/展示行为统一经 typeModeOf/typeLabelOf 解析：
// 课程清单 → 注册表兜底（存量题不坏）→ 原文/简答回退（自定义类型被删后题目仍可作答）。
import type { AppData, Course, ExtraQuestionType, Question, QuestionTypeMode } from "../types/appData";
import {
  GENERIC_QUESTION_TYPES,
  QUESTION_TYPES,
  QUESTION_TYPE_LABELS,
  QUESTION_TYPE_MODES,
  type QuestionType,
} from "../api/constants";

export interface CourseQuestionTypeEntry {
  /** 题型键：内置=注册表键（single/cloze…），自定义=其名称 */
  key: string;
  label: string;
  mode: QuestionTypeMode;
  /** 内置（通用或已添加的扩展） */
  builtin: boolean;
  /** 来自课程附加（可移除） */
  extra: boolean;
}

const BUILTIN_SET = new Set<string>(QUESTION_TYPES);
/** 自定义类型允许的作答模式（passage 为内置题型专属，自定义不提供） */
const CUSTOM_MODES: QuestionTypeMode[] = ["single", "multiple", "essay"];

/** 课程题型清单 = 4 通用 + 课程附加（通用键重复时跳过；自定义名与通用键重复时跳过） */
export function courseTypeList(course: Course | null | undefined): CourseQuestionTypeEntry[] {
  const out: CourseQuestionTypeEntry[] = [];
  for (const k of GENERIC_QUESTION_TYPES) {
    out.push({ key: k, label: QUESTION_TYPE_LABELS[k], mode: QUESTION_TYPE_MODES[k], builtin: true, extra: false });
  }
  for (const ex of course?.extraQuestionTypes ?? []) {
    const key = (ex?.name ?? "").trim();
    if (!key || out.some((t) => t.key === key)) continue;
    const builtin = BUILTIN_SET.has(key);
    const mode: QuestionTypeMode = builtin
      ? QUESTION_TYPE_MODES[key as QuestionType]
      : CUSTOM_MODES.includes(ex.mode)
        ? ex.mode
        : "essay";
    out.push({
      key,
      label: builtin ? QUESTION_TYPE_LABELS[key as QuestionType] : key,
      mode,
      builtin,
      extra: true,
    });
  }
  return out;
}

/** 题型显示名：课程清单 → 注册表兜底 → 原样（自定义类型已删除的存量题） */
export function typeLabelOf(course: Course | null | undefined, qType: string): string {
  const hit = courseTypeList(course).find((t) => t.key === qType);
  if (hit) return hit.label;
  if (BUILTIN_SET.has(qType)) return QUESTION_TYPE_LABELS[qType as QuestionType];
  return qType;
}

/** 题型作答模式：课程清单 → 注册表兜底 → essay 回退（自定义类型已删除：按简答式作答不崩） */
export function typeModeOf(course: Course | null | undefined, qType: string): QuestionTypeMode {
  const hit = courseTypeList(course).find((t) => t.key === qType);
  if (hit) return hit.mode;
  if (BUILTIN_SET.has(qType)) return QUESTION_TYPE_MODES[qType as QuestionType];
  return "essay";
}

/** 可添加到课程的内置扩展题型（非通用注册表类型，且不在课程清单中） */
export function addableBuiltinTypes(course: Course | null | undefined): { key: string; label: string }[] {
  const inList = new Set(courseTypeList(course).map((t) => t.key));
  return QUESTION_TYPES.filter((k) => !GENERIC_QUESTION_TYPES.includes(k as (typeof GENERIC_QUESTION_TYPES)[number]) && !inList.has(k)).map(
    (k) => ({ key: k, label: QUESTION_TYPE_LABELS[k] }),
  );
}

/** 校验课程附加题型名（新增/改名共用）：返回错误文案，null = 合法 */
export function validateExtraTypeName(name: string, course: Course | null | undefined): string | null {
  const n = (name ?? "").trim();
  if (!n) return "题型名不能为空";
  if (n.length > 12) return "题型名最多 12 个字";
  if (GENERIC_QUESTION_TYPES.includes(n as (typeof GENERIC_QUESTION_TYPES)[number])) return "与通用题型重名";
  if (Object.values(QUESTION_TYPE_LABELS).includes(n)) return "与内置题型名称重复";
  if ((course?.extraQuestionTypes ?? []).some((t) => (t.name ?? "").trim() === n)) return "本课程已有同名题型";
  return null;
}

/** 一次性归一化（幂等，就地改 course）：课程已有题目使用了非通用内置题型但课程清单未添加 → 自动补进 extraQuestionTypes。
 *  存量英语课（完形/翻译题）零操作保持可用；下次 saveData 随课程落盘。返回是否发生变更 */
export function normalizeCourseExtraTypes(course: Course, courseQuestions: Question[]): boolean {
  if (courseQuestions.length === 0) return false;
  let extra = course.extraQuestionTypes ?? [];
  let changed = false;
  for (const q of courseQuestions) {
    const t = q.qType.trim();
    if (!BUILTIN_SET.has(t)) continue;
    if (GENERIC_QUESTION_TYPES.includes(t as (typeof GENERIC_QUESTION_TYPES)[number])) continue;
    if (extra.some((e) => (e.name ?? "").trim() === t)) continue;
    extra = [...extra, { name: t, mode: QUESTION_TYPE_MODES[t as QuestionType] }];
    changed = true;
  }
  if (changed) course.extraQuestionTypes = extra;
  return changed;
}

/** 对全量数据执行课程题型归一化（读时调用，幂等） */
export function normalizeAllCourseExtraTypes(data: AppData): void {
  for (const c of data.courses) {
    normalizeCourseExtraTypes(c, data.questions.filter((q) => q.courseId === c.id));
  }
}
