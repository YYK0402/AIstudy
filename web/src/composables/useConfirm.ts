import { useModalStore } from "../stores/modal";

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  danger?: boolean;
}

/** 单例 resolver：同时只允许一个确认框，避免覆盖 */
let resolver: ((ok: boolean) => void) | null = null;

function closeAndSettle(ok: boolean): void {
  const store = useModalStore();
  store.confirmOpen = false;
  const r = resolver;
  resolver = null;
  r?.(ok);
}

export function useConfirm() {
  function confirm(opts: ConfirmOptions): Promise<boolean> {
    if (resolver) return Promise.resolve(false);
    const store = useModalStore();
    store.confirmTitle = opts.title ?? "操作确认";
    store.confirmMessage = opts.message;
    store.confirmText = opts.confirmText ?? "确认";
    store.confirmDanger = opts.danger ?? false;
    store.confirmOpen = true;
    return new Promise<boolean>((r) => {
      resolver = r;
    });
  }
  return { confirm };
}

export function settleConfirm(ok: boolean): void {
  closeAndSettle(ok);
}
