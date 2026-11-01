/** 是否移动端前端。3.8.9 内核移动端（petal 原生 / 移动浏览器）的 openTab 对 custom
 *  页签是空实现（页签静默不创建），插件无法打开学习页签 → 入口需明确提示而非假装成功。
 *  桌面取值：desktop / desktop-window / browser-desktop；移动取值：mobile / browser-mobile */
export function isMobileFrontend(frontend: string): boolean {
  return frontend.includes("mobile");
}
