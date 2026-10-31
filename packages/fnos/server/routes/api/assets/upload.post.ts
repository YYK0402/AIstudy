import { randomUUID } from "node:crypto";
import { promises as fsp } from "node:fs";
import { join } from "node:path";
import { HTTPError, defineEventHandler, readMultipartFormData } from "h3";
import { assetDir } from "../../../utils/user-data";
import { getGatewayUser } from "../../../utils/gateway-user";

// 上传原始资料（重新解析用）；存 {TRIM_PKGVAR}/assets/{uid}/，返回应用内资源 URL
export default defineEventHandler(async (event) => {
  const user = getGatewayUser(event);
  const parts = await readMultipartFormData(event);
  const file = parts?.[0];
  if (!file?.filename) {
    throw new HTTPError({ status: 400, message: "缺少文件" });
  }
  const ext = (file.filename.match(/\.[^.]+$/)?.[0] || "").toLowerCase();
  if (!/\.[a-z0-9]{1,8}$/.test(ext) || ext.length > 10) {
    throw new HTTPError({ status: 400, message: "文件扩展名非法" });
  }
  const dir = assetDir(user.uid);
  const name = `${Date.now()}-${randomUUID().slice(0, 8)}${ext}`;
  const dest = join(dir, name);
  const tmp = join(dir, `.tmp-${randomUUID()}`);
  await fsp.writeFile(tmp, file.data);
  await fsp.rename(tmp, dest);
  return { url: `api/assets/file?name=${encodeURIComponent(name)}` };
});
