import { createReadStream, promises as fsp } from "node:fs";
import { extname, join } from "node:path";
import { HTTPError, defineEventHandler, getQuery, sendStream, setHeader } from "h3";
import { assetDir } from "../../../utils/user-data";
import { getGatewayUser } from "../../../utils/gateway-user";

const MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};

// 应用资源文件（上传的原始资料）；仅限当前用户自己的资源目录
export default defineEventHandler(async (event) => {
  const user = getGatewayUser(event);
  const query = getQuery(event);
  const name = typeof query.name === "string" ? query.name : "";
  // 文件名形如 1730000000000-abcd1234.pdf：只允许安全字符，禁止路径穿越
  if (!/^\d{13}-[a-f0-9]{8}\.[a-z0-9]{1,8}$/i.test(name)) {
    throw new HTTPError({ status: 400, message: "资源名非法" });
  }
  const file = join(assetDir(user.uid), name);
  const stat = await fsp.stat(file).catch(() => null);
  if (!stat?.isFile()) {
    throw new HTTPError({ status: 404, message: "资源不存在" });
  }
  setHeader(event, "Content-Type", MIME[extname(name).toLowerCase()] || "application/octet-stream");
  setHeader(event, "Content-Length", String(stat.size));
  setHeader(event, "Cache-Control", "no-store");
  // h3@2：sendStream 是纯函数，必须把流 return 出去（await 不返回 = 空响应）
  return sendStream(event, createReadStream(file));
});
