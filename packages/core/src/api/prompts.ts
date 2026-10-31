import type { PromptTemplateDef } from "../types/appData";
import { getData, saveData } from "./storage";
import { PROMPT_TASKS, findPromptTask } from "./promptTemplates";
import type { PromptVarInfo } from "./promptTemplates";

export interface PromptTemplateView {
  key: string;
  name: string;
  desc: string;
  vars: PromptVarInfo[];
  /** 当前生效模板（自定义 ?? 默认） */
  current: PromptTemplateDef;
  /** 内置默认模板（供「恢复默认」对照） */
  def: PromptTemplateDef;
  isCustom: boolean;
}

/** 设置页读取全部任务的模板状态 */
export async function getPromptTemplateViews(): Promise<PromptTemplateView[]> {
  const data = await getData();
  return PROMPT_TASKS.map((meta) => {
    const custom = data.promptTemplates?.[meta.key];
    const isCustom =
      !!custom && typeof custom.system === "string" && typeof custom.user === "string";
    return {
      key: meta.key,
      name: meta.name,
      desc: meta.desc,
      vars: meta.vars,
      current: isCustom ? { system: custom!.system, user: custom!.user } : { ...meta.defaultTemplate },
      def: { ...meta.defaultTemplate },
      isCustom,
    };
  });
}

/** 保存某任务的自定义模板（与默认完全一致时等价于恢复默认） */
export async function savePromptTemplate(taskKey: string, tpl: PromptTemplateDef): Promise<void> {
  const meta = findPromptTask(taskKey);
  if (!meta) throw new Error(`未知提示词任务：${taskKey}`);
  const data = await getData();
  if (!data.promptTemplates) data.promptTemplates = {};
  if (tpl.system === meta.defaultTemplate.system && tpl.user === meta.defaultTemplate.user) {
    delete data.promptTemplates[taskKey];
  } else {
    data.promptTemplates[taskKey] = { system: tpl.system, user: tpl.user };
  }
  await saveData(data);
}

/** 恢复某任务为内置默认模板 */
export async function resetPromptTemplate(taskKey: string): Promise<void> {
  const data = await getData();
  if (data.promptTemplates && taskKey in data.promptTemplates) {
    delete data.promptTemplates[taskKey];
    await saveData(data);
  }
}
