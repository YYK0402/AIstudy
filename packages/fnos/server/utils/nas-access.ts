import { resolve } from "node:path";
import { checkUserAcl, getUserAccessibleFolders, type UserAcl } from "./trim-client";

/**
 * 路径安全：用户只能访问自己授权过的目录/文件。
 * 目录列表场景：path 必须落在某条已授权目录内（或为其自身）；
 * 文件读取场景：pickUserFile 直接授权的文件路径，按 ACL 校验放行。
 */
export async function assertPathAccess(uid: string, requestedPath: string): Promise<void> {
  const numUid = Number(uid);
  if (!Number.isInteger(numUid) || numUid <= 0) {
    throw new Error("用户上下文异常");
  }
  const target = resolve(requestedPath);
  const folders = await getUserAccessibleFolders(numUid);
  const underFolder = folders.some((f) => {
    const root = resolve(f);
    return target === root || target.startsWith(root.endsWith("/") ? root : root + "/");
  });
  if (underFolder) {
    return;
  }
  // 不在授权目录内：仅当该路径本身被 checkUserACL 判定当前用户可读时放行（pickUserFile 文件授权）
  const acl = await checkUserAcl(numUid, [target]);
  const entry: UserAcl | undefined = acl.get(target);
  if (entry?.readable) {
    return;
  }
  throw new Error("无权访问该路径（未授权或当前用户无读取权限）");
}

/** 目录列表前校验：路径必须位于已授权目录内（不允许借文件 ACL 钻到授权范围外） */
export async function assertFolderAccess(uid: string, requestedPath: string): Promise<void> {
  const numUid = Number(uid);
  if (!Number.isInteger(numUid) || numUid <= 0) {
    throw new Error("用户上下文异常");
  }
  const target = resolve(requestedPath);
  const folders = await getUserAccessibleFolders(numUid);
  const ok = folders.some((f) => {
    const root = resolve(f);
    return target === root || target.startsWith(root.endsWith("/") ? root : root + "/");
  });
  if (!ok) {
    throw new Error("该目录未授权给应用");
  }
}
