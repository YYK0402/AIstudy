import type { AppData, FlashCard, KnowledgePoint } from "../types/appData";
import { getData, saveData } from "./storage";
import { formatLocalDate, nextId, now, truncateText } from "./format";
import { findTaskBinding, callAi, AiCanceledError } from "./ai";
import { resolvePromptTemplate, renderPrompt } from "./promptTemplates";
import { startBgTask } from "./bgTask";
import { courseTaskId } from "../stores/notify";
import { parseFlashcardsJson } from "../utils/flashcardGen";
import { nextSm2 } from "../utils/sm2";
import { reviewNextDue } from "./review";
import { isReviewScheduleDue } from "../utils/reviewDue";

export async function queryFlashCards(courseId: number): Promise<FlashCard[]> {
  const data = await getData();
  return data.flashCards.filter((c) => c.courseId === courseId);
}

/** 当前课程今日到期的闪卡触点数（侧栏角标用） */
export async function queryDueFlashcardCount(courseId: number): Promise<number> {
  const data = await getData();
  const today = formatLocalDate();
  const cardIds = new Set(data.flashCards.filter((c) => c.courseId === courseId).map((c) => c.id));
  if (cardIds.size === 0) return 0;
  return data.reviewSchedules.filter((s) => isReviewScheduleDue(s, today, new Set(), new Set(), cardIds)).length;
}

/** 闪卡触点：首建排明天；已到期触点按 SM-2 正常推进，未到期保持原排期不动 */
export function ensureCardReviewInData(data: AppData, cardId: number): void {
  const existing = data.reviewSchedules.find((s) => s.cardId !== undefined && s.cardId === cardId);
  if (existing) {
    const today = formatLocalDate();
    if (existing.dueTime > today) return; // 未到期：保持原排期不动（不重置 stage、不缩短间隔）
    const next = nextSm2(existing, 5);
    existing.stage = next.stage;
    existing.intervalDays = next.intervalDays;
    existing.easeFactor = next.easeFactor;
    existing.dueTime = reviewNextDue(next.intervalDays);
    return;
  }
  data.reviewSchedules.push({
    id: nextId(data.reviewSchedules),
    kpId: null,
    qId: null,
    cardId,
    stage: 1,
    dueTime: reviewNextDue(1),
    easeFactor: 2.5,
    intervalDays: 1,
    lastReviewTime: null,
    reviewTimes: 0,
  });
}

export async function createFlashCard(input: {
  courseId: number;
  kpId: number;
  front: string;
  back: string;
}): Promise<FlashCard> {
  const data = await getData();
  const kp = data.knowledgePoints.find((k) => k.id === input.kpId && k.courseId === input.courseId);
  if (!kp) throw new Error("知识点不存在或不属于本课程");
  const front = input.front.trim();
  const back = input.back.trim();
  if (!front) throw new Error("卡片正面（问题）不能为空");
  if (!back) throw new Error("卡片背面（答案要点）不能为空");
  const card: FlashCard = {
    id: nextId(data.flashCards),
    courseId: input.courseId,
    kpId: input.kpId,
    front,
    back,
    source: "manual",
    createTime: now(),
  };
  data.flashCards.push(card);
  ensureCardReviewInData(data, card.id);
  await saveData(data);
  return card;
}

export async function updateFlashCard(
  id: number,
  input: { kpId?: number; front?: string; back?: string },
): Promise<FlashCard> {
  const data = await getData();
  const card = data.flashCards.find((c) => c.id === id);
  if (!card) throw new Error("闪卡不存在，可能已被删除");
  if (input.kpId !== undefined && input.kpId !== card.kpId) {
    const kp = data.knowledgePoints.find((k) => k.id === input.kpId && k.courseId === card.courseId);
    if (!kp) throw new Error("知识点不存在或不属于本课程");
    card.kpId = input.kpId;
  }
  if (input.front !== undefined) {
    const front = input.front.trim();
    if (!front) throw new Error("卡片正面（问题）不能为空");
    card.front = front;
  }
  if (input.back !== undefined) {
    const back = input.back.trim();
    if (!back) throw new Error("卡片背面（答案要点）不能为空");
    card.back = back;
  }
  card.updateTime = now();
  await saveData(data);
  return card;
}

/** 批量删除闪卡（级联清理其复习触点） */
export async function deleteFlashCards(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const data = await getData();
  const removed = new Set(ids);
  const before = data.flashCards.length;
  data.flashCards = data.flashCards.filter((c) => !removed.has(c.id));
  data.reviewSchedules = data.reviewSchedules.filter((s) => s.cardId == null || !removed.has(s.cardId));
  await saveData(data);
  return before - data.flashCards.length;
}

export interface GenerateFlashcardsResult {
  created: number;
  updated: number;
  /** 已有卡片且未勾选覆盖 */
  skipped: number;
  /** AI 输出中因字段问题被剔除的条目 */
  parseSkipped: number;
  errors: string[];
}

const FLASHCARD_GEN_BATCH = 10;

/**
 * AI 批量生成闪卡：选中知识点每批 10 个调 gen_flashcard 任务，解析结果落库；
 * 解析失败自动重试一次（把原始输出交还模型自纠正，与 gen_question 一致）。
 */
export async function generateFlashcards(
  courseId: number,
  kpIds: number[],
  options: { overwrite?: boolean; isAborted?: () => boolean; onProgress?: (done: number, total: number) => void } = {},
): Promise<GenerateFlashcardsResult> {
  const data = await getData();
  const course = data.courses.find((c) => c.id === courseId);
  if (!course) throw new Error("课程不存在");
  if (kpIds.length === 0) throw new Error("请至少选择一个知识点");
  const binding = findTaskBinding(data, "gen_flashcard", courseId);
  if (!binding) {
    throw new Error(
      "未配置 AI 任务模型，请前往「模型配置 → AI 任务模型分配」设置「gen_flashcard」任务或「全局默认模型」",
    );
  }
  const kps = kpIds
    .map((id) => data.knowledgePoints.find((k) => k.id === id && k.courseId === courseId))
    .filter((k): k is KnowledgePoint => !!k);
  if (kps.length === 0) throw new Error("所选知识点不存在，可能已被删除");
  // 铃铛：分批生成，进度按知识点数
  const fcTask = startBgTask({
    taskId: courseTaskId(courseId, "gen_flashcard"),
    taskType: "gen_flashcard",
    label: course.name,
    courseId,
    message: "AI 闪卡生成中…",
    total: kps.length,
  });
  const tpl = resolvePromptTemplate(data, "gen_flashcard");
  const result: GenerateFlashcardsResult = { created: 0, updated: 0, skipped: 0, parseSkipped: 0, errors: [] };
  try {
    const total = kps.length;
    for (let i = 0; i < kps.length; i += FLASHCARD_GEN_BATCH) {
      // 批次间隙检查取消：已完成批次已逐批落库，保留；任务标记 canceled
      if (options.isAborted?.()) {
        fcTask.canceled("AI 闪卡生成已取消");
        return result;
      }
      const batch = kps.slice(i, i + FLASHCARD_GEN_BATCH);
      const kpLines = batch.map((k, idx) => `${idx}. ${k.name}：${truncateText(k.content, 300) || "（暂无描述）"}`).join("\n");
      const baseMessages = [
        { role: "system", content: renderPrompt(tpl.system, { courseName: course.name, kpLines }) },
        { role: "user", content: renderPrompt(tpl.user, { courseName: course.name, kpLines }) },
      ];
      let parsed = parseFlashcardsJson(
        (await callAi({
          providerId: binding.providerId,
          modelId: binding.modelId,
          taskKey: "gen_flashcard",
          scope: "course-" + courseId,
          messages: baseMessages,
        })).content,
        batch.length,
      );
      if (parsed.items.length === 0) {
        // 重试一次：追加自纠正指令再调一次
        const retryRaw = (await callAi({
          providerId: binding.providerId,
          modelId: binding.modelId,
          taskKey: "gen_flashcard",
          scope: "course-" + courseId,
          messages: [
            ...baseMessages,
            {
              role: "user",
              content:
                "你上次的输出无法解析为闪卡 JSON。请重新输出：只返回包含 " +
                batch.length +
                " 个元素的 JSON 数组，每项字段为 index（0 起整数，与输入知识点顺序对应）、front（问题）、back（答案要点），不要输出任何其他文字。",
            },
          ],
        })).content;
        const retry = parseFlashcardsJson(retryRaw, batch.length);
        if (retry.items.length > 0 || retry.errors.length === 0) parsed = retry;
      }
      for (const e of parsed.errors) result.errors.push(e);
      result.parseSkipped += parsed.skipped;
      const latest = await getData();
      for (const item of parsed.items) {
        const kp = batch[item.index];
        const prev = latest.flashCards.find((c) => c.courseId === courseId && c.kpId === kp.id);
        if (prev && !options.overwrite) {
          result.skipped++;
          continue;
        }
        if (prev) {
          prev.front = item.front;
          prev.back = item.back;
          prev.source = "ai";
          prev.updateTime = now();
          result.updated++;
        } else {
          const card: FlashCard = {
            id: nextId(latest.flashCards),
            courseId,
            kpId: kp.id,
            front: item.front,
            back: item.back,
            source: "ai",
            createTime: now(),
          };
          latest.flashCards.push(card);
          ensureCardReviewInData(latest, card.id);
          result.created++;
        }
      }
      await saveData(latest);
      const done = Math.min(total, i + FLASHCARD_GEN_BATCH);
      options.onProgress?.(done, total);
      fcTask.progress({ done, message: `AI 闪卡生成：第 ${done}/${total} 个知识点…` });
    }
    let msg = `生成完成：新增 ${result.created} 张`;
    if (result.updated > 0) msg += `、覆盖 ${result.updated} 张`;
    if (result.skipped > 0) msg += `、跳过已有 ${result.skipped} 张`;
    if (result.parseSkipped > 0) msg += `；${result.parseSkipped} 个知识点输出异常未生成`;
    fcTask.done(msg);
    return result;
  } catch (e) {
    if (e instanceof AiCanceledError) {
      // 用户取消：已完成批次已落库，任务标为取消（非失败），返回部分结果供 UI 显示取消文案
      fcTask.canceled("AI 闪卡生成已取消");
      return result;
    }
    fcTask.fail(e, "AI 闪卡生成失败");
    throw e;
  }
}

