// @vitest-environment jsdom
// mount 单实例回归（P0）：内核先恢复隐藏页签（mount #1）再开新页签（mount #2）时，
// 第二个挂载必须 adopt（迁入既有活实例）而非二次 createApp，否则双实例并存、
// 弹窗 Teleport 类选择器命中隐藏容器导致所有弹窗不可见。
import { afterEach, describe, expect, it } from "vitest";
import { createEmptyData, type AppData } from "../types/appData";
import type { StudyBridge } from "../bridge/types";
import { mount, unmount } from "../mount";

function makeBridge(): StudyBridge {
  const data: AppData = createEmptyData();
  return {
    pluginInstanceId: "test",
    capabilities: { host: "test", ocr: "none", nasFiles: false, docs: "none" },
    getData: () => data,
    saveData: async () => ({ code: 0 }),
    callAi: async () => {
      throw new Error("test bridge 无 AI");
    },
    cancelAiCall: () => {},
    testProvider: async () => ({ code: -1, msg: "" }),
    listModels: async () => ({ code: -1, msg: "" }),
    showMessage: () => {},
    ensureFolder: async () => {
      throw new Error("test bridge 无文档");
    },
    createDoc: async () => {
      throw new Error("test bridge 无文档");
    },
    removeDoc: async () => {},
    updateDoc: async () => {},
    getDocMarkdown: async () => null,
    docExists: async () => false,
    moveDoc: async () => {},
    renameDoc: async () => {},
    isValidDocRef: () => false,
    uploadAsset: async () => {
      throw new Error("test bridge 无资产");
    },
    removeAsset: async () => {},
    pickNasFiles: async () => {
      throw new Error("test bridge 无 NAS");
    },
    ocrAsset: async () => {
      throw new Error("test bridge 无 OCR");
    },
  } as unknown as StudyBridge;
}

function makePanel(id: string): HTMLElement {
  const el = document.createElement("div");
  el.id = id;
  el.className = "fn__flex-1";
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  unmount();
  document.body.innerHTML = "";
});

describe("mount 单实例（adopt）", () => {
  it("二次挂载迁入既有实例：文档内恒只有一个 .ai-study-app", () => {
    const hidden = makePanel("panel-hidden");
    const visible = makePanel("panel-visible");
    mount(hidden, makeBridge());
    expect(document.querySelectorAll(".ai-study-app")).toHaveLength(1);
    expect(hidden.querySelector(".ai-study-app")).not.toBeNull();

    // 模拟顶栏再开一个页签：内核对新面板再次触发 mount
    mount(visible, makeBridge());
    const roots = document.querySelectorAll(".ai-study-app");
    expect(roots).toHaveLength(1);
    // 实例被迁入新面板，旧面板变空
    expect(visible.querySelector(".ai-study-app")).not.toBeNull();
    expect(hidden.querySelector(".ai-study-app")).toBeNull();
  });

  it("同一面板重复挂载幂等（内核重放页签 init）", () => {
    const panel = makePanel("panel-1");
    mount(panel, makeBridge());
    const first = panel.querySelector(".ai-study-app");
    mount(panel, makeBridge());
    expect(document.querySelectorAll(".ai-study-app")).toHaveLength(1);
    expect(panel.querySelector(".ai-study-app")).toBe(first);
  });

  it("清理无 Vue 引用的僵尸实例（旧 bundle 残留 DOM 抢占 Teleport 目标）", () => {
    const zombie = document.createElement("div");
    zombie.className = "ai-study-app";
    zombie.textContent = "旧 bundle 残留";
    document.body.appendChild(zombie);
    const panel = makePanel("panel-1");
    mount(panel, makeBridge());
    const roots = document.querySelectorAll(".ai-study-app");
    expect(roots).toHaveLength(1);
    expect(roots[0].parentElement).toBe(panel);
  });

  it("unmount 后重新挂载创建新实例", () => {
    const panel = makePanel("panel-1");
    mount(panel, makeBridge());
    unmount();
    expect(document.querySelectorAll(".ai-study-app")).toHaveLength(0);
    mount(panel, makeBridge());
    expect(document.querySelectorAll(".ai-study-app")).toHaveLength(1);
    expect(panel.querySelector(".ai-study-app")).not.toBeNull();
  });
});
