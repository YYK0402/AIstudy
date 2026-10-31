import { getSettings } from "./settings";

// 思源落库（同源自带通道，无需 token）
/** 思源文档 id 形如 14 位时间戳 + "-" + 7 位小写字母数字，用于识别已落库的有效文档 */
export function isSiyuanDocId(id: string): boolean {
  return /^\d{14}-[0-9a-z]{7}$/.test(id);
}

/** 按设置决定是否落库；失败不阻塞主流程。传 label 时失败会统一提示（不传则静默，调用方自行聚合提示） */
export async function persistDocIfEnabled(
  markdown: string,
  path: string,
  label?: string,
  parentID?: string | null,
): Promise<string | null> {
  const settings = await getSettings();
  if (!settings.persistToSiyuan) return null;
  try {
    const notebook = await ensureNotebook(settings.notebookName);
    const { id } = await createSiyuanDoc(markdown, path, notebook, parentID);
    return id;
  } catch (e) {
    console.error("落库思源失败:", e);
    if (label) {
      const msg = e instanceof Error ? e.message : "未知错误";
      window.siyuanAiStudy.showMessage(`思源笔记落库失败（${label}）：${msg}`, 4000, "error");
    }
    return null;
  }
}

export async function ensureNotebook(name: string): Promise<string> {
  return window.siyuanAiStudy.ensureNotebook(name);
}

export async function createSiyuanDoc(
  markdown: string,
  path: string,
  notebook: string,
  parentID?: string | null,
): Promise<{ id: string }> {
  return window.siyuanAiStudy.createSiyuanDoc(markdown, path, notebook, parentID);
}

export async function removeSiyuanDoc(id: string): Promise<void> {
  await window.siyuanAiStudy.removeSiyuanDoc(id);
}

/** 幂等删除：删父文档时思源会级联删子树，子文档已不存在不算失败 */
export async function removeSiyuanDocIfExists(id: string): Promise<void> {
  try {
    await removeSiyuanDoc(id);
  } catch (e) {
    const stillExists = await window.siyuanAiStudy.siyuanDocExists(id).catch(() => false);
    if (stillExists) throw e;
  }
}
