/**
 * 弹窗全局行为：Esc 关闭 + 打开事件广播。
 * 约定：所有弹窗使用 .modal-mask(.open) + @click.self 关闭，这里统一处理键盘与通知面板收起。
 */

export const MODAL_OPEN_EVENT = "siyuan-ai-study:modal-open";

let installed = false;
let observer: MutationObserver | null = null;
let modalWasOpen = false;

function openMasks(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(".ai-study-app .modal-mask.open")].filter(
    (m) => m.offsetParent !== null,
  );
}

function onKeydown(e: KeyboardEvent) {
  if (e.key !== "Escape") return;
  const masks = openMasks();
  const top = masks[masks.length - 1];
  if (!top) return;
  e.stopPropagation();
  // 触发遮罩自身的 @click.self，等价于点击遮罩关闭
  top.click();
}

function checkModalOpen() {
  const open = openMasks().length > 0;
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
  observer.observe(root, { subtree: true, attributes: true, attributeFilter: ["class"] });
}

export function uninstallModalGlobals(): void {
  if (!installed) return;
  installed = false;
  document.removeEventListener("keydown", onKeydown);
  observer?.disconnect();
  observer = null;
  modalWasOpen = false;
}
