/**
 * 打开学习页签后的轮询自愈决策（纯函数，便于单测）。
 *
 * 覆盖的竞态：关闭页签后内核移除是异步的（实测 ~1.5–2s），期间点顶栏 openTab
 * 会被内核判定「页签已存在」→ 只 focus 不重跑 init，而 destroy 已 unmount
 * → 面板永久空白，需再点一次才恢复。
 *
 * 判定原则：
 * - 已挂载 → 正常 init 路径，不重复 mount
 * - 未挂载且与上次是同一面板 → 稳定孤儿页签（非移除中）→ 补挂载
 * - 未挂载但面板换了 → 可能处于移除/新建过渡中 → 继续观察
 * - 末次检查兜底：仍未挂载 → 挂载（移除窗口必已过）；仍无页签 → 报错
 */
export type OpenTabSelfHealAction = "none" | "mount" | "error";

export function decideSelfHeal(prevPanel: Element | null, panel: Element | null, isLast: boolean): OpenTabSelfHealAction {
  if (panel) {
    if (panel.querySelector(".ai-study-app")) return "none";
    if (panel === prevPanel || isLast) return "mount";
    return "none";
  }
  return isLast ? "error" : "none";
}
