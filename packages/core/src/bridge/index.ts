import type { StudyBridge } from "./types";

let bridge: StudyBridge | null = null;

/** 宿主注入桥接实现（mount 参数直传时调用；测试直接注入 mock） */
export function setBridge(b: StudyBridge): void {
  bridge = b;
}

export function getBridge(): StudyBridge {
  if (!bridge) throw new Error("StudyBridge 未初始化：宿主须在挂载时传入 bridge");
  return bridge;
}

/** 防御性读取：bridge 未就绪（如模块加载期/测试环境）返回 null，不抛错 */
export function getBridgeSafe(): StudyBridge | null {
  return bridge;
}

export type {
  CallAiMessage,
  CallAiResult,
  BridgeCapabilities,
  ListModelsResult,
  StudyBridge,
  TestProviderResult,
} from "./types";
