import type { AppData, Question, QuestionAsk } from "../types/appData";
import { getData, saveData } from "./storage";
import { nextId, now, parseQuestionKpIds, parseQuestionOptions } from "./format";
import { findTaskBinding, callAi } from "./ai";
import { resolvePromptTemplate, renderPrompt } from "./promptTemplates";
import { QUESTION_TYPE_LABELS } from "./constants";

/** 回看 AI 问答上下文（system 提示词）：课程/题干/选项/答案/解析 + 关联知识点 */
export function buildAskSystem(data: AppData, q: Question): string {
  const courseName = data.courses.find((c) => c.id === q.courseId)?.name ?? "";
  const options = parseQuestionOptions(q);
  const optionsText =
    options.length > 0
      ? options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join("\n")
      : "（无选项：简答/填空/翻译题）";
  const kps = parseQuestionKpIds(q)
    .map((id) => data.knowledgePoints.find((k) => k.id === id))
    .filter((k): k is NonNullable<typeof k> => Boolean(k));
  const kpLines = kps.length
    ? kps.map((k) => `- ${k.name}：${k.content || "（无描述）"}`).join("\n")
    : "（无）";
  const vars = {
    courseName,
    qTypeLabel: QUESTION_TYPE_LABELS[q.qType as keyof typeof QUESTION_TYPE_LABELS] ?? q.qType,
    title: q.title,
    options: optionsText,
    answer: q.answer,
    analysis: q.analysis || "（无）",
    kpLines,
  };
  const tpl = resolvePromptTemplate(data, "quiz_ask");
  return renderPrompt(tpl.system, vars);
}

/** 取（或创建）题目问答会话并追加一轮对话；内存修改，调用方负责 saveData */
export function upsertAskSession(
  data: AppData,
  courseId: number,
  qId: number,
  role: "user" | "assistant",
  content: string,
): QuestionAsk {
  let ask = data.questionAsks.find((a) => a.qId === qId && a.courseId === courseId);
  if (!ask) {
    ask = { id: nextId(data.questionAsks), qId, courseId, turns: [], updateTime: now() };
    data.questionAsks.push(ask);
  }
  ask.turns.push({ role, content, createTime: now() });
  ask.updateTime = now();
  return ask;
}

/** 读回题目问答会话（无会话返回 null） */
export async function queryQuestionAsk(qId: number): Promise<QuestionAsk | null> {
  const data = await getData();
  return data.questionAsks.find((a) => a.qId === qId) ?? null;
}

/**
 * 发送一轮回看问答：追加 user 轮 → callAi（携带最近 10 轮历史）→ 追加 assistant 轮 → 落库。
 * 返回 AI 回复文本；失败时 user 轮已落库（assistant 缺失属合法中间态，重试会自然续上）。
 */
export async function sendQuizAsk(courseId: number, qId: number, userText: string): Promise<string> {
  const data = await getData();
  const q = data.questions.find((x) => x.id === qId && x.courseId === courseId);
  if (!q) throw new Error("题目不存在，可能已被删除");
  const binding = findTaskBinding(data, "quiz_ask", courseId);
  if (!binding) {
    throw new Error(
      "未配置 AI 任务模型，请前往「模型配置 → AI 任务模型分配」设置「回看题目 AI 问答」任务或「全局默认模型」",
    );
  }
  const ask = upsertAskSession(data, courseId, qId, "user", userText);
  const history = ask.turns.slice(0, -1);
  const tpl = resolvePromptTemplate(data, "quiz_ask");
  const vars = { userText };
  const isFirstTurn = history.length === 0;
  const messages: { role: string; content: string }[] = [
    { role: "system", content: buildAskSystem(data, q) },
  ];
  if (isFirstTurn) {
    messages.push({ role: "user", content: renderPrompt(tpl.user, vars) });
  } else {
    for (const t of history.slice(-10)) messages.push({ role: t.role, content: t.content });
    messages.push({ role: "user", content: userText });
  }
  const res = await callAi({
    providerId: binding.providerId,
    modelId: binding.modelId,
    taskKey: "quiz_ask",
    scope: "course-" + courseId,
    messages,
  });
  const content = (res.content || "").trim();
  if (!content) throw new Error("AI 未返回回答，请重试");
  upsertAskSession(data, courseId, qId, "assistant", content);
  await saveData(data);
  return content;
}
