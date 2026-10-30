// API 统一出口：实现按领域拆分在 ./ 下各模块，这里只做 re-export，保持 `from "../api"` 调用方不变
export * from "./constants";
export * from "./format";
export * from "./storage";
export * from "./ai";
export * from "./taskModel";
export * from "./settings";
export * from "./siyuanDoc";
export * from "./graph";
export * from "./report";
export * from "./studyData";
export * from "./review";
export * from "./question";
export * from "./quiz";
export * from "./explain";
export * from "./generate";
export * from "./flashcard";
export * from "./plan";
export * from "./planSchedule";
export * from "./bgTask";
export * from "./extractState";
export * from "./material";
export * from "./kp";
export * from "./kpMatch";
export * from "./extract";
export * from "./course";
export * from "./coursePackage";
export * from "./provider";
export * from "./prompts";
export * from "./siyuanSync";

export type {
  AiProvider,
  AiModel,
  TaskModel,
  CallLog,
  Course,
  Chapter,
  KnowledgePoint,
  Material,
  MaterialChapter,
  Question,
  ExamPaper,
  AnswerRecord,
  WrongQuestion,
  StudyPlan,
  StudyTask,
  ExplainRecord,
  ReviewSchedule,
  FlashCard,
  StudyLog,
  AppData,
  AppSettings,
  Mastery,
  PromptTemplateDef,
} from "../types/appData";
export { PROMPT_TASKS, renderPrompt } from "./promptTemplates";
export type { PromptTaskMeta, PromptVarInfo } from "./promptTemplates";
