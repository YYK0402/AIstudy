import { HTTPError, defineEventHandler } from "h3";
import { GatewayError, getUserAccessibleFolders } from "../../../utils/trim-client";
import { getGatewayUser } from "../../../utils/gateway-user";

// 当前用户已授权给应用的目录（前端「NAS 资料」模块据此初始化；授权动作本身走前端 JS SDK pickUserFile）
export default defineEventHandler(async (event) => {
  const user = getGatewayUser(event);
  try {
    const paths = await getUserAccessibleFolders(Number(user.uid));
    return { paths };
  } catch (e) {
    throw new HTTPError({ status: e instanceof GatewayError ? 502 : 500, message: e instanceof Error ? e.message : String(e) });
  }
});
