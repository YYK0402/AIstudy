import { ref, type Ref } from "vue";

// 断点：思源手机 webview ~375-430px；桌面窄页签 1127px 不误触发
const MOBILE_QUERY = "(max-width: 768px)";

// 模块级单例：所有消费方（App/Topbar/Home/TabBar）共享一个 matchMedia 实例与同一响应式状态
let isMobile: Ref<boolean> | null = null;

export function useIsMobile(): { isMobile: Ref<boolean> } {
  if (isMobile == null) {
    const mq = window.matchMedia(MOBILE_QUERY);
    isMobile = ref(mq.matches);
    mq.addEventListener("change", (e) => {
      isMobile!.value = e.matches;
    });
  }
  return { isMobile };
}
