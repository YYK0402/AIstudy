// 批量整理知识点内容：预筛密排长内容（单段无换行，或多行中分号连排并列项）→ AI 重写为结构化排版（并发 2，只调排版不改信息）；
// 每条落库前重取最新数据防脏写（对齐 nodeExtract 模式）；已结构化内容预筛跳过
import { getData, saveData } from "./storage";
import { callAi, callAiWithRetry, AiCanceledError, findTaskBinding } from "./ai";
import { resolvePromptTemplate, renderPrompt } from "./promptTemplates";
import { extractJsonCandidates, parseJsonCandidates } from "../utils/aiJson";

const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+/;

/** 密排行：单行内 ≥2 个分号分隔符（≥3 条并列项连排）；行首列表标记不影响判定（"1. 标签：a；b；c" 仍算密排） */
function isDenseLine(line: string): boolean {
  const t = line.trim().replace(LIST_MARKER, "");
  return t.split("；").length >= 3;
}

/** 预筛：整理密排长内容——单段（无换行、非列表开头），或多行中 ≥2 行密排；已结构化/过短的跳过 */
export function needsReformat(content: string, minLen = 60): boolean {
  const t = content.trim();
  if (t.length < minLen) return false;
  const lines = t.split("\n");
  if (lines.length <= 1) return !LIST_MARKER.test(t);
  return lines.filter(isDenseLine).length >= 2;
}

export interface ReformatProgress {
  done: number;
  total: number;
}

export interface ReformatResult {
  done: number;
  changed: number;
  failed: number;
}

/** 解析 AI 的 {"content": "..."}（围栏/包装对象容忍）；不可用返回 null */
export function parseReformatContent(raw: string): string | null {
  const parsed = parseJsonCandidates(extractJsonCandidates(raw, "object"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const content = (parsed as Record<string, unknown>).content;
  if (typeof content !== "string") return null;
  const t = content.trim();
  return t || null;
}

export async function reformatKpContents(
  courseId: number,
  onProgress?: (p: ReformatProgress) => void,
): Promise<ReformatResult> {
  const data = await getData();
  const course = data.courses.find((c) => c.id === courseId);
  if (!course) throw new Error("课程不存在或已删除");
  const targets = data.knowledgePoints.filter((k) => k.courseId === courseId && needsReformat(k.content));
  if (targets.length === 0) return { done: 0, changed: 0, failed: 0 };
  const binding = findTaskBinding(data, "kp_reformat", courseId);
  if (!binding) throw new Error("未配置「知识点内容整理」模型：请到「模型配置 → 任务模型」为该任务指定模型");
  const tpl = resolvePromptTemplate(data, "kp_reformat");

  let nextIdx = 0;
  let done = 0;
  let changed = 0;
  let failed = 0;
  const worker = async () => {
    for (;;) {
      const i = nextIdx++;
      if (i >= targets.length) return;
      const kp = targets[i];
      try {
        const res = await callAiWithRetry({
          providerId: binding.providerId,
          modelId: binding.modelId,
          taskKey: "kp_reformat",
          scope: `course-${courseId}`,
          messages: [
            { role: "system", content: renderPrompt(tpl.system, {}) },
            { role: "user", content: renderPrompt(tpl.user, { name: kp.name, content: kp.content }) },
          ],
        });
        const reformatted = parseReformatContent(res.content);
        // 落库前重取最新数据，防 AI 调用期间其他写入被覆盖（脏写）
        const latest = await getData();
        const target = latest.knowledgePoints.find((k) => k.id === kp.id);
        if (target && reformatted && reformatted !== target.content) {
          target.content = reformatted;
          changed++;
          await saveData(latest);
        }
      } catch (e) {
        if (e instanceof AiCanceledError) throw e;
        failed++;
      }
      done++;
      onProgress?.({ done, total: targets.length });
    }
  };
  // 并发 2：降低对供应商速率限制的冲击（429 由 callAiWithRetry 退避兜底）
  await Promise.all([worker(), worker()]);
  return { done, changed, failed };
}
