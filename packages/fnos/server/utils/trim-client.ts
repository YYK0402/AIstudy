import http from "node:http";

// 飞牛开放 API：应用服务端经 Unix Socket 调用（token 由系统注入 TRIM_API_TOKEN，
// 每次调用从当前环境变量读取，不持久化、不暴露前端）
const SOCKET_PATH = process.env.TRIM_OPEN_GATEWAY_SOCKET || "/var/run/trim_open_gateway_apiscope.socket";
const APP_NAME = process.env.APP_NAME || "ai-study";

export interface TrimResponse<T> {
  reqId?: string;
  code: number;
  msg?: string;
  data: T;
}

// 网关/开放 API 层故障（区别于业务权限拒绝），路由据此返回 502 而非 403
export class GatewayError extends Error {}

export function trimApi<T>(req: string, data: Record<string, unknown>): Promise<TrimResponse<T>> {
  const token = process.env.TRIM_API_TOKEN;
  if (!token) {
    return Promise.reject(new GatewayError("飞牛网关令牌缺失（TRIM_API_TOKEN），请确认应用经系统服务启动"));
  }
  const body = JSON.stringify({ reqId: String(Date.now()), req, appName: APP_NAME, data });
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        socketPath: SOCKET_PATH,
        host: "localhost",
        path: "/api/v1/trimapp",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          let json: TrimResponse<T>;
          try {
            json = JSON.parse(Buffer.concat(chunks).toString("utf-8")) as TrimResponse<T>;
          } catch {
            reject(new GatewayError(`飞牛开放 API ${req} 响应解析失败`));
            return;
          }
          if (json.code !== 0) {
            reject(new GatewayError(`飞牛开放 API ${req} 失败: ${json.msg || "未知错误"}`));
            return;
          }
          resolve(json);
        });
      },
    );
    request.on("error", (e) => reject(new GatewayError(`连接飞牛网关服务失败: ${e.message}`)));
    request.setTimeout(10_000, () => request.destroy(new GatewayError(`飞牛开放 API ${req} 请求超时`)));
    request.end(body);
  });
}

/** 当前用户授权给本应用的目录路径（页面刷新/服务重启后同步授权状态） */
export async function getUserAccessibleFolders(uid: number): Promise<string[]> {
  const res = await trimApi<{ paths: string[] }>("trim.file.getUserAccessibleFolders", { uid });
  return res.data?.paths ?? [];
}

export interface UserAcl {
  path: string;
  readable: boolean;
  writable: boolean;
  deletable: boolean;
}

/** 检查用户对路径的权限（返回前必查：授权目录 ≠ 绕过当前用户文件权限） */
export async function checkUserAcl(uid: number, paths: string[]): Promise<Map<string, UserAcl>> {
  const res = await trimApi<UserAcl[]>("trim.file.checkUserACL", { uid, path: paths });
  return new Map((res.data ?? []).map((a) => [a.path, a]));
}
