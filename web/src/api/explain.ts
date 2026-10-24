import type { AppData, ExplainRecord, KnowledgePoint } from "../types/appData";
import { getData, saveData } from "./storage";
import { nextId, now } from "./format";
import { EXPLAIN_MASTER_SCORE, EXPLAIN_PASS_SCORE } from "./constants";
import { findTaskBinding } from "./ai";
import { ensureReviewTouchpointInData } from "./review";
import { appendWeakPointTaskInData, completeKpTasksInData, logStudyInData } from "./studyData";
import { resolvePromptTemplate, renderPrompt } from "./promptTemplates";
import { adjustMasteryInData, kpHasOpenWrong } from "./quiz";

export interface ExplainResult {
  score: number;
  feedback: string;
  /** 掌握度升级说明（分数 ≥80 且该知识点无未移出错题时非空） */
  masteryNotes: string[];
  /** 达标自动勾掉的任务标题（严格打勾） */
  planNotes: string[];
}

/** 讲解达标（≥60 分）→ 知识点进入复习池。 */
function parseAiExplainResponse(content: string): { score: number; feedback: string } | null {
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

/** 提交一次讲解，AI 按「正确性 / 覆盖度 / 清晰度」评估并落 ExplainRecord。 */
export async function submitExplain(kp: KnowledgePoint, userContent: string, durationSec = 0): Promise<ExplainResult> {
  const data = await getData();
  const binding = findTaskBinding(data, "eval_explain", kp.courseId);
  if (!binding) {
    throw new Error(
      "未配置 AI 任务模型，请前往「模型配置 → AI 任务模型分配」设置「eval_explain」任务或「全局默认模型」",
    );
  }

  const explainVars = {
    kpName: kp.name,
    kpContent: kp.content || "（无描述，请按知识点名称判断）",
    userContent,
  };
  const explainTpl = resolvePromptTemplate(data, "eval_explain");
  const res = await window.siyuanAiStudy.callAi({
    providerId: binding.providerId,
    modelId: binding.modelId,
    taskKey: "eval_explain",
    messages: [
      { role: "system", content: renderPrompt(explainTpl.system, explainVars) },
      { role: "user", content: renderPrompt(explainTpl.user, explainVars) },
    ],
  });

  const result = parseAiExplainResponse(res.content);
  if (!result) {
    throw new Error("AI 评估结果无法解析，请重试");
  }

  const courseKp = data.knowledgePoints.find((k) => k.id === kp.id);
  if (!courseKp) {
    throw new Error("知识点不存在，可能已被删除");
  }

  const record: ExplainRecord = {
    id: nextId(data.explainRecords),
    courseId: courseKp.courseId,
    kpId: courseKp.id,
    userContent,
    aiFeedback: result.feedback,
    aiScore: String(result.score),
    createTime: now(),
    askPrompt: kp.askPrompt || "",
  };
  data.explainRecords.push(record);
  const masteryNotes: string[] = [];
  const planNotes: string[] = [];
  if (result.score >= EXPLAIN_PASS_SCORE) {
    ensureReviewTouchpointInData(data, courseKp.id);
    // 达标 → 勾掉当天 learn/review 任务
    planNotes.push(...completeKpTasksInData(data, courseKp.id, ["learn", "review"]));
  }
  // 讲解 ≥80 且该知识点无未移出当前错题本记录 → 掌握度升一级
  if (result.score >= EXPLAIN_MASTER_SCORE && !kpHasOpenWrong(data, courseKp.id)) {
    const change = adjustMasteryInData(data, courseKp.id, 1);
    if (change) masteryNotes.push(`${courseKp.name} ${change}`);
  }
  // 讲解不达标（<60）→ 追加薄弱复习任务
  if (result.score < EXPLAIN_PASS_SCORE) {
    appendWeakPointTaskInData(data, courseKp.courseId, courseKp.id, "review");
  }
  logStudyInData(data, {
    courseId: courseKp.courseId,
    kpId: courseKp.id,
    taskId: null,
    action: "explain",
    durationSec,
  });
  await saveData(data);
  return { ...result, masteryNotes, planNotes };
}

// ===== 费曼提问（AI 按知识点内容生成，带缓存） =====
/** 缓存快照：名称|内容；任一变化即视为过期 */
function askPromptSignature(kp: KnowledgePoint): string {
  return `${kp.name}|${kp.content}`;
}

/** 缓存的提问是否仍有效（未生成或快照不匹配均视为过期） */
export function isAskPromptFresh(kp: KnowledgePoint): boolean {
  return Boolean(kp.askPrompt && kp.askPromptContent === askPromptSignature(kp));
}

/** 从 AI 输出中提取一行有效提问（剥离思考块、代码围栏、引号、多余说明行） */
function extractAskPrompt(raw: string): string {
  let text = (raw || "").trim();
  if (!text) return "";
  // 思考型模型（如 MiniMax）会在正式输出前附带思考块，取最后一个结束标记之后的内容
  const thinkParts = text.split("</think>\n");
  if (thinkParts.length > 1) text = thinkParts[thinkParts.length - 1].trim();
  const fence = text.match(/```[\w-]*\s*\n?([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  text = text.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();
  const line = text.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
  return line && line.length >= 4 && line.length <= 200 ? line : "";
}

/**
 * 生成（或取缓存）知识点的费曼提问。
 * 缓存按「名称|内容」快照判过期；force=true 强制重掷。
 * 失败抛错，由调用方回退固定提问。
 */
export async function generateKpAskPrompt(kp: KnowledgePoint, force = false): Promise<string> {
  const data = await getData();
  const stored = data.knowledgePoints.find((k) => k.id === kp.id);
  if (!stored) throw new Error("知识点不存在，可能已被删除");
  if (!force && isAskPromptFresh(stored)) {
    return stored.askPrompt as string;
  }
  const binding = findTaskBinding(data, "gen_ask", stored.courseId);
  if (!binding) {
    throw new Error(
      "未配置 AI 任务模型，请前往「模型配置 → AI 任务模型分配」设置「gen_ask」任务或「全局默认模型」",
    );
  }
  const courseName = data.courses.find((c) => c.id === stored.courseId)?.name ?? "";
  const askVars = {
    courseName,
    kpName: stored.name,
    kpContent: stored.content || "（无描述，请按知识点名称判断）",
  };
  const askTpl = resolvePromptTemplate(data, "gen_ask");
  const res = await window.siyuanAiStudy.callAi({
    providerId: binding.providerId,
    modelId: binding.modelId,
    taskKey: "gen_ask",
    messages: [
      { role: "system", content: renderPrompt(askTpl.system, askVars) },
      { role: "user", content: renderPrompt(askTpl.user, askVars) },
    ],
  });
  const prompt = extractAskPrompt(res.content);
  if (!prompt) throw new Error("AI 未返回有效提问，请重试");
  stored.askPrompt = prompt;
  stored.askPromptContent = askPromptSignature(stored);
  await saveData(data);
  return prompt;
}

export async function queryExplainRecords(kpId: number): Promise<ExplainRecord[]> {
  const data = await getData();
  return data.explainRecords
    .filter((r) => r.kpId === kpId)
    .sort((a, b) => b.id - a.id);
}

export interface ExplainSummary {
  kpId: number;
  kpName: string;
  rounds: number;
  lastScore: string;
  lastTime: string;
}

/** 课程维度讲解会话汇总（按知识点分组，最近时间倒序；「过往学习会话」卡片用） */
export async function queryExplainSummaries(courseId: number): Promise<ExplainSummary[]> {
  const data = await getData();
  const nameById = new Map(data.knowledgePoints.map((k) => [k.id, k.name]));
  const byKp = new Map<number, ExplainRecord[]>();
  for (const r of data.explainRecords) {
    if (r.courseId !== courseId) continue;
    const list = byKp.get(r.kpId) ?? [];
    list.push(r);
    byKp.set(r.kpId, list);
  }
  const out: ExplainSummary[] = [];
  for (const [kpId, list] of byKp) {
    list.sort((a, b) => a.id - b.id);
    const last = list[list.length - 1];
    out.push({
      kpId,
      kpName: nameById.get(kpId) ?? `#${kpId}`,
      rounds: list.length,
      lastScore: last.aiScore,
      lastTime: last.createTime,
    });
  }
  out.sort((a, b) => b.lastTime.localeCompare(a.lastTime));
  return out;
}

