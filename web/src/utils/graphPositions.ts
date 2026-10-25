import type { PositionPoint } from "./graphLayout";

const KEY = "ai-study:graph-positions";

type Store = Record<string, Record<string, PositionPoint>>;

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Store;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function write(store: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // 存储不可用时仅本次会话生效
  }
}

export function loadGraphPositions(courseId: number): Record<string, PositionPoint> {
  return read()[String(courseId)] ?? {};
}

export function saveGraphPositions(courseId: number, positions: Record<string, PositionPoint>): void {
  const store = read();
  store[String(courseId)] = positions;
  write(store);
}

export function clearGraphPositions(courseId: number): void {
  const store = read();
  delete store[String(courseId)];
  write(store);
}
