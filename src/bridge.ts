import { fetchSyncPost } from "siyuan";
import type { Plugin } from "siyuan";
import { createEmptyData } from "./data";

const DATA_STORAGE = "data";

// 独立窗口 -> 主窗口 的 postMessage 桥接协议
interface BridgeRequest {
  type: "siyuan-api-request";
  id: number;
  method: string;
  payload?: unknown;
}

// 方法分发：独立窗口内无法直连内核（file:// 下 CORS/token 受限），
// 所有数据读写与外部 LLM 调用均由主窗口插件实例代理。
async function handleMethod(plugin: Plugin, method: string, payload: unknown): Promise<unknown> {
  switch (method) {
    case "ping": {
      const sys = window.siyuan.config?.system;
      return {
        dataDir: sys?.dataDir,
        workspaceDir: sys?.workspaceDir,
        time: Date.now(),
      };
    }
    case "getData": {
      return plugin.data[DATA_STORAGE] ?? createEmptyData();
    }
    case "saveData": {
      plugin.data[DATA_STORAGE] = payload;
      const res = await plugin.saveData(DATA_STORAGE, payload);
      return { code: (res as { code?: number })?.code ?? 0 };
    }
    // 只读查询思源内置数据（blocks/assets 等），供后续功能使用
    case "querySql": {
      const { stmt } = payload as { stmt: string };
      return await fetchSyncPost("/api/query/sql", { stmt });
    }
    default:
      throw new Error(`未知桥接方法: ${method}`);
  }
}

export function registerBridge(plugin: Plugin): void {
  window.addEventListener("message", async (event) => {
    const msg = event.data as BridgeRequest;
    if (!msg || msg.type !== "siyuan-api-request") {
      return;
    }
    const { id, method, payload } = msg;
    try {
      const result = await handleMethod(plugin, method, payload);
      (event.source as Window)?.postMessage({ type: "siyuan-api-response", id, result }, "*");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      (event.source as Window)?.postMessage({ type: "siyuan-api-response", id, error: message }, "*");
    }
  });
}
