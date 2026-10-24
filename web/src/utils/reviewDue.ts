// T3.4 复习排期到期判断（知识点/题目/闪卡三类触点共用）
// 口径：dueTime 不晚于今天（本地 YYYY-MM-DD 字符串可比），且触点引用有效（悬挂引用不浮现）
export interface ReviewScheduleDueLike {
  dueTime: string;
  kpId: number | null;
  qId: number | null;
  /** 闪卡触点（T3.4）；旧数据无此字段（undefined） */
  cardId?: number | null;
}

export function isReviewScheduleDue(
  s: ReviewScheduleDueLike,
  today: string,
  kpIds: Set<number>,
  qIds: Set<number>,
  cardIds: Set<number>,
): boolean {
  if (s.dueTime > today) return false;
  if (s.kpId !== null) return kpIds.has(s.kpId);
  if (s.qId !== null) return qIds.has(s.qId);
  if (s.cardId != null) return cardIds.has(s.cardId);
  return false;
}
