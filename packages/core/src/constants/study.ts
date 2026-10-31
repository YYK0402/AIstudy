/** 单项学习时长封顶（秒）：单题/单次讲解/单条复习的展示时长超过该值按该值计，防止挂机时间计入学习时长 */
export const MAX_ITEM_STUDY_SEC = 600;

/** 计时秒数取非负整数并封顶 */
export function capStudySec(sec: number): number {
  return Math.min(MAX_ITEM_STUDY_SEC, Math.max(0, Math.round(sec)));
}
