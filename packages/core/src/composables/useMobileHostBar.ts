import { onBeforeUnmount, watch } from "vue";
import { useIsMobile } from "./useIsMobile";

type StyleLike = {
  setProperty(k: string, v: string): void;
  removeProperty(k: string): void;
};

/**
 * 纯函数：控制思源移动端宿主胶囊底栏（#mobileBottomBar）显隐。
 * 用 visibility 而非 display/opacity：宿主滚动显隐逻辑只写
 * --mobile-bar-translate-y / --mobile-bar-opacity 两个 inline 变量，
 * 不碰 visibility，两套机制互不干扰。
 */
export function applyHostBarVisibility(bar: { style: StyleLike }, visible: boolean): void {
  if (visible) bar.style.setProperty("visibility", "hidden");
  else bar.style.removeProperty("visibility");
}

/**
 * 插件 app 可见时隐藏思源移动端宿主底栏，切走/卸载时归还。
 * 思源切 tab 用 display:none（元素留在 DOM）→ IntersectionObserver 可判定；
 * 键盘弹起宿主自身让位，in-flow TabBar 自然上移，无需额外处理。
 * 卸载必须 teardown（disconnect + 移除 inline），否则宿主底栏永久消失。
 */
export function useMobileHostBar(target: () => HTMLElement | null): void {
  const { isMobile } = useIsMobile();
  let io: IntersectionObserver | null = null;
  let bar: HTMLElement | null = null;

  function teardown(): void {
    io?.disconnect();
    io = null;
    bar?.style.removeProperty("visibility");
    bar = null;
  }

  function setup(): void {
    const root = target();
    if (!root || typeof IntersectionObserver === "undefined") return;
    bar = document.getElementById("mobileBottomBar");
    if (!bar) return;
    io = new IntersectionObserver((entries) => {
      applyHostBarVisibility(bar!, entries.some((e) => e.isIntersecting));
    });
    io.observe(root);
    applyHostBarVisibility(bar, true);
  }

  watch(isMobile, (mobile) => {
    teardown();
    if (mobile) setup();
  }, { immediate: true });

  onBeforeUnmount(teardown);
}
