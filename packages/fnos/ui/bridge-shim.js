/* AI 智能学习 · 飞牛端宿主桥接（StudyBridge 的 fetch 实现，构建时内联进 index.html）
 * 契约见 packages/core/src/bridge/types.ts；数据由页面加载器预先拉取后注入（getData 为同步契约）。
 */
(() => {
  "use strict";
  const instanceId = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  let data = null;

  // ===== 极简 toast（showMessage 实现） =====
  let toastTimer = 0;
  const style = document.createElement("style");
  style.textContent =
    "#ai-study-toast{position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:9999;padding:8px 16px;border-radius:8px;color:#fff;font-size:13px;max-width:80vw;word-break:break-all;box-shadow:0 4px 12px rgba(0,0,0,.25);display:none}";
  document.head.appendChild(style);
  function showMessage(message, timeout, type) {
    let el = document.getElementById("ai-study-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "ai-study-toast";
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.style.background = type === "error" ? "#c0392b" : "#2c3e50";
    el.style.display = "block";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.style.display = "none";
    }, timeout || 4000);
  }

  // ===== REST 封装（同域，统一网关会话自动带 cookie） =====
  async function req(path, options) {
    const res = await fetch(path, options);
    if (!res.ok) {
      let msg = "HTTP " + res.status;
      try {
        const j = await res.json();
        msg = j.message || j.error || j.msg || msg;
      } catch {
        /* 非 JSON 错误体 */
      }
      throw new Error(msg);
    }
    return res.json();
  }
  const json = (body) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  const NO_DOCS = "当前环境不支持文档落库功能";

  // ===== 桌面宿主桥预热 =====
  // 真机事实：桌面端 penpal 宿主桥注册有延迟（全新桌面秒级就绪，既有桌面可能数十秒后才响应握手）。
  // SDK 内部探测窗口仅 1.5s，且兜底握手无超时并被模块级缓存——首调撞竞态会挂死整个页面会话。
  // 故页面加载即发裸 SYN 轮询，收到 synAck 回 ack 完成握手；pickNasFiles 调 SDK 前先等就绪。
  const hostPrewarm = (() => {
    const inIframe = window.parent !== window;
    let ready = false;
    const waiters = [];
    let timer = 0;
    if (inIframe) {
      const probe = () => {
        try {
          window.parent.postMessage({ penpal: "syn" }, window.location.origin);
        } catch {
          /* 宿主不可达时忽略 */
        }
      };
      probe();
      timer = setInterval(probe, 2000);
      window.addEventListener("message", (e) => {
        if (ready || !e.data || e.data.penpal !== "synAck") return;
        ready = true;
        clearInterval(timer);
        try {
          window.parent.postMessage(
            { penpal: "ack", methodNames: [], config: { postmateVersion: "0.1.5" } },
            window.location.origin
          );
        } catch {
          /* 宿主不可达时忽略 */
        }
        for (const w of waiters.splice(0)) w(true);
      });
      // 10 分钟仍未就绪说明该桌面会话的宿主桥异常，停止轮询避免无意义噪音
      setTimeout(() => {
        if (!ready) clearInterval(timer);
      }, 10 * 60 * 1000);
    }
    return {
      isReady: () => ready,
      wait(timeoutMs) {
        if (ready) return Promise.resolve(true);
        if (!inIframe) return Promise.resolve(false);
        return new Promise((resolve) => {
          const done = (ok) => {
            const i = waiters.indexOf(done);
            if (i >= 0) waiters.splice(i, 1);
            resolve(ok);
          };
          setTimeout(() => done(ready), timeoutMs);
          waiters.push(done);
        });
      },
    };
  })();

  window.__AI_STUDY_BRIDGE__ = {
    pluginInstanceId: instanceId,
    capabilities: { ocr: "none", nasFiles: true, docs: "none" },
    getData: () => {
      if (!data) throw new Error("数据尚未加载完成");
      return data;
    },
    saveData: (d) => req("api/data", json(d)),
    callAi: (input) => req("api/ai", json(input)),
    cancelAiCall: (taskKey, scope) => {
      req("api/ai/cancel", json({ taskKey, scope })).catch(() => {});
    },
    testProvider: (providerId) => req("api/ai/test", json({ providerId })),
    listModels: (providerId) => req("api/ai/models", json({ providerId })),
    showMessage,
    ensureFolder: async () => {
      throw new Error(NO_DOCS);
    },
    createDoc: async () => {
      throw new Error(NO_DOCS);
    },
    removeDoc: async () => {
      throw new Error(NO_DOCS);
    },
    updateDoc: async () => {
      throw new Error(NO_DOCS);
    },
    getDocMarkdown: async () => null,
    docExists: async () => false,
    moveDoc: async () => {
      throw new Error(NO_DOCS);
    },
    renameDoc: async () => {
      throw new Error(NO_DOCS);
    },
    isValidDocRef: () => false,
    uploadAsset: async (file) => {
      const fd = new FormData();
      fd.append("file", file);
      const r = await req("api/assets/upload", { method: "POST", body: fd });
      return r.url;
    },
    removeAsset: async (path) => {
      await req("api/assets/remove", json({ path }));
    },
    // ===== NAS 文件选择（@trimjs/web-app SDK，build-ui.mjs 打包为 assets/trim-sdk.js） =====
  // 桌面 iframe 内 SDK 与宿主 parent 窗口 postMessage 握手；独立浏览器无宿主，直接引导
  pickNasFiles: async (accept) => {
      if (window.parent === window) {
        throw new Error("NAS 文件选择需在飞牛桌面内使用，请从飞牛桌面打开本应用");
      }
      if (!window.__TRIM_SDK__) {
        throw new Error("飞牛文件选择组件未加载，请刷新页面重试");
      }
      // 等宿主桥就绪（页面加载时已启动预热；通常此时已就绪，立即返回）
      const t0 = Date.now();
      if (!(await hostPrewarm.wait(20000))) {
        throw new Error("桌面文件选择桥接未就绪（已等待 " + Math.round((Date.now() - t0) / 1000) + " 秒），请重试或重启桌面后打开本应用");
      }
      const sdk = new window.__TRIM_SDK__.TrimApp();
      const params = { directory: false, title: "选择学习资料", okText: "确认" };
      if (accept && accept.length) params.accept = accept;
      let result;
      try {
        result = await sdk.pickUserFile(params);
      } catch (e) {
        throw new Error("无法打开飞牛文件选择器：" + (e && e.message ? e.message : e));
      }
      if (result === undefined) return []; // 用户取消
      if (!result || result.code !== 0) {
        throw new Error((result && result.msg) || "文件授权失败");
      }
      return (result.data || []).map((p) => ({
        path: p,
        url: "api/nas/file?path=" + encodeURIComponent(p),
        name: p.split("/").pop() || p
      }));
    },
  };
  // 页面加载器拉取数据后调用
  window.__AI_STUDY_SET_DATA__ = (d) => {
    data = d;
  };
})();
