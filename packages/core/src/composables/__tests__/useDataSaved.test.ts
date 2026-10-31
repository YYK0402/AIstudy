// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import { createPinia, type Pinia } from "pinia";
import { DATA_SAVED_EVENT, type DataSavedPayload } from "../../api/storage";
import { useCourseStore } from "../../stores/course";
import { useDataSavedRefresh } from "../useDataSaved";

function emitSaved(detail?: DataSavedPayload) {
  window.dispatchEvent(new CustomEvent(DATA_SAVED_EVENT, { detail }));
}

function mountHost(refresh: () => void, options?: Parameters<typeof useDataSavedRefresh>[1], pinia?: Pinia) {
  const Host = defineComponent({
    setup() {
      useDataSavedRefresh(refresh, options);
      return () => null;
    },
  });
  return mount(Host, { global: { plugins: [pinia ?? createPinia()] } });
}

describe("useDataSavedRefresh 选择性刷新", () => {
  let pinia: Pinia;
  beforeEach(() => {
    vi.useFakeTimers();
    pinia = createPinia();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("scope=course：仅当前课程或 global 脏集触发刷新", () => {
    const refresh = vi.fn();
    const wrapper = mountHost(refresh, undefined, pinia);
    const store = useCourseStore(pinia);
    store.currentCourseId = 1;

    emitSaved({ global: false, courseIds: [2] });
    vi.advanceTimersByTime(300);
    expect(refresh).not.toHaveBeenCalled();

    emitSaved({ global: false, courseIds: [1] });
    vi.advanceTimersByTime(300);
    expect(refresh).toHaveBeenCalledTimes(1);

    emitSaved({ global: true, courseIds: [] });
    vi.advanceTimersByTime(300);
    expect(refresh).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it("scope=global：仅 global 脏集触发", () => {
    const refresh = vi.fn();
    const wrapper = mountHost(refresh, { scope: "global" }, pinia);
    const store = useCourseStore(pinia);
    store.currentCourseId = 1;

    emitSaved({ global: false, courseIds: [1] });
    vi.advanceTimersByTime(300);
    expect(refresh).not.toHaveBeenCalled();

    emitSaved({ global: true, courseIds: [] });
    vi.advanceTimersByTime(300);
    expect(refresh).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("无 detail 的旧事件按全量刷新处理", () => {
    const refresh = vi.fn();
    const wrapper = mountHost(refresh, { scope: "global" }, pinia);
    window.dispatchEvent(new Event(DATA_SAVED_EVENT));
    vi.advanceTimersByTime(300);
    expect(refresh).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("防抖：窗口内多次事件合并为一次刷新", () => {
    const refresh = vi.fn();
    const wrapper = mountHost(refresh, { debounceMs: 200 }, pinia);
    const store = useCourseStore(pinia);
    store.currentCourseId = 1;

    emitSaved({ global: false, courseIds: [1] });
    vi.advanceTimersByTime(100);
    emitSaved({ global: false, courseIds: [1] });
    vi.advanceTimersByTime(300);
    expect(refresh).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("卸载后不再响应事件", () => {
    const refresh = vi.fn();
    const wrapper = mountHost(refresh, undefined, pinia);
    const store = useCourseStore(pinia);
    store.currentCourseId = 1;
    wrapper.unmount();

    emitSaved({ global: true, courseIds: [] });
    vi.advanceTimersByTime(300);
    expect(refresh).not.toHaveBeenCalled();
  });
});
