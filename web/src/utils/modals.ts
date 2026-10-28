/**
 * 弹窗全局行为：Esc 关闭 + 打开事件广播 + 焦点管理。
 * 约定：所有弹窗使用 .modal-mask(.open) + @click.self 关闭，这里统一处理键盘、焦点陷阱与通知面板收起。
 * 焦点管理：打开时记录触发元素并把焦点移入弹窗首个可聚焦控件；Tab/Shift+Tab 在弹窗内循环；关闭时焦点归还。
 */

export const MODAL_OPEN_EVENT = "siyuan-ai-study:modal-open";

const FOCUSABLE_SELECTOR = [
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "button:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

let installed = false;
let observer: MutationObserver | null = null;
let modalWasOpen = false;
let currentMasks: HTMLElement[] = [];
const focusStack: Array<{ mask: HTMLElement; prev: Element | null }> = [];

function openMasks(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(".ai-study-app .modal-mask.open")].filter(
    (m) => m.offsetParent !== null,
  );
}

function focusables(mask: HTMLElement): HTMLElement[] {
  return [...mask.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter((el) => el.offsetParent !== null);
}

function onModalOpen(mask: HTMLElement): void {
  focusStack.push({ mask, prev: document.activeElement });
  const els = focusables(mask);
  if (els.length > 0) els[0].focus();
}

function onModalClose(mask: HTMLElement): void {
  const idx = focusStack.findIndex((r) => r.mask === mask);
  if (idx === -1) return;
  const [rec] = focusStack.splice(idx, 1);
  if (rec.prev instanceof HTMLElement && rec.prev.isConnected) rec.prev.focus();
}

function onKeydown(e: KeyboardEvent) {
  const masks = openMasks();
  if (masks.length === 0) return;
  const top = masks[masks.length - 1];

  if (e.key === "Escape") {
    e.stopPropagation();
    // 触发遮罩自身的 @click.self，等价于点击遮罩关闭
    top.click();
    return;
  }

  if (e.key === "Tab") {
    const els = focusables(top);
    if (els.length === 0) {
      e.preventDefault();
      return;
    }
    const first = els[0];
    const last = els[els.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !top.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !top.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  }
}

function checkModalOpen() {
  const masks = openMasks();
  for (const m of masks) if (!currentMasks.includes(m)) onModalOpen(m);
  for (const m of currentMasks) if (!masks.includes(m)) onModalClose(m);
  currentMasks = masks;
  const open = masks.length > 0;
  if (open && !modalWasOpen) {
    window.dispatchEvent(new Event(MODAL_OPEN_EVENT));
  }
  modalWasOpen = open;
}

export function installModalGlobals(root: Element): void {
  if (installed) return;
  installed = true;
  document.addEventListener("keydown", onKeydown);
  observer = new MutationObserver(checkModalOpen);
  // childList 捕获 v-if 挂载/卸载，attributes 捕获 :class 切换
  observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
}

export function uninstallModalGlobals(): void {
  if (!installed) return;
  installed = false;
  document.removeEventListener("keydown", onKeydown);
  observer?.disconnect();
  observer = null;
  currentMasks = [];
  focusStack.length = 0;
  modalWasOpen = false;
}
