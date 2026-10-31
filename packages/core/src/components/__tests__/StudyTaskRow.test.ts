// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import StudyTaskRow from "../StudyTaskRow.vue";

const RouterLinkStub = {
  name: "RouterLink",
  props: ["to"],
  template: "<a class='rl'><slot /></a>",
};

function mountRow(props: Record<string, unknown> = {}) {
  return mount(StudyTaskRow, {
    props: { title: "学习：测试知识点", taskType: "learn", kpId: 7, ...props },
    global: { components: { RouterLink: RouterLinkStub } },
  });
}

describe("StudyTaskRow", () => {
  it("渲染标题、类型标签与自动生成的去处", () => {
    const w = mountRow();
    expect(w.find(".task-title").text()).toBe("学习：测试知识点");
    expect(w.find(".tag").text()).toContain("新知");
    expect(w.find(".task-act").text()).toContain("去学习");
  });

  it("点击勾选 emit toggle", async () => {
    const w = mountRow();
    await w.find("button.task-check").trigger("click");
    expect(w.emitted("toggle")).toHaveLength(1);
  });

  it("busy 时禁用并显示转圈", () => {
    const w = mountRow({ busy: true });
    expect(w.find("button.task-check").attributes("disabled")).toBeDefined();
    expect(w.find(".task-check-spinner").exists()).toBe(true);
  });

  it("checkable=false 时不渲染可点勾选框", () => {
    const w = mountRow({ checkable: false });
    expect(w.find("button.task-check").exists()).toBe(false);
  });

  it("已完成行带 done 类", () => {
    const w = mountRow({ done: true });
    expect(w.classes()).toContain("done");
  });
});
