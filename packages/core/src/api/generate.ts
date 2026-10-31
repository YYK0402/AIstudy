import type { AppData, Question } from "../types/appData";
import { getData, saveData } from "./storage";
import { nextId, now, truncateText } from "./format";
import { QUESTION_DIFFICULTY_LABELS, QUESTION_TYPES, QUESTION_TYPE_LABELS } from "./constants";
import type { QuestionDifficulty, QuestionType } from "./constants";
import { findTaskBinding, callAi } from "./ai";
import { resolvePromptTemplate, renderPrompt } from "./promptTemplates";
import { startBgTask } from "./bgTask";
import { courseTaskId } from "../stores/notify";
import { validateQuestionAnswer } from "../utils/questionValidate";
import { extractJsonCandidates, parseJsonCandidates, unwrapArray } from "../utils/aiJson";

interface AiQuestionItem {
  qType: QuestionType;
  kpIds: number[];
  title: string;
  options: string[];
  answer: string;
  analysis: string;
  difficulty: string;
}

/** 从对象里按别名顺序取第一个非空字符串字段 */
function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim() !== "") return v;
  }
  return null;
}

/**
 * 提取文本中所有括号配平的完整 JSON 对象文本（字符串/转义感知）。
 * 外层对象若包含已提取的内层对象则丢弃外层（保留最内层题目项）。
 * 用于输出被截断时的救援：最后一个不完整的对象会被自然跳过。
 */
function extractCompleteObjects(text: string): string[] {
  const out: string[] = [];
  const startStack: number[] = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      startStack.push(i);
    } else if (ch === "}" && startStack.length > 0) {
      const start = startStack.pop() as number;
      const slice = text.slice(start, i + 1);
      if (!out.some((inner) => inner !== slice && slice.includes(inner))) {
        out.push(slice);
      }
    }
  }
  return out;
}

/** 单条题目归一化：字段别名容错 + 必填校验（title/answer），不合格返回 null */
function normalizeAiQuestionItem(raw: unknown, fallbackQType: QuestionType): AiQuestionItem | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const it = raw as Record<string, unknown>;
  const title = pickString(it, ["title", "question", "题干"]);
  const answer = pickString(it, ["answer", "正确答案", "correctAnswer"]);
  if (title == null || answer == null) return null;
  const qTypeRaw = typeof it.qType === "string" ? it.qType : typeof it.type === "string" ? it.type : "";
  const qType = QUESTION_TYPES.includes(qTypeRaw as QuestionType) ? (qTypeRaw as QuestionType) : fallbackQType;
  const kpRaw = it.kpIds ?? it.kpId;
  let kpIds: number[] = [];
  if (Array.isArray(kpRaw)) {
    kpIds = kpRaw.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0);
  } else if (kpRaw != null) {
    const n = Number(kpRaw);
    if (Number.isFinite(n) && n > 0) kpIds = [n];
  }
  const optionsRaw = it.options ?? it["选项"];
  const options = Array.isArray(optionsRaw) ? optionsRaw.filter((o): o is string => typeof o === "string") : [];
  return {
    qType,
    kpIds,
    title,
    options,
    answer,
    analysis: pickString(it, ["analysis", "解析", "explanation"]) ?? "",
    difficulty: it.difficulty === "easy" || it.difficulty === "hard" ? it.difficulty : "medium",
  };
}

/**
 * 解析 AI 出题响应：
 * 1) 整体 JSON（裸数组 / ```json 块 / {"questions": [...]} 包装）；
 * 2) 整体解析失败（如输出被截断）时救援：提取完整的对象逐条解析，部分成功也算成功。
 */
function parseAiQuestionResponse(content: string, fallbackQType: QuestionType = "single"): AiQuestionItem[] {
  const items: AiQuestionItem[] = [];
  const pushItem = (raw: unknown) => {
    const item = normalizeAiQuestionItem(raw, fallbackQType);
    if (item) items.push(item);
  };

  const arr = unwrapArray(parseJsonCandidates(extractJsonCandidates(content, "array")));
  if (arr) {
    for (const it of arr) pushItem(it);
    return items;
  }

  // 截断救援：扫描完整原文（贪婪数组匹配会误切到 kpIds 等内层数组，不能用于救援）
  const rescueText = content.trim();
  for (const slice of extractCompleteObjects(rescueText)) {
    try {
      pushItem(JSON.parse(slice));
    } catch {
      // 个别对象损坏则跳过
    }
  }
  return items;
}

// 模块级 in-flight 课程集合：同一课程出题进行中时拒绝并发调用（连点「开始出题」/切页后再次触发），
// 防止两份 AI 结果先后落库造成重复题（organizingMaterialIds 同款）
const generatingCourseIds = new Set<number>();

/** 生成题目（批量）。成功落库后返回新题，任何校验/AI 失败时不动题库。 */
export async function generateQuestions(
  courseId: number,
  input: { kpIds: number[]; count: number; qType: QuestionType; difficulty: QuestionDifficulty },
): Promise<Question[]> {
  const data: AppData = await getData();
  const course = data.courses.find((c) => c.id === courseId);
  if (!course) {
    throw new Error("课程不存在");
  }
  if (generatingCourseIds.has(courseId)) {
    throw new Error("AI 出题中，请稍候");
  }
  generatingCourseIds.add(courseId);
  if (input.kpIds.length === 0) {
    throw new Error("请至少选择一个知识点");
  }
  const kps = data.knowledgePoints.filter((k) => input.kpIds.includes(k.id));
  if (kps.length === 0) {
    throw new Error("所选知识点不存在，可能已被删除");
  }
  const binding = findTaskBinding(data, "gen_question", courseId);
  if (!binding) {
    throw new Error(
      "未配置 AI 任务模型，请前往「模型配置 → AI 任务模型分配」设置「gen_question」任务或「全局默认模型」",
    );
  }
  const qTypeLabel = QUESTION_TYPE_LABELS[input.qType];
  const diffLabel = QUESTION_DIFFICULTY_LABELS[input.difficulty];

  // 铃铛：出题是单次长调用，无分段进度（total=0 不显示进度条）
  const qTask = startBgTask({
    taskId: courseTaskId(courseId, "gen_question"),
    taskType: "gen_question",
    label: course.name,
    courseId,
    message: `AI 出题中（${kps.length} 个知识点 → ${input.count} 题）…`,
  });

  // prompt 上限：知识点过多时单次调用上下文过长，直接报错让用户分批（出题支持多选，可分批执行）
  if (kps.length > 100) {
    throw new Error(`一次出题最多选择 100 个知识点（当前 ${kps.length} 个），请分几次出题`);
  }
  const kpLines = kps.map((k) => `- ${k.id}. ${k.name}：${truncateText(k.content, 200) || "暂无描述"}`).join("\n");
  if (kpLines.length > 60000) {
    throw new Error("所选知识点内容总长超出 AI 上下文上限，请减少知识点数量或分批出题");
  }

  const questionVars = {
    qType: input.qType,
    difficulty: input.difficulty,
    courseName: course.name,
    count: String(input.count),
    qTypeLabel,
    diffLabel,
    kpLines,
  };
  try {
    const questionTpl = resolvePromptTemplate(data, "gen_question");
    const baseMessages = [
      { role: "system", content: renderPrompt(questionTpl.system, questionVars) },
      { role: "user", content: renderPrompt(questionTpl.user, questionVars) },
    ];

    // 解析失败自动重试一次：把上次无法解析的原始输出交还给模型自纠正
    let items: AiQuestionItem[] = [];
    let messages = baseMessages;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const res = await callAi({
        providerId: binding.providerId,
        modelId: binding.modelId,
        taskKey: "gen_question",
        scope: "course-" + courseId,
        messages,
      });
      items = parseAiQuestionResponse(res.content, input.qType);
      if (items.length > 0) break;
      if (attempt === 1) {
        messages = [
          ...baseMessages,
          { role: "assistant", content: res.content },
          {
            role: "user",
            content:
              "你上次的输出无法解析为题目 JSON。请重新输出：只返回包含 " +
              input.count +
              " 道题目的 JSON 数组，每项字段为 qType、kpIds、title、options、answer、analysis、difficulty，不要输出任何其他文字。",
          },
        ];
      }
    }
    if (items.length === 0) {
      throw new Error("AI 两次输出格式异常，请重试或更换模型");
    }
    const kpIdSet = new Set(input.kpIds);

    // 答案与选项一致性校验：不合格剔除（不入库），避免产生永远答不对/判分恒错的题
    let answerInvalid = 0;
    const validItems: AiQuestionItem[] = [];
    for (const item of items) {
      const v = validateQuestionAnswer(item.qType, item.options, item.answer);
      if (!v.ok) {
        answerInvalid++;
        console.warn(`[siyuan-ai-study] 剔除答案异常题目：${item.title.slice(0, 40)}…（${v.reason}）`);
        continue;
      }
      // 归一化答案落库（命中选项文本），保证与判分比对一致
      item.answer = v.answer;
      validItems.push(item);
    }
    if (validItems.length === 0) {
      throw new Error(
        answerInvalid > 0
          ? `AI 生成的 ${answerInvalid} 道题答案均与选项不符，已剔除，请重试或更换模型`
          : "AI 输出异常，请重试或更换模型",
      );
    }

    const questions: Question[] = [];
    let nextQuestionId = nextId(data.questions);
    for (const item of validItems) {
      // 模型漏给 kpIds 时回退绑定全部所选知识点，避免产生无归属题
      const bound = item.kpIds.filter((n) => kpIdSet.has(n));
      questions.push({
        id: nextQuestionId++,
        courseId,
        kpIds: (bound.length > 0 ? bound : input.kpIds).join(","),
        title: item.title,
        options: JSON.stringify(item.options),
        answer: item.answer,
        analysis: item.analysis,
        qType: item.qType,
        difficulty: item.difficulty,
        source: "ai",
        paperId: null,
        createTime: now(),
      });
    }
    data.questions.push(...questions);
    await saveData(data);
    const suffix = answerInvalid > 0 ? `，${answerInvalid} 道题答案异常已剔除` : "";
    qTask.done(`已生成 ${questions.length} 道题${suffix}`);
    return questions;
  } catch (e) {
    qTask.fail(e, "AI 出题失败");
    throw e;
  } finally {
    generatingCourseIds.delete(courseId);
  }
}

