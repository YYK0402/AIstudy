import { Plugin, showMessage, openTab, fetchSyncPost, getFrontend } from "siyuan";
import { createEmptyData } from "./data";
import type { AppData, CallLog } from "./data";

const DATA_STORAGE = "data";
const TAB_TYPE = "study_tab";

interface CallAiMessage {
  role: string;
  content: string;
}

interface CallAiInput {
  providerId: number;
  modelId: string;
  messages: CallAiMessage[];
  taskKey: string;
}

interface CallAiResult {
  content: string;
  tokenIn: number;
  tokenOut: number;
}

interface TestProviderResult {
  ok: boolean;
  message: string;
}

// 暴露给前端（同渲染进程直接挂载）的数据/内核 API
interface StudyApi {
  getData(): AppData;
  saveData(data: AppData): Promise<{ code: number }>;
  querySql(stmt: string): Promise<unknown>;
  callAi(input: CallAiInput): Promise<CallAiResult>;
  testProvider(providerId: number): Promise<TestProviderResult>;
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

interface ForwardProxyResponse {
  code: number;
  msg: string;
  data: {
    url: string;
    status: number;
    contentType: string;
    body: string;
    bodyEncoding: string;
    headers: Record<string, Array<string> | null> | null;
  } | null;
}

// 经思源内核 forwardProxy 转发外部请求（绕过 CORS，timeout 单位为毫秒）
async function forwardProxyRequest(input: {
  url: string;
  method: string;
  headers: Array<Record<string, string>>;
  payload?: string;
  timeout?: number;
}): Promise<ForwardProxyResponse> {
  return (await fetchSyncPost("/api/network/forwardProxy", {
    url: input.url,
    method: input.method,
    headers: input.headers,
    payload: input.payload ?? "",
    contentType: "application/json",
    timeout: input.timeout ?? 60000,
  })) as ForwardProxyResponse;
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
      callAi: async (input: CallAiInput) => {
        return await this.handleCallAi(input);
      },
      testProvider: async (providerId: number) => {
        return await this.handleTestProvider(providerId);
      },
    };
  }

  private getData(): AppData {
    return this.data[DATA_STORAGE] ?? createEmptyData();
  }

  private async persist(data: AppData) {
    this.data[DATA_STORAGE] = data;
    await this.saveData(DATA_STORAGE, data);
  }

  private appendLog(
    data: AppData,
    taskKey: string,
    providerName: string,
    modelName: string,
    tokenIn: number,
    tokenOut: number,
    status: string,
    errorMsg: string,
  ) {
    const log: CallLog = {
      id: data.logs.reduce((max, l) => Math.max(max, l.id), 0) + 1,
      taskKey,
      providerName,
      modelName,
      tokenIn,
      tokenOut,
      status,
      errorMsg,
      createTime: new Date().toISOString(),
    };
    data.logs.push(log);
  }

  private async handleCallAi(input: CallAiInput): Promise<CallAiResult> {
    const data = this.getData();
    const provider = data.providers.find((p) => p.id === input.providerId);
    if (!provider) {
      throw new Error("服务商不存在");
    }
    const url = provider.baseUrl.replace(/\/$/, "") + "/chat/completions";
    const payload = {
      model: input.modelId,
      messages: input.messages,
    };
    try {
      const res = await forwardProxyRequest({
        url,
        method: "POST",
        headers: [
          { Authorization: `Bearer ${provider.apiKey}` },
          { "Content-Type": "application/json" },
        ],
        payload: JSON.stringify(payload),
        timeout: (provider.timeout || 60) * 1000,
      });
      if (res.code !== 0 || !res.data) {
        throw new Error(`forwardProxy 失败: ${res.msg}`);
      }
      if (res.data.status < 200 || res.data.status >= 300) {
        throw new Error(`LLM 请求失败: HTTP ${res.data.status} ${res.data.body}`);
      }
      const body = JSON.parse(res.data.body) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const content = body.choices?.[0]?.message?.content ?? "";
      const tokenIn = body.usage?.prompt_tokens ?? 0;
      const tokenOut = body.usage?.completion_tokens ?? 0;
      this.appendLog(data, input.taskKey, provider.name, input.modelId, tokenIn, tokenOut, "success", "");
      await this.persist(data);
      return { content, tokenIn, tokenOut };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.appendLog(data, input.taskKey, provider.name, input.modelId, 0, 0, "error", message);
      await this.persist(data);
      throw error;
    }
  }

  private async handleTestProvider(providerId: number): Promise<TestProviderResult> {
    const data = this.getData();
    const provider = data.providers.find((p) => p.id === providerId);
    if (!provider) {
      return { ok: false, message: "服务商不存在" };
    }
    const url = provider.baseUrl.replace(/\/$/, "") + "/models";
    try {
      const res = await forwardProxyRequest({
        url,
        method: "GET",
        headers: [{ Authorization: `Bearer ${provider.apiKey}` }],
        timeout: 15000,
      });
      if (res.code !== 0 || !res.data) {
        return { ok: false, message: res.msg };
      }
      if (res.data.status >= 200 && res.data.status < 300) {
        return { ok: true, message: `连接成功（HTTP ${res.data.status}）` };
      }
      return { ok: false, message: `HTTP ${res.data.status}: ${res.data.body.slice(0, 200)}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, message };
    }
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
