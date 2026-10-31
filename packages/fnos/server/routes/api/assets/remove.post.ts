import { promises as fsp } from "node:fs";
import { join } from "node:path";
import { HTTPError, defineEventHandler, readValidatedBody } from "h3";
import { assetDir } from "../../../utils/user-data";
import { getGatewayUser } from "../../../utils/gateway-user";

// 删除应用资源文件；入参为资源 URL（bridge removeAsset 透传 assetPath）
export default defineEventHandler(async (event) => {
  const user = getGatewayUser(event);
  const body = await readValidatedBody(event, (d) => d) as { path?: string };
  if (typeof body?.path !== "string" || !body.path) {
    throw new HTTPError({ status: 400, message: "参数不完整" });
  }
  const fromUrl = new URL(body.path, "http://x").searchParams.get("name") ?? "";
  const name = fromUrl || body.path;
  if (!/^\d{13}-[a-f0-9]{8}\.[a-z0-9]{1,8}$/i.test(name)) {
    throw new HTTPError({ status: 400, message: "资源名非法" });
  }
  await fsp.unlink(join(assetDir(user.uid), name)).catch(() => {
    // 幂等：文件已不存在不算失败
  });
  return { ok: true };
});
