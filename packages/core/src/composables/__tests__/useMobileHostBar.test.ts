import { describe, expect, it } from "vitest";

function makeFakeBar() {
  const style: Record<string, string> = {};
  return {
    style,
    bar: {
      style: {
        setProperty: (k: string, v: string) => {
          style[k] = v;
        },
        removeProperty: (k: string) => {
          delete style[k];
        },
      },
    },
  };
}

describe("applyHostBarVisibility（纯函数）", () => {
  it("插件 app 可见：宿主底栏 visibility=hidden", async () => {
    const { applyHostBarVisibility } = await import("../useMobileHostBar");
    const { bar, style } = makeFakeBar();
    applyHostBarVisibility(bar, true);
    expect(style.visibility).toBe("hidden");
  });

  it("插件 app 不可见：移除 visibility，完全归还宿主", async () => {
    const { applyHostBarVisibility } = await import("../useMobileHostBar");
    const { bar, style } = makeFakeBar();
    style.visibility = "hidden";
    applyHostBarVisibility(bar, false);
    expect(style.visibility).toBeUndefined();
  });

  it("不触碰宿主滚动显隐用的 --mobile-bar-* 变量（两套机制互不干扰）", async () => {
    const { applyHostBarVisibility } = await import("../useMobileHostBar");
    const { bar, style } = makeFakeBar();
    style["--mobile-bar-opacity"] = "1";
    style["--mobile-bar-translate-y"] = "0px";
    applyHostBarVisibility(bar, true);
    applyHostBarVisibility(bar, false);
    expect(style["--mobile-bar-opacity"]).toBe("1");
    expect(style["--mobile-bar-translate-y"]).toBe("0px");
    expect(style.visibility).toBeUndefined();
  });
});
