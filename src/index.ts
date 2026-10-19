import { Plugin, showMessage, openTab } from "siyuan";
import { registerBridge } from "./bridge";
import { createEmptyData } from "./data";

const DATA_STORAGE = "data";
const TAB_TYPE = "study_tab";

export default class AiStudyPlugin extends Plugin {
  async onload() {
    registerBridge(this);
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

  // 注册自定义页签：以 iframe 加载打包后的前端（在思源窗口内部运行）
  private registerTab() {
    const pluginName = this.name;
    this.addTab({
      type: TAB_TYPE,
      init() {
        const dataDir = window.siyuan.config?.system?.dataDir;
        const iframe = document.createElement("iframe");
        iframe.src = `file://${dataDir}/plugins/${pluginName}/web/index.html`;
        iframe.style.cssText = "width:100%;height:100%;border:none;display:block;";
        this.element.appendChild(iframe);
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
