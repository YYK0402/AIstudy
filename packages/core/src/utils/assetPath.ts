/** 内核资源路径（assetPath）安全校验：只允许同源相对路径（/data/... /storage/...），
 *  拒绝协议 URL（http: / javascript: 等）与路径穿越，防数据文件被污染后发起任意请求 */
export function isSafeAssetPath(path: string): boolean {
  return /^\/(data|storage)\//.test(path) && !path.includes("..");
}
