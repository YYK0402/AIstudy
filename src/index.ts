import { Plugin, showMessage, openTab, fetchSyncPost, getFrontend } from "siyuan";
import { createEmptyData } from "./data";
import type { AppData } from "./data";

const DATA_STORAGE = "data";
const TAB_TYPE = "study_tab";

// 暴露给前端（同渲染进程直接挂载）的数据/内核 API
interface StudyApi {
  getData(): AppData;
  saveData(data: AppData): Promise<{ code: number }>;
  querySql(stmt: string): Promise<unknown>;
}

declare global {
  interface Window {
    siyuanAiStudy: StudyApi;
    AiStudyApp: {
      mount(el: Element): void;
      unmount(): void;
    };
  }
}

export default class AiStudyPlugin extends Plugin {
  async onload() {
    this.exposeApi();
    await this.initData();
    this.registerTab();
  }

  async onLayoutReady() {
    this.addIcons(`<symbol id="iconAiStudy" viewBox="0 0 32 32">
<path d="M16 4l11 6v12l-11 6-11-6V10l11-6z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>
<path d="M16 12.5L27 6.5M16 12.5V28M16 12.5L5 6.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>
</symbol>`);

    this.addTopBar({
      icon: "iconAiStudy",
      title: this.displayName || "AI 智能学习",
      position: "right",
      callback: () => this.openStudyTab(),
    });
  }

  onunload() {}

  // 暴露数据与内核 API 到全局，供直接挂载的前端调用
  private exposeApi() {
    window.siyuanAiStudy = {
      getData: () => this.data[DATA_STORAGE] ?? createEmptyData(),
      saveData: async (data: AppData) => {
        this.data[DATA_STORAGE] = data;
        const res = await this.saveData(DATA_STORAGE, data);
        return { code: (res as { code?: number })?.code ?? 0 };
      },
      querySql: async (stmt: string) => {
        return await fetchSyncPost("/api/query/sql", { stmt });
      },
    };
  }

  // 注册自定义页签：动态加载前端 bundle 并直接 mount 到页签元素
  private registerTab() {
    const pluginName = this.name;
    this.addTab({
      type: TAB_TYPE,
      init() {
        const frontend = getFrontend();
        const isBrowser = frontend === "browser-desktop" || frontend === "browser-mobile";
        const dataDir = window.siyuan.config?.system?.dataDir;
        const src = isBrowser
          ? `/plugins/${pluginName}/web/index.js`
          : `file://${dataDir}/plugins/${pluginName}/web/index.js`;
        const script = document.createElement("script");
        script.src = src;
        script.onload = () => {
          window.AiStudyApp?.mount(this.element);
        };
        script.onerror = () => {
          console.error("[siyuan-ai-study] 加载前端资源失败:", src);
        };
        document.head.appendChild(script);
      },
    });
  }

  private openStudyTab() {
    try {
      openTab({
        app: this.app,
        custom: {
          id: this.name + TAB_TYPE,
          icon: "iconAiStudy",
          title: "AI 智能学习",
        },
      });
    } catch (error) {
      console.error("[siyuan-ai-study] 打开学习页签失败:", error);
      showMessage("打开 AI 学习页签失败，请查看控制台日志", 4000, "error");
    }
  }

  // 加载持久化数据；首次使用（文件不存在）时初始化为空结构
  private async initData() {
    try {
      const loaded = await this.loadData(DATA_STORAGE);
      if (!loaded || typeof loaded !== "object" || Object.keys(loaded).length === 0) {
        this.data[DATA_STORAGE] = createEmptyData();
        await this.saveData(DATA_STORAGE, this.data[DATA_STORAGE]);
      }
    } catch (error) {
      console.error("[siyuan-ai-study] 加载数据失败:", error);
      this.data[DATA_STORAGE] = createEmptyData();
    }
  }
}
