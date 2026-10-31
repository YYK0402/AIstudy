import { HTTPError, getHeader, type H3Event } from "h3";

export interface GatewayUser {
  uid: string;
  username: string | null;
  isAdmin: boolean;
}

/**
 * 解析当前使用用户。
 * 生产：统一网关校验 NAS 会话后注入 X-Trim-* 头，仅当进程监听网关 Socket 时可信。
 * 本地开发（未设 FNOS_SOCKET_PATH）：DEV_UID 兜底，便于 curl 验证。
 */
export function getGatewayUser(event: H3Event): GatewayUser {
  if (process.env.FNOS_SOCKET_PATH) {
    const uid = getHeader(event, "x-trim-userid") || null;
    if (!uid) {
      throw new HTTPError({ status: 401, message: "未登录：请通过飞牛统一网关访问" });
    }
    return {
      uid,
      username: getHeader(event, "x-trim-username") || null,
      isAdmin: getHeader(event, "x-trim-isadmin") === "true",
    };
  }
  return { uid: process.env.DEV_UID || "1000", username: "dev", isAdmin: true };
}
