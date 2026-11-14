/** 内核资源路径（assetPath）安全校验：只允许同源资源前缀——
 *  3.8.x 内核上传资产返回 `assets/<名>` 相对路径且经 HTTP `/assets/...` 提供（实测），
 *  兼容旧内核的 /data/... /storage/... 前缀；
 *  拒绝协议 URL（http: / javascript: 等）、协议相对 //host、相对 data/ 与路径穿越，
 *  防数据文件被污染后发起任意请求 */
import { getBridgeSafe } from "../bridge";

export function isSafeAssetPath(path: string): boolean {
  if (path.includes("..")) return false;
  return /^\/?assets\//.test(path) || /^\/(data|storage)\//.test(path);
}

/** 按宿主能力校验资源路径：宿主实现了 isValidAssetPath 则用之（飞牛资源 URL 形态不同），
 *  否则回退思源规则（含测试环境无 bridge 的场景） */
export function isValidAssetPath(path: string): boolean {
  const hostValidator = getBridgeSafe()?.isValidAssetPath;
  if (hostValidator) {
    try {
      return hostValidator(path);
    } catch {
      return false;
    }
  }
  return isSafeAssetPath(path);
}
