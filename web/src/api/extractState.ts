// 抽取并发锁：模块级状态不受组件卸载/重挂载影响，防止同一资料被两个抽取循环并发处理
const extractingMaterialIds = new Set<number>();
let fullExtractInProgress = false;

export function isExtractingMaterial(materialId: number): boolean {
  return extractingMaterialIds.has(materialId);
}

export function isFullExtracting(): boolean {
  return fullExtractInProgress;
}

/** 任一抽取（单资料 / 全量）是否进行中 */
export function hasActiveExtract(): boolean {
  return fullExtractInProgress || extractingMaterialIds.size > 0;
}

/** 尝试进入全量重抽；任一抽取进行中则拒绝（返回 false） */
export function beginFullExtract(): boolean {
  if (hasActiveExtract()) return false;
  fullExtractInProgress = true;
  return true;
}

export function endFullExtract(): void {
  fullExtractInProgress = false;
}

export function markMaterialExtracting(materialId: number): void {
  extractingMaterialIds.add(materialId);
}

export function unmarkMaterialExtracting(materialId: number): void {
  extractingMaterialIds.delete(materialId);
}
