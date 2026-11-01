import { beforeEach, describe, expect, it } from "vitest";
import { clearGraphPositions, loadGraphPositions, saveGraphPositions } from "../graphPositions";

// graphPositions 直接引用 localStorage（浏览器全局），node 环境补最小桩
const store = new Map<string, string>();
const localStorageStub = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
};
beforeEach(() => {
  store.clear();
  Object.defineProperty(globalThis, "localStorage", { value: localStorageStub, configurable: true });
});

describe("graphPositions", () => {
  it("save 后 load 原样返回（按课程隔离）", () => {
    saveGraphPositions(1, { kp1: { x: 10, y: 20 } });
    expect(loadGraphPositions(1)).toEqual({ kp1: { x: 10, y: 20 } });
    saveGraphPositions(2, { kp9: { x: 1, y: 2 } });
    expect(loadGraphPositions(1)).toEqual({ kp1: { x: 10, y: 20 } });
    expect(loadGraphPositions(2)).toEqual({ kp9: { x: 1, y: 2 } });
  });

  it("未保存的课程返回空对象", () => {
    expect(loadGraphPositions(404)).toEqual({});
  });

  it("clear 只清指定课程", () => {
    saveGraphPositions(1, { a: { x: 0, y: 0 } });
    saveGraphPositions(2, { b: { x: 0, y: 0 } });
    clearGraphPositions(1);
    expect(loadGraphPositions(1)).toEqual({});
    expect(loadGraphPositions(2)).toEqual({ b: { x: 0, y: 0 } });
  });

  it("存储中已有损坏 JSON：read 容错返回空，save 不抛错", () => {
    store.set("ai-study:graph-positions", "{oops");
    expect(loadGraphPositions(1)).toEqual({});
    expect(() => saveGraphPositions(1, { a: { x: 1, y: 1 } })).not.toThrow();
    expect(loadGraphPositions(1)).toEqual({ a: { x: 1, y: 1 } });
  });

  it("存储不可用（setItem 抛错）：save 静默不抛", () => {
    Object.defineProperty(globalThis, "localStorage", {
      value: { getItem: () => null, setItem: () => { throw new Error("quota"); }, removeItem: () => {} },
      configurable: true,
    });
    expect(() => saveGraphPositions(1, { a: { x: 1, y: 1 } })).not.toThrow();
  });
});
