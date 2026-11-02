/**
 * 前端 bundle 加载 → 面板挂载队列（桌面 custom 页签与移动端全屏 Dialog 共用）。
 *
 * 解决的问题：
 * - 内核重放页签 init / 插件重载后 bundle 已加载 → 直接挂载，不重复注入 script
 *   （二次求值会产生两套独立模块状态互相 adopt，实例落到隐藏面板、可见面板空白）
 * - 并发 init（bundle 尚在加载）→ 后续面板排队，首份 script 完成后统一挂载
 * - 下载成功但求值失败 / 网络失败 → 所有面板（含排队）渲染可见错误而非静默白屏
 */
export interface FrontendLoaderDeps<P> {
  /** bundle 是否已求值（window.AiStudyApp 是否存在） */
  isLoaded(): boolean;
  /** 注入 script；src 由本类生成（带时间戳防缓存），成败回调由内核 script 事件触发 */
  injectScript(src: string, onSuccess: () => void, onFailure: (src: string) => void): void;
  /** 挂载成功：把前端 app 挂到面板 */
  mount(panel: P): void;
  /** 下载成功但求值失败（AiStudyApp 未挂上） */
  reportEvalError(panel: P): void;
  /** 网络失败（src 为注入时的 script 地址，用于错误提示） */
  reportNetworkError(panel: P, src: string): void;
}

export class FrontendLoader<P> {
  private loading = false;
  private pending: P[] = [];

  constructor(private readonly opts: FrontendLoaderDeps<P>, private readonly pluginName: string) {}

  load(panel: P): void {
    if (this.opts.isLoaded()) {
      this.mountOrError(panel);
      return;
    }
    if (this.loading) {
      this.pending.push(panel);
      return;
    }
    this.loading = true;
    // 相对路径 /plugins/... 解析到内核 HTTP（桌面 / 移动端 petal 页面本身都由内核 HTTP 加载；
    // iOS WKWebView 禁 http 页加载 file:// 导致白屏，故不区分原生桌面走 file://）
    const src = `/plugins/${this.pluginName}/web/index.js?v=${Date.now()}`;
    this.opts.injectScript(
      src,
      () => {
        this.loading = false;
        for (const p of [panel, ...this.pending.splice(0)]) this.mountOrError(p);
      },
      (failedSrc) => {
        this.loading = false;
        for (const p of [panel, ...this.pending.splice(0)]) this.opts.reportNetworkError(p, failedSrc);
      },
    );
  }

  private mountOrError(panel: P): void {
    if (this.opts.isLoaded()) this.opts.mount(panel);
    else this.opts.reportEvalError(panel);
  }
}
