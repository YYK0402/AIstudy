// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import ProgressBar from "../ProgressBar.vue";

describe("ProgressBar", () => {
  it("按比例计算宽度并钳制在 0-100", () => {
    const w = mount(ProgressBar, { props: { value: 30, max: 120 } });
    expect(w.find("i").attributes("style")).toContain("width: 25%");
    expect(mount(ProgressBar, { props: { value: 200, max: 100 } }).find("i").attributes("style")).toContain("width: 100%");
  });

  it("tone 与 sm 生成对应类名", () => {
    const w = mount(ProgressBar, { props: { value: 1, max: 2, tone: "green", sm: true } });
    expect(w.classes()).toContain("green");
    expect(w.classes()).toContain("sm");
  });
});
