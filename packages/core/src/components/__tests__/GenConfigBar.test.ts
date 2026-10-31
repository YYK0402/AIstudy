// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import GenConfigBar from "../GenConfigBar.vue";

describe("GenConfigBar", () => {
  it("未选知识点时禁用主操作", () => {
    const w = mount(GenConfigBar, { props: { selectedCount: 0, actionLabel: "开始出题" } });
    expect(w.find(".gen-actions .btn").attributes("disabled")).toBeDefined();
  });

  it("选择知识点与主操作触发出站事件", async () => {
    const w = mount(GenConfigBar, { props: { selectedCount: 3, actionLabel: "开始出题" } });
    await w.findAll("button")[0].trigger("click");
    await w.find(".gen-actions .btn").trigger("click");
    expect(w.emitted("select")).toHaveLength(1);
    expect(w.emitted("action")).toHaveLength(1);
  });

  it("options 插槽存在时渲染配置网格", () => {
    const w = mount(GenConfigBar, {
      props: { selectedCount: 1, actionLabel: "生成" },
      slots: { options: "<div class='field'>x</div>" },
    });
    expect(w.find(".gen-form .field").exists()).toBe(true);
  });
});
