import { defineEventHandler, readValidatedBody, setResponseStatus } from "h3";
import type { AppData } from "../../../../core/src/types/appData";
import { getGatewayUser } from "../../utils/gateway-user";
import { saveUserData } from "../../utils/user-data";

export default defineEventHandler(async (event) => {
  const user = getGatewayUser(event);
  const body = await readValidatedBody(event, (d) => d) as AppData;
  if (!body || typeof body !== "object" || !Array.isArray(body.courses)) {
    return setResponseStatus(event, 400, { code: -1, msg: "数据格式非法" });
  }
  try {
    saveUserData(user.uid, body);
  } catch (e) {
    return setResponseStatus(event, 500, { code: -1, msg: e instanceof Error ? e.message : "保存失败" });
  }
  // 单文件全量存储：每次保存都视为全局变化（core 据此全量刷新）
  return { code: 0, msg: "", dirty: { global: true, courseIds: [] as number[] } };
});
