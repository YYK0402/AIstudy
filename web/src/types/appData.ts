// 所有数据类型定义（与主窗口 src/data.ts 保持一致）

export type Mastery = "unlearn" | "known" | "mastered" | "proficient";

export interface AiProvider {
  id: number;
  name: string;
  baseUrl: string;
  apiKey: string;
  timeout: number;
  enabled: boolean;
  createTime: string;
}
export interface AiModel {
  id: number;
  providerId: number;
  modelId: string;
  displayName: string;
  maxContext: number | null;
}
export interface TaskModel {
  taskKey: string;
  modelId: number | null;
  isGlobalDefault: boolean;
}
export interface CallLog {
  id: number;
  taskKey: string;
  providerName: string;
  modelName: string;
  tokenIn: number;
  tokenOut: number;
  status: string;
  errorMsg: string;
  createTime: string;
}
export interface Course {
  id: number;
  siyuanDocId: string;
  name: string;
  description: string;
  target: string;
  totalCycle: string;
  status: string;
  createTime: string;
}
export interface Chapter {
  id: number;
  courseId: number;
  parentId: number | null;
  siyuanBlockId: string | null;
  name: string;
  level: "chapter" | "unit";
  sort: number;
}
export interface KnowledgePoint {
  id: number;
  courseId: number;
  chapterId: number | null;
  blockId: string | null;
  name: string;
  content: string;
  mastery: Mastery;
  sourceAssetIds: string;
  prevKpIds: string;
  sort: number;
  createTime: string;
}
export interface Material {
  id: number;
  courseId: number;
  name: string;
  assetPath: string;
  fileType: string;
  contentText: string;
  status: string;
  createTime: string;
}
export interface MaterialChapter {
  id: number;
  materialId: number;
  chapterId: number;
}
export interface Question {
  id: number;
  courseId: number;
  kpIds: string;
  title: string;
  options: string;
  answer: string;
  analysis: string;
  qType: string;
  difficulty: string;
  source: string;
  createTime: string;
}
export interface AnswerRecord {
  id: number;
  qId: number;
  userAnswer: string;
  isCorrect: boolean;
  score: string;
  createTime: string;
}
export interface WrongQuestion {
  id: number;
  recordId: number | null;
  qId: number;
  reviewTimes: number;
  createTime: string;
}
export interface StudyPlan {
  id: number;
  courseId: number;
  planContent: string;
  targetDate: string;
  dailyHour: string;
  createTime: string;
}
export interface StudyTask {
  id: number;
  planId: number;
  chapterId: number | null;
  taskType: string;
  title: string;
  scheduledDate: string;
  status: string;
  sort: number;
}
export interface ExplainRecord {
  id: number;
  courseId: number;
  kpId: number;
  userContent: string;
  aiFeedback: string;
  aiScore: string;
  createTime: string;
}
export interface ReviewSchedule {
  id: number;
  kpId: number | null;
  qId: number | null;
  stage: number;
  dueTime: string;
  easeFactor: number;
  intervalDays: number;
  lastReviewTime: string | null;
  reviewTimes: number;
}
export interface StudyLog {
  id: number;
  courseId: number;
  kpId: number | null;
  taskId: number | null;
  action: string;
  duration: number;
  createTime: string;
}
export interface AppData {
  providers: AiProvider[];
  models: AiModel[];
  taskModels: TaskModel[];
  logs: CallLog[];
  courses: Course[];
  chapters: Chapter[];
  knowledgePoints: KnowledgePoint[];
  materials: Material[];
  materialChapters: MaterialChapter[];
  questions: Question[];
  answerRecords: AnswerRecord[];
  wrongQuestions: WrongQuestion[];
  studyPlans: StudyPlan[];
  studyTasks: StudyTask[];
  explainRecords: ExplainRecord[];
  reviewSchedules: ReviewSchedule[];
  studyLogs: StudyLog[];
}
