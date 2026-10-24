import type { Material } from "../types/appData";

export const QUESTION_TYPES = ["single", "multiple", "judge", "essay"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  single: "单选",
  multiple: "多选",
  judge: "判断",
  essay: "简答",
};

export const QUESTION_DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type QuestionDifficulty = (typeof QUESTION_DIFFICULTIES)[number];

export const QUESTION_DIFFICULTY_LABELS: Record<QuestionDifficulty, string> = {
  easy: "简单",
  medium: "中等",
  hard: "困难",
};

export const QUESTION_SOURCE_LABELS: Record<string, string> = {
  ai: "AI 生成",
  import: "导入",
};

export function questionSourceLabel(source: string): string {
  return QUESTION_SOURCE_LABELS[source] ?? source;
}

export const WRONG_ERROR_TYPES = ["concept", "memory", "careless"] as const;
export type WrongErrorType = (typeof WRONG_ERROR_TYPES)[number];

export const WRONG_ERROR_TYPE_LABELS: Record<WrongErrorType, string> = {
  concept: "概念不清",
  memory: "记忆遗漏",
  careless: "粗心",
};

/** 讲解达标（≥60 分）→ 知识点进入复习池。 */
export const EXPLAIN_PASS_SCORE = 60;
/** 讲解评估升级掌握度的分数门槛（高于进复习池的 EXPLAIN_PASS_SCORE）。 */
export const EXPLAIN_MASTER_SCORE = 80;

export const AI_TASKS = [
  { key: "extract_kp", name: "文档知识点抽取" },
  { key: "gen_plan", name: "AI 学习计划生成" },
  { key: "gen_question", name: "AI 习题生成" },
  { key: "eval_explain", name: "讲解内容评估" },
  { key: "grade_answer", name: "简答题 AI 阅卷" },
  { key: "gen_report", name: "学习报告生成" },
  { key: "infer_graph", name: "图谱关联关系推理" },
  { key: "recognize_toc", name: "目录识别矫正" },
  { key: "organize_doc", name: "文档结构梳理" },
  { key: "gen_flashcard", name: "AI 闪卡生成" },
  { key: "gen_ask", name: "费曼提问生成" },
] as const;

export const GLOBAL_DEFAULT_KEY = "global_default";

export const MATERIAL_SOURCE_LABELS: Record<string, string> = {
  upload: "上传",
  paste: "粘贴",
  siyuan: "思源",
};

export function materialSourceLabel(m: Material): string {
  const source = m.source ?? (m.assetPath ? "upload" : "paste");
  return MATERIAL_SOURCE_LABELS[source] ?? source;
}
