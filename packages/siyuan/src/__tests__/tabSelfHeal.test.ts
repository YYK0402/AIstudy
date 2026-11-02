// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { decideSelfHeal } from "../tabSelfHeal";

function makePanel(mounted = false, label = "p"): Element {
  const panel = document.createElement("div");
  panel.setAttribute("data-panel", label);
  if (mounted) {
    const app = document.createElement("div");
    app.className = "ai-study-app";
    panel.appendChild(app);
  }
  return panel;
}

describe("decideSelfHeal", () => {
  it("面板已挂载 → none（正常 init 路径，不重复 mount）", () => {
    const panel = makePanel(true);
    expect(decideSelfHeal(panel, panel, false)).toBe("none");
    expect(decideSelfHeal(null, makePanel(true), false)).toBe("none");
  });

  it("面板未挂载且与上次不是同一面板 → none（可能是移除中/新建中，先观察）", () => {
    const prev = makePanel(false, "a");
    const cur = makePanel(false, "b");
    expect(decideSelfHeal(prev, cur, false)).toBe("none");
  });

  it("连续两次同一未挂载面板 → mount（稳定孤儿页签：focus 未重跑 init，补挂载）", () => {
    const panel = makePanel(false);
    expect(decideSelfHeal(panel, panel, false)).toBe("mount");
  });

  it("末次检查仍未挂载（不同面板也算）→ mount（移除窗口必已过）", () => {
    const prev = makePanel(false, "a");
    const cur = makePanel(false, "b");
    expect(decideSelfHeal(prev, cur, true)).toBe("mount");
    expect(decideSelfHeal(null, makePanel(false), true)).toBe("mount");
  });

  it("中间检查无面板 → none（继续等待）", () => {
    expect(decideSelfHeal(null, null, false)).toBe("none");
  });

  it("末次检查仍无面板 → error（openTab 静默失败）", () => {
    expect(decideSelfHeal(null, null, true)).toBe("error");
  });

  it("上次有面板、这次没了且是末次 → error（移除完成后 openTab 落入窗口丢失）", () => {
    expect(decideSelfHeal(makePanel(false), null, true)).toBe("error");
  });
});
