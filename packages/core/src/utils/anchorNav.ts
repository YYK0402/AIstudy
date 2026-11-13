/**
 * 应用内锚点的特殊点击判定。
 * 背景：router-link 渲染真实 <a href>，中键 / Cmd(·Ctrl)+点击 会触发浏览器
 * 「新窗口打开」默认行为；思源桌面版 Electron 的新窗口请求由
 * setWindowOpenHandler 接管走 shell.openExternal，直接跳出系统浏览器。
 */

/** href 是否指向当前文档（相对路径 / hash 路由）；带协议（http/https/mailto/siyuan 等）视为外部 */
export function isSameDocumentAnchor(href: string): boolean {
  return !/^[a-z][a-z0-9+.-]*:/i.test(href);
}

/** 中键（auxclick）/ Meta+点击 / Ctrl+点击（浏览器默认开新窗口）且指向当前文档时应拦截 */
export function shouldBlockSpecialClick(
  href: string,
  e: { button: number; metaKey: boolean; ctrlKey: boolean },
): boolean {
  if (e.button !== 1 && !e.metaKey && !e.ctrlKey) return false;
  return isSameDocumentAnchor(href);
}
