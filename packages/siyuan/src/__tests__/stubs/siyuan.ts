// 思源内核运行时桩（仅供单测）：siyuan npm 包是 types-only（运行时由思源内核注入），
// vitest 经 vitest.config.ts 的 alias 把 "siyuan" 解析到本文件。
// 只实现插件数据加载路径实际触碰的 API，其余为最小 no-op。
export class Plugin {
  app: unknown;
  name: string;
  displayName: string;
  data: Record<string, unknown>;
  constructor(options: { app: unknown; name: string; displayName?: string; i18n?: Record<string, unknown> }) {
    this.app = options.app;
    this.name = options.name;
    this.displayName = options.displayName ?? "";
    this.data = {};
  }
  /** 测试中按实例替换为 vi.fn 断言写盘；默认成功 */
  async saveData(_storageName: string, _content: unknown): Promise<{ code: number }> {
    return { code: 0 };
  }
  async loadData(storageName: string): Promise<unknown> {
    return this.data[storageName] ?? null;
  }
  async onload(): Promise<void> {}
  async onunload(): Promise<void> {}
}

export function showMessage(_text: string, _timeout?: number, _type?: "info" | "error", _id?: string): void {}

export function openTab(_options: unknown): void {}

export async function fetchSyncPost(_url: string, _payload?: unknown): Promise<unknown> {
  return { code: 0 };
}

export function getFrontend(): "desktop" | "mobile" {
  return "desktop";
}

export function getAllModels(): { models: unknown[] } {
  return { models: [] };
}

export class Dialog {
  element: { querySelector: () => null } = { querySelector: () => null };
  destroy(): void {}
}
