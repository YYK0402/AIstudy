import { defineEventHandler, getRequestURL, setHeader, setResponseHeader, setResponseStatus } from "h3";
import { readUiIndexHtml } from "../utils/ui-files";

// 网关入口 /app/ai-study/ → index.html（页面内相对路径资源自动落在网关前缀下）
export default defineEventHandler(async (event) => {
  const url = getRequestURL(event);
  // 桌面 iframe 以 /app/ai-study（无尾斜杠）打开，相对路径会解析出网关前缀，302 回规范地址
  if (!url.pathname.endsWith("/")) {
    setResponseStatus(event, 302);
    setHeader(event, "location", url.pathname + "/");
    return "";
  }
  const html = await readUiIndexHtml();
  setResponseHeader(event, "content-type", "text/html; charset=utf-8");
  return html;
});
