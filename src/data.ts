// 插件数据模型（持久化为 JSON，经 loadData/saveData 存储）
// 说明：思源 /api/query/sql 为只读接口，无法建表/写数据，故放弃 PRD 的 SQLite 表方案，
//       改用思源官方插件存储机制 loadData/saveData（JSON 文件）。

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
  /** 采样温度 0-2；旧数据无此字段，null/缺失 = 不传给服务商 */
  temperature?: number | null;
  /** 最大输出 token；旧数据无此字段，null/缺失 = 不传给服务商 */
  maxTokens?: number | null;
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
  /** 落库思源后的课程顶层文档 id；未开启持久化或落库失败时为 null */
  siyuanDocId: string | null;
  name: string;
  description: string;
  target: string;
  totalCycle: string;
  status: string;
  createTime: string;
  /** 本课程指定模型（AiModel 行 id）；null/缺失 = 跟随任务分配（任务级 → 全局默认） */
  modelId?: number | null;
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

export type Mastery = "unlearn" | "known" | "mastered" | "proficient";

export interface KnowledgePoint {
  id: number;
  courseId: number;
  chapterId: number | null;
  /** 绑定的思源文档/块 id（openFileById 均可打开） */
  blockId: string | null;
  /** 绑定文档/块的展示名 */
  blockName?: string;
  name: string;
  content: string;
  mastery: Mastery;
  sourceAssetIds: string;
  prevKpIds: string;
  /** 自定义标签（用于筛选出题等），旧数据可能缺失 */
  tags?: string[];
  /** 抽取时所属的章节标题（用于章节后建时重新绑定） */
  chapterName: string;
  sort: number;
  createTime: string;
  /** AI 生成的费曼提问（缓存；名称/内容变化后自动失效重新生成） */
  askPrompt?: string;
  /** askPrompt 生成时的「名称|内容」快照，用于判断缓存是否过期 */
  askPromptContent?: string;
}

export interface Material {
  id: number;
  courseId: number;
  name: string;
  assetPath: string;
  fileType: string;
  contentText: string;
  /** 解析出的标题结构（JSON 字符串，ParsedHeading[]），用于自动识别目录 */
  headings: string;
  /** 落库思源后的文档 id（未开启持久化或未落库时为 null） */
  siyuanDocId: string | null;
  status: string;
  createTime: string;
  /** 来源：upload 上传文件 / paste 粘贴文本 / siyuan 思源绑定；缺省按 assetPath 推断（兼容旧数据） */
  source?: string;
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
  /** 错误类型标记：concept 概念不清 / memory 记忆遗漏 / careless 粗心；缺省=未标记 */
  errorType?: string;
  /** active=在管 / graduated=已掌握毕业（旧数据缺失按 active 处理） */
  status?: "active" | "graduated";
  /** 连续答对/牢固次数（毕业用）；旧数据缺失按 0 处理 */
  correctStreak?: number;
  /** 毕业时间；未毕业/旧数据为 null 或缺失 */
  graduatedAt?: string | null;
}

export interface StudyPlan {
  id: number;
  courseId: number;
  planContent: string;
  /** 旧数据无此字段，按 active 处理 */
  status?: "active" | "paused";
  /** 计划开始日期（YYYY-MM-DD）；旧数据无此字段，按首个任务日/今天处理 */
  startDate?: string;
  targetDate: string;
  dailyHour: string;
  createTime: string;
}

export interface StudyTask {
  id: number;
  planId: number;
  chapterId: number | null;
  /** 薄弱点追加任务关联的知识点 id；AI 生成的计划任务为 null（旧数据缺失时按 null 处理） */
  kpId: number | null;
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
  /** 该轮实际使用的提问文本（当时的 AI 提问；旧记录可能缺失） */
  askPrompt?: string;
}

export interface ReviewSchedule {
  id: number;
  kpId: number | null;
  qId: number | null;
  /** 闪卡触点（T3.4）；旧数据无此字段 */
  cardId?: number | null;
  stage: number;
  dueTime: string;
  easeFactor: number;
  intervalDays: number;
  lastReviewTime: string | null;
  reviewTimes: number;
}

/** 闪卡（T3.4）：正面问题 / 背面答案要点，每知识点 1 张 */
export interface FlashCard {
  id: number;
  courseId: number;
  kpId: number;
  /** 正面：问题 */
  front: string;
  /** 背面：答案要点 */
  back: string;
  source: "ai" | "manual";
  createTime: string;
  updateTime?: string;
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

/** 提示词模板：system 系统提示 + user 用户提示模板（{{var}} 占位符由调用点渲染） */
export interface PromptTemplateDef {
  system: string;
  user: string;
}

export interface AppSettings {
  /** 章节识别方式：manual 手动 / auto 上传后按标题自动建目录 */
  chapterMode: "manual" | "auto";
  /** 是否将资料/章节/知识点持久化到思源笔记 */
  persistToSiyuan: boolean;
  /** 思源笔记本名称 */
  notebookName: string;
  /** AI 调用失败自动重试次数（0/1/2，旧数据缺失按 0；仅对超时/5xx/网络错误生效） */
  aiRetryCount?: number;
  /** AI 请求速率限制（次/分钟，0=不限，旧数据缺失按 0）；超限排队等待窗口释放 */
  aiRateLimitPerMin?: number;
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
  flashCards: FlashCard[];
  studyLogs: StudyLog[];
  settings: AppSettings;
  /** 自定义提示词模板（taskKey → 模板）；未覆盖的任务用内置默认模板 */
  promptTemplates?: Record<string, PromptTemplateDef>;
  /** API Key 加密材料的随机密钥（hex，32 字节）；缺失时首次写入自动生成 */
  cryptoKeyMaterial?: string;
  /**
   * 学习对话落库文档（每章/节一个）：key = 章/节节点 id 的字符串，未挂载 KP 的兜底文档为 `course-${courseId}`；
   * value.docId = 思源文档 id，value.lastMarkdown = 最近一次写入的完整 markdown（内核内存读不到时的兜底）
   */
  conversationsDocs?: Record<string, { docId: string; lastMarkdown?: string }>;
}

export function createEmptyData(): AppData {
  return {
    providers: [],
    models: [],
    taskModels: [],
    logs: [],
    courses: [],
    chapters: [],
    knowledgePoints: [],
    materials: [],
    materialChapters: [],
    questions: [],
    answerRecords: [],
    wrongQuestions: [],
    studyPlans: [],
    studyTasks: [],
    explainRecords: [],
    reviewSchedules: [],
    flashCards: [],
    studyLogs: [],
    settings: {
      chapterMode: "manual",
      persistToSiyuan: false,
      notebookName: "AI 研习",
    },
  };
}
