import type { StudyBridge } from "./types";

let bridge: StudyBridge | null = null;

/** 宿主注入桥接实现（mount.ts 挂载时从 window.__AI_STUDY_BRIDGE__ 解析后调用；测试直接注入 mock） */
export function setBridge(b: StudyBridge): void {
  bridge = b;
}

export function getBridge(): StudyBridge {
  if (!bridge) throw new Error("StudyBridge 未初始化：宿主须在挂载前设置 window.__AI_STUDY_BRIDGE__");
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
