import { promises as fsp } from "node:fs";
import { join } from "node:path";
import { HTTPError, defineEventHandler, readValidatedBody } from "h3";
import { assertFolderAccess } from "../../../utils/nas-access";
import { GatewayError } from "../../../utils/trim-client";
import { getGatewayUser } from "../../../utils/gateway-user";

interface NasEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  mtime: number;
}

// 列出已授权目录内容（前端 NAS 文件选择器浏览用）
export default defineEventHandler(async (event) => {
  const user = getGatewayUser(event);
  const body = await readValidatedBody(event, (d) => d) as { path?: string };
  if (typeof body?.path !== "string" || !body.path.startsWith("/")) {
    throw new HTTPError({ status: 400, message: "path 非法" });
  }
  try {
    await assertFolderAccess(user.uid, body.path);
  } catch (e) {
    throw new HTTPError({ status: e instanceof GatewayError ? 502 : 403, message: e instanceof Error ? e.message : "无权访问" });
  }
  let entries: NasEntry[];
  try {
    const files = await fsp.readdir(body.path, { withFileTypes: true });
    entries = await Promise.all(
      files.map(async (f) => {
        const full = join(body.path, f.name);
        let size = 0;
        let mtime = 0;
        if (!f.isDirectory()) {
          const st = await fsp.stat(full).catch(() => null);
          if (st) {
            size = st.size;
            mtime = st.mtimeMs;
          }
        }
        return { name: f.name, path: full, isDir: f.isDirectory(), size, mtime };
      }),
    );
  } catch (e) {
    throw new HTTPError({ status: 500, message: `读取目录失败: ${e instanceof Error ? e.message : String(e)}` });
  }
  // 目录在前，按名称自然排序（数字感知，与前端资料列表一致）
  entries.sort((a, b) =>
    a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name, "zh-CN", { numeric: true }),
  );
  return { path: body.path, entries };
});
