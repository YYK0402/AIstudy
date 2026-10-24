import type { AnswerRecord, AppData, KnowledgePoint, Mastery, Question, WrongQuestion } from "../types/appData";
import { getData, saveData } from "./storage";
import { formatLocalDate, nextId, now, parseQuestionKpIds, parseQuestionOptions } from "./format";
import { EXPLAIN_MASTER_SCORE, QUESTION_DIFFICULTY_LABELS, QUESTION_TYPE_LABELS, WRONG_ERROR_TYPE_LABELS } from "./constants";
import type { QuestionDifficulty, QuestionType, WrongErrorType } from "./constants";
import { findTaskBinding } from "./ai";
import { ensureQuestionReviewInData } from "./review";
import { appendWeakPointTaskInData, completeKpTasksInData, logStudyInData } from "./studyData";
import { recordWrongResult } from "../utils/wrongStreak";
import { masteryChangeText, nextMastery } from "../utils/mastery";
import { resolvePromptTemplate, renderPrompt } from "./promptTemplates";

export interface AnswerResult {
  isCorrect: boolean;
  score: string;
  /** 简答题 AI 给出的逐条反馈，仅 essay 题非空 */
  feedback: string;
  /** 关联知识点掌握度降级说明（答错且实际变动时非空） */
  masteryNotes: string[];
  /** 答对自动勾掉的任务标题（严格打勾） */
  planNotes: string[];
}

// 掌握度阶梯与文案统一在 utils/mastery

/** 讲解评估升级掌握度的分数门槛（高于进复习池的 EXPLAIN_PASS_SCORE） */
/** 按阶梯升降一档（钳制在两端），返回「前 → 后」说明或 null（未变动/不存在） */
export function adjustMasteryInData(data: AppData, kpId: number, delta: number): string | null {
  const kp = data.knowledgePoints.find((k) => k.id === kpId);
  if (!kp) return null;
  const from = kp.mastery;
  const next = nextMastery(from, delta);
  if (!next) return null;
  kp.mastery = next;
  return masteryChangeText(from, next);
}

/** 知识点在当前错题本是否仍有未移出的在管错题（已毕业不计；经题目 kpIds 关联） */
export function kpHasOpenWrong(data: AppData, kpId: number): boolean {
  const qMap = new Map(data.questions.map((q) => [q.id, q]));
  return data.wrongQuestions.some((w) => {
    if ((w.status ?? "active") === "graduated") return false;
    const q = qMap.get(w.qId);
    return !!q && parseQuestionKpIds(q).includes(kpId);
  });
}

function parseAiGradeResponse(content: string): { score: number; feedback: string } | null {
  const trimmed = content.trim();
  const jsonMatch =
    trimmed.match(/```(?:json)?\s*([\s\S]*?)```/) ||
    trimmed.match(/(\{[\s\S]*\})/);
  const candidate = (jsonMatch ? jsonMatch[1] : trimmed).trim();
  try {
    const parsed = JSON.parse(candidate);
    if (parsed && typeof parsed.score === "number" && Number.isFinite(parsed.score)) {
      return {
        score: Math.max(0, Math.min(100, Math.round(parsed.score))),
        feedback: typeof parsed.feedback === "string" ? parsed.feedback : "",
      };
    }
  } catch {
    // ignore
  }
  return null;
}

/** 提交一次作答。客观题本地判分，简答题调用 grade_answer AI 阅卷。fromReview=true 时答对不计入错题毕业连对（由复习评分统一计） */
export async function submitAnswer(
  question: Question,
  userAnswer: string,
  durationSec = 0,
  options?: { fromReview?: boolean },
): Promise<AnswerResult> {
  const data = await getData();
  let isCorrect: boolean;
  let score: string;
  let feedback = "";

  if (question.qType === "essay") {
    const binding = findTaskBinding(data, "grade_answer", question.courseId);
    if (!binding) {
      throw new Error(
        "未配置 AI 任务模型，请前往「模型配置 → AI 任务模型分配」设置「grade_answer」任务或「全局默认模型」",
      );
    }
    const gradeVars = {
      title: question.title,
      answer: question.answer,
      userAnswer: userAnswer || "（未作答）",
    };
    const gradeTpl = resolvePromptTemplate(data, "grade_answer");
    const res = await window.siyuanAiStudy.callAi({
      providerId: binding.providerId,
      modelId: binding.modelId,
      taskKey: "grade_answer",
      messages: [
        { role: "system", content: renderPrompt(gradeTpl.system, gradeVars) },
        { role: "user", content: renderPrompt(gradeTpl.user, gradeVars) },
      ],
    });
    const graded = parseAiGradeResponse(res.content);
    if (!graded) {
      throw new Error("AI 阅卷结果无法解析，请重试");
    }
    isCorrect = graded.score >= 60;
    score = String(graded.score);
    feedback = graded.feedback;
  } else {
    isCorrect = normalizeAnswer(userAnswer) === normalizeAnswer(question.answer);
    score = isCorrect ? "100" : "0";
  }

  const record: AnswerRecord = {
    id: nextId(data.answerRecords),
    qId: question.id,
    userAnswer,
    isCorrect,
    score,
    createTime: now(),
  };
  data.answerRecords.push(record);

  const masteryNotes: string[] = [];
  const planNotes: string[] = [];
  if (!isCorrect) {
    // 答错 → 归入错题本（已有记录含已毕业的重新激活）
    recordWrongResult(data.wrongQuestions, question.id, "wrong", now());
    // 答错 → 题目进入复习池（已有触点则重置为明日到期）
    ensureQuestionReviewInData(data, question.id);
    // 答错 → 关联知识点掌握度各降一级 + 追加薄弱练习任务
    for (const kpId of parseQuestionKpIds(question)) {
      const change = adjustMasteryInData(data, kpId, -1);
      if (change) {
        const kp = data.knowledgePoints.find((k) => k.id === kpId);
        if (kp) masteryNotes.push(`${kp.name} ${change}`);
      }
      appendWeakPointTaskInData(data, question.courseId, kpId, "practice");
    }
  } else {
    // 答对 → 勾掉关联知识点当天 practice 任务（含薄弱练习）
    for (const kpId of parseQuestionKpIds(question)) {
      planNotes.push(...completeKpTasksInData(data, kpId, ["practice"]));
    }
    // 答对 → 错题连对 +1（复习中提交不在此计，由 submitReview 按自评分统一计）
    if (!options?.fromReview) recordWrongResult(data.wrongQuestions, question.id, "correct", now());
  }

  logStudyInData(data, {
    courseId: question.courseId,
    kpId: parseQuestionKpIds(question)[0] ?? null,
    taskId: null,
    action: "answer",
    durationSec,
  });
  await saveData(data);
  return { isCorrect, score, feedback, masteryNotes, planNotes };
}

// 归一化作答：中文逗号统一为半角再按逗号拆分排序（AI 生成的多选答案可能用「，」分隔）
function normalizeAnswer(s: string): string {
  return s.trim().replace(/，/g, ",").split(/\s*,\s*/).map((p) => p.trim()).sort((a, b) => a.localeCompare(b)).join(",");
}

export async function queryWrongQuestions(
  courseId: number,
  options?: { includeGraduated?: boolean },
): Promise<Array<{ wrong: WrongQuestion; question: Question }>> {
  const data = await getData();
  const qMap = new Map(data.questions.filter((q) => q.courseId === courseId).map((q) => [q.id, q]));
  return data.wrongQuestions
    .filter((w) => qMap.has(w.qId))
    .filter((w) => options?.includeGraduated || (w.status ?? "active") === "active")
    .sort((a, b) => b.id - a.id)
    .map((w) => ({ wrong: w, question: qMap.get(w.qId)! }));
}

/** 本课程已毕业（已掌握）的错题数（题目属于该课程） */
export async function countGraduatedWrongQuestions(courseId: number): Promise<number> {
  const data = await getData();
  const qMap = new Map(data.questions.filter((q) => q.courseId === courseId).map((q) => [q.id, q]));
  return data.wrongQuestions.filter((w) => (w.status ?? "active") === "graduated" && qMap.has(w.qId)).length;
}

export async function deleteWrongQuestion(id: number): Promise<void> {
  const data = await getData();
  data.wrongQuestions = data.wrongQuestions.filter((w) => w.id !== id);
  await saveData(data);
}

/** 导出错题集 Markdown（含题干/我的答案/正确答案/解析/知识点/错误类型/答错次数） */
export async function exportWrongQuestionsMarkdown(
  items: Array<{ wrong: WrongQuestion; question: Question }>,
  knowledgePoints: KnowledgePoint[],
  courseName: string,
): Promise<string> {
  const data = await getData();
  // 每题取最近一次作答作为「我的答案」
  const lastAnswer = new Map<number, string>();
  for (const r of data.answerRecords) lastAnswer.set(r.qId, r.userAnswer);
  const kpMap = new Map(knowledgePoints.map((k) => [k.id, k.name]));
  const lines: string[] = [
    `# 错题导出 - ${courseName}`,
    `> 共 ${items.length} 题 · 导出时间 ${new Date().toLocaleString("zh-CN", { hour12: false })}`,
    "",
  ];
  items.forEach(({ wrong, question }, i) => {
    lines.push(`---`, `${i + 1}. ${question.title.replace(/\n/g, " ")}`);
    parseQuestionOptions(question).forEach((opt, j) => {
      lines.push(`${String.fromCharCode(65 + j)}. ${opt}`);
    });
    lines.push(`我的答案: ${lastAnswer.get(question.id) ?? "（无作答记录）"}`);
    lines.push(`正确答案: ${question.answer}`);
    if (question.analysis) lines.push(`解析: ${question.analysis}`);
    lines.push(`题型: ${QUESTION_TYPE_LABELS[question.qType as QuestionType]}`);
    lines.push(`难度: ${QUESTION_DIFFICULTY_LABELS[question.difficulty as QuestionDifficulty]}`);
    const kpNames = parseQuestionKpIds(question).map((id) => kpMap.get(id)).filter(Boolean);
    if (kpNames.length) lines.push(`知识点: ${kpNames.join(", ")}`);
    lines.push(`错误类型: ${WRONG_ERROR_TYPE_LABELS[wrong.errorType as WrongErrorType] ?? "未标记"}`);
    lines.push(`答错次数: ${wrong.reviewTimes}`, "");
  });
  return lines.join("\n");
}

export async function markWrongErrorType(id: number, errorType: WrongErrorType | null): Promise<void> {
  const data = await getData();
  const w = data.wrongQuestions.find((x) => x.id === id);
  if (!w) throw new Error("错题不存在");
  if (errorType) w.errorType = errorType;
  else delete w.errorType;
  await saveData(data);
}

// ===== 讲解评估（冯诺依曼学习法） =====
