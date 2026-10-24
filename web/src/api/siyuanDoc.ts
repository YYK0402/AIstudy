import { getSettings } from "./settings";

// 思源落库（同源自带通道，无需 token）
/** 思源文档 id 形如 14 位时间戳 + "-" + 7 位小写字母数字，用于识别已落库的有效文档 */
export function isSiyuanDocId(id: string): boolean {
  return /^\d{14}-[0-9a-z]{7}$/.test(id);
}

/** 按设置决定是否落库；失败不阻塞主流程 */
export async function persistDocIfEnabled(markdown: string, path: string): Promise<string | null> {
  const settings = await getSettings();
  if (!settings.persistToSiyuan) return null;
  try {
    const notebook = await ensureNotebook(settings.notebookName);
    const { id } = await createSiyuanDoc(markdown, path, notebook);
    return id;
  } catch (e) {
    console.error("落库思源失败:", e);
    return null;
  }
}

export async function ensureNotebook(name: string): Promise<string> {
  return window.siyuanAiStudy.ensureNotebook(name);
}

export async function createSiyuanDoc(markdown: string, path: string, notebook: string): Promise<{ id: string }> {
  return window.siyuanAiStudy.createSiyuanDoc(markdown, path, notebook);
}

export async function removeSiyuanDoc(id: string): Promise<void> {
  await window.siyuanAiStudy.removeSiyuanDoc(id);
}
