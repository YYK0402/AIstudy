import { createReadStream, promises as fsp } from "node:fs";
import { extname } from "node:path";
import { HTTPError, defineEventHandler, getQuery, sendStream, setHeader } from "h3";
import { assertPathAccess } from "../../../utils/nas-access";
import { GatewayError } from "../../../utils/trim-client";
import { getGatewayUser } from "../../../utils/gateway-user";

const MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".markdown": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

// 流式读取已授权文件（前端转 File 对象后走既有解析管线）
export default defineEventHandler(async (event) => {
  const user = getGatewayUser(event);
  const query = getQuery(event);
  const path = typeof query.path === "string" ? query.path : "";
  if (!path.startsWith("/") || path.length > 1024) {
    throw new HTTPError({ status: 400, message: "path 非法" });
  }
  try {
    await assertPathAccess(user.uid, path);
  } catch (e) {
    throw new HTTPError({ status: e instanceof GatewayError ? 502 : 403, message: e instanceof Error ? e.message : "无权访问" });
  }
  const stat = await fsp.stat(path).catch(() => null);
  if (!stat?.isFile()) {
    throw new HTTPError({ status: 404, message: "文件不存在" });
  }
  setHeader(event, "Content-Type", MIME[extname(path).toLowerCase()] || "application/octet-stream");
  setHeader(event, "Content-Length", String(stat.size));
  setHeader(event, "Cache-Control", "no-store");
  // h3@2：sendStream 是纯函数，必须把流 return 出去（await 不返回 = 空响应）
  return sendStream(event, createReadStream(path));
});
