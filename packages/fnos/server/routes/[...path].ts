import { HTTPError, defineEventHandler, getRequestURL, setHeader, setResponseHeader, setResponseStatus } from "h3";
import { extname } from "node:path";
import { isAssetRequest, readUiFile, readUiIndexHtml, stripGatewayPrefix } from "../utils/ui-files";

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8"
};

// 兜底路由：托管 UI 静态文件；未知资源 404，其余路径回退 index.html
export default defineEventHandler(async (event) => {
  const url = getRequestURL(event);
  const appPath = stripGatewayPrefix(url.pathname);

  if (appPath === "/" && !url.pathname.endsWith("/")) {
    setResponseStatus(event, 302);
    setHeader(event, "location", url.pathname + "/");
    return "";
  }

  if (appPath.startsWith("/api/") || appPath === "/healthz") {
    throw new HTTPError({ status: 404, message: "Not Found" });
  }

  const file = await readUiFile(appPath);
  if (!file) {
    if (isAssetRequest(appPath)) {
      throw new HTTPError({ status: 404, message: "Not Found" });
    }
    const html = await readUiIndexHtml();
    setResponseHeader(event, "content-type", "text/html; charset=utf-8");
    return html;
  }

  const contentType = contentTypes[extname(appPath).toLowerCase()] || "application/octet-stream";
  setResponseHeader(event, "content-type", contentType);
  return file;
});
