// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import EmptyState from "../EmptyState.vue";

describe("EmptyState", () => {
  it("渲染线性图标与文案", () => {
    const w = mount(EmptyState, { props: { icon: "graph", text: "暂无数据" } });
    expect(w.find("svg.app-icon").exists()).toBe(true);
    expect(w.text()).toContain("暂无数据");
  });

  it("默认插槽作为操作区", () => {
    const w = mount(EmptyState, {
      props: { text: "空" },
      slots: { default: "<button class='x'>去学习</button>" },
    });
    expect(w.find(".es-actions .x").exists()).toBe(true);
  });
});
