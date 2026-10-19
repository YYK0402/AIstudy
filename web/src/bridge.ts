interface BridgeResponse {
  type: "siyuan-api-response";
  id: number;
  result?: unknown;
  error?: string;
}

let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

window.addEventListener("message", (event) => {
  const msg = event.data as BridgeResponse;
  if (!msg || msg.type !== "siyuan-api-response") {
    return;
  }
  const p = pending.get(msg.id);
  if (!p) {
    return;
  }
  pending.delete(msg.id);
  if (msg.error) {
    p.reject(new Error(msg.error));
  } else {
    p.resolve(msg.result);
  }
});

// 向主窗口插件实例发起桥接请求（运行在思源页签的 iframe 内，父窗口即思源主窗口）
export function bridgeRequest(method: string, payload?: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!window.parent || window.parent === window) {
      reject(new Error("未检测到思源主窗口"));
      return;
    }
    const id = ++seq;
    pending.set(id, { resolve, reject });
    window.parent.postMessage({ type: "siyuan-api-request", id, method, payload }, "*");
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error("桥接请求超时"));
      }
    }, 10000);
  });
}
