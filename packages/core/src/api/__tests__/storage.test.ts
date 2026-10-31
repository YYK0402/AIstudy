import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppData } from "../../types/appData";
import { createEmptyData } from "../../types/appData";
import { setBridge } from "../../bridge";
import type { StudyBridge } from "../../bridge/types";

const baseData: AppData = createEmptyData();
let getDataCalls = 0;
let saveRes: { code: number; msg?: string; dirty?: { global: boolean; courseIds: number[] } };
const dispatchSpy = vi.fn((_e: Event) => true);
(globalThis as Record<string, unknown>).window = {
  addEventListener: () => {},
  dispatchEvent: dispatchSpy,

};
setBridge({
    getData: async () => {
      getDataCalls++;
      return baseData;
    },
    saveData: async () => saveRes,
  } as unknown as StudyBridge);

const { DATA_SAVED_EVENT, getData, getDataSnapshot, invalidateSnapshot, saveData } = await import("../storage");

function lastSavedPayload(): unknown {
  const ev = dispatchSpy.mock.calls.map((c) => c[0]).filter((e) => e instanceof Event && e.type === DATA_SAVED_EVENT).pop();
  return ev ? (ev as CustomEvent).detail : undefined;
}

describe("saveData 事件载荷（脏集）", () => {
  beforeEach(() => {
    dispatchSpy.mockClear();
    getDataCalls = 0;
    saveRes = { code: 0, msg: "" };
  });

  it("插件返回 dirty 时事件 detail 透传脏集", async () => {
    saveRes = { code: 0, dirty: { global: false, courseIds: [1, 2] } };
    await saveData(baseData);
    expect(lastSavedPayload()).toEqual({ global: false, courseIds: [1, 2] });
  });

  it("插件未返回 dirty（旧版/mock）时回退全量刷新", async () => {
    await saveData(baseData);
    expect(lastSavedPayload()).toEqual({ global: true, courseIds: [] });
  });

  it("保存失败时抛出且不派发事件", async () => {
    saveRes = { code: -1, msg: "写盘失败" };
    await expect(saveData(baseData)).rejects.toThrow("数据保存失败：写盘失败");
    expect(lastSavedPayload()).toBeUndefined();
  });
});

describe("getDataSnapshot 快照缓存", () => {
  beforeEach(() => {
    invalidateSnapshot();
    getDataCalls = 0;
  });

  it("两次取快照只调一次 getData", async () => {
    const a = await getDataSnapshot();
    const b = await getDataSnapshot();
    expect(a).toBe(b);
    expect(getDataCalls).toBe(1);
  });

  it("invalidateSnapshot 后重新拉取", async () => {
    await getDataSnapshot();
    invalidateSnapshot();
    await getDataSnapshot();
    expect(getDataCalls).toBe(2);
  });

  it("saveData 成功后快照自动失效", async () => {
    saveRes = { code: 0 };
    await getDataSnapshot();
    await saveData(baseData);
    await getDataSnapshot();
    expect(getDataCalls).toBe(2);
  });
});
