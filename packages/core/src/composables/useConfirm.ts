import { useModalStore } from "../stores/modal";

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  danger?: boolean;
}

export interface ConfirmWithChoiceOptions extends ConfirmOptions {
  checkbox: { label: string; defaultChecked?: boolean };
}

export interface ConfirmChoiceResult {
  ok: boolean;
  checked: boolean;
}

/** 单例 resolver：同时只允许一个确认框，避免覆盖 */
let resolver: ((r: ConfirmChoiceResult) => void) | null = null;

function closeAndSettle(ok: boolean): void {
  const store = useModalStore();
  const checked = store.confirmChecked;
  store.confirmOpen = false;
  store.confirmCheckbox = null;
  const r = resolver;
  resolver = null;
  r?.({ ok, checked });
}

export function useConfirm() {
  /** 纯确认框：勾选框不存在，返回是否确认 */
  function confirm(opts: ConfirmOptions): Promise<boolean> {
    if (resolver) return Promise.resolve(false);
    const store = useModalStore();
    store.confirmTitle = opts.title ?? "操作确认";
    store.confirmMessage = opts.message;
    store.confirmText = opts.confirmText ?? "确认";
    store.confirmDanger = opts.danger ?? false;
    store.confirmCheckbox = null;
    store.confirmOpen = true;
    return new Promise<boolean>((r) => {
      resolver = (res) => r(res.ok);
    });
  }

  /** 带勾选项的确认框（如「暂停学习计划 + 同时暂停复习」）：取消时 checked 无意义 */
  function confirmWithChoice(opts: ConfirmWithChoiceOptions): Promise<ConfirmChoiceResult> {
    if (resolver) return Promise.resolve({ ok: false, checked: opts.checkbox.defaultChecked ?? true });
    const store = useModalStore();
    store.confirmTitle = opts.title ?? "操作确认";
    store.confirmMessage = opts.message;
    store.confirmText = opts.confirmText ?? "确认";
    store.confirmDanger = opts.danger ?? false;
    store.confirmCheckbox = { label: opts.checkbox.label };
    store.confirmChecked = opts.checkbox.defaultChecked ?? true;
    store.confirmOpen = true;
    return new Promise<ConfirmChoiceResult>((r) => {
      resolver = r;
    });
  }

  return { confirm, confirmWithChoice };
}

export function settleConfirm(ok: boolean): void {
  closeAndSettle(ok);
}
