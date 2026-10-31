import { getSettings } from "./settings";
import { getBridge } from "@/bridge";

// 落库（经宿主桥接写入平台文档体系）
/** 宿主是否有落库文档体系（docs=none 的宿主 core 已隐藏入口，此函数短路兜底） */
export function docsEnabled(): boolean {
  return getBridge().capabilities?.docs === "siyuan";
}

/** 按设置决定是否落库；失败不阻塞主流程。传 label 时失败会统一提示（不传则静默，调用方自行聚合提示） */
export async function persistDocIfEnabled(
  markdown: string,
  path: string,
  label?: string,
  parentID?: string | null,
): Promise<string | null> {
  if (!docsEnabled()) return null;
  const settings = await getSettings();
  if (!settings.persistToSiyuan) return null;
  try {
    const folder = await ensureFolder(settings.notebookName);
    const { id } = await createDoc(markdown, path, folder, parentID);
    return id;
  } catch (e) {
    console.error("落库思源失败:", e);
    if (label) {
      const msg = e instanceof Error ? e.message : "未知错误";
      getBridge().showMessage(`思源笔记落库失败（${label}）：${msg}`, 4000, "error");
    }
    return null;
  }
}

export async function ensureFolder(name: string): Promise<string> {
  return getBridge().ensureFolder(name);
}

export async function createDoc(
  markdown: string,
  path: string,
  folder: string,
  parentRef?: string | null,
): Promise<{ id: string }> {
  return getBridge().createDoc(markdown, path, folder, parentRef);
}

export async function removeDoc(id: string): Promise<void> {
  await getBridge().removeDoc(id);
}

/** 幂等删除：部分宿主删父文档会级联删子树，子文档已不存在不算失败 */
export async function removeDocIfExists(id: string): Promise<void> {
  try {
    await removeDoc(id);
  } catch (e) {
    const stillExists = await getBridge().docExists(id).catch(() => false);
    if (stillExists) throw e;
  }
}
