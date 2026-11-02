import { describe, expect, it } from "vitest";
import { FrontendLoader } from "../frontendLoader";

interface Harness {
  loader: FrontendLoader<string>;
  panels: string[];
  errors: Array<{ panel: string; kind: "eval" | "network"; src: string }>;
  injects: string[];
  fireLoad: () => void;
  fireError: () => void;
  setLoaded: (v: boolean) => void;
}

function makeHarness(evalFails = false): Harness {
  let loaded = false;
  const panels: string[] = [];
  const errors: Harness["errors"] = [];
  const injects: string[] = [];
  let pendingLoad: (() => void) | null = null;
  let pendingError: ((src: string) => void) | null = null;
  const loader = new FrontendLoader<string>({
    isLoaded: () => loaded,
    injectScript: (src, onSuccess, onFailure) => {
      injects.push(src);
      pendingLoad = onSuccess;
      pendingError = onFailure;
    },
    mount: (panel) => panels.push(panel),
    reportEvalError: (panel) => errors.push({ panel, kind: "eval", src: "" }),
    reportNetworkError: (panel, src) => errors.push({ panel, kind: "network", src }),
  }, "AIstudy");
  return {
    loader,
    panels,
    errors,
    injects,
    fireLoad: () => {
      loaded = !evalFails;
      pendingLoad?.();
    },
    fireError: () => {
      const src = injects[injects.length - 1] ?? "";
      pendingError?.(src);
    },
    setLoaded: (v) => {
      loaded = v;
    },
  };
}

describe("FrontendLoader（bundle 加载 → 面板挂载队列）", () => {
  it("bundle 已加载：直接挂载，不注入 script", () => {
    const h = makeHarness();
    h.setLoaded(true);
    h.loader.load("panel-a");
    expect(h.panels).toEqual(["panel-a"]);
    expect(h.injects).toEqual([]);
  });

  it("首次加载：注入 script，成功后挂载", () => {
    const h = makeHarness();
    h.loader.load("panel-a");
    expect(h.panels).toEqual([]);
    expect(h.injects).toHaveLength(1);
    h.fireLoad();
    expect(h.panels).toEqual(["panel-a"]);
  });

  it("并发加载：第二个面板排队，成功后按先来后到全部挂载", () => {
    const h = makeHarness();
    h.loader.load("panel-a");
    h.loader.load("panel-b");
    expect(h.injects).toHaveLength(1); // 只注入一份 script
    expect(h.panels).toEqual([]);
    h.fireLoad();
    expect(h.panels).toEqual(["panel-a", "panel-b"]);
  });

  it("下载成功但求值失败：所有面板报 eval 错误，不挂载", () => {
    const h = makeHarness(true);
    h.loader.load("panel-a");
    h.loader.load("panel-b");
    h.fireLoad();
    expect(h.panels).toEqual([]);
    expect(h.errors.map((e) => [e.panel, e.kind])).toEqual([
      ["panel-a", "eval"],
      ["panel-b", "eval"],
    ]);
  });

  it("网络失败：所有面板报 network 错误（含注入的 src）", () => {
    const h = makeHarness();
    h.loader.load("panel-a");
    h.loader.load("panel-b");
    h.fireError();
    expect(h.panels).toEqual([]);
    expect(h.errors).toHaveLength(2);
    expect(h.errors.every((e) => e.kind === "network")).toBe(true);
    expect(h.errors[0].src).toBe(h.injects[0]);
  });

  it("失败后再次 load：可重新发起加载", () => {
    const h = makeHarness();
    h.loader.load("panel-a");
    h.fireError();
    h.loader.load("panel-c");
    expect(h.injects).toHaveLength(2);
    h.fireLoad();
    expect(h.panels).toContain("panel-c");
  });
});
