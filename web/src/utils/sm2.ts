export interface Sm2State {
  stage: number;
  intervalDays: number;
  easeFactor: number;
}

/**
 * 自研 SM2：按质量分 n（0 忘了 / 1-2 较差 / 3 模糊 / 4 良好 / 5 牢固）推进记忆状态。
 * 规则与原实现一致：忘了重置为一阶并降低难度因子；其余按 SM2 公式更新难度因子与间隔。
 */
export function nextSm2(state: Sm2State, n: number): Sm2State {
  if (!Number.isInteger(n) || n < 0 || n > 5) {
    throw new Error(`非法质量分 n=${n}（应为 0-5 整数）`);
  }
  // 对齐标准 SM-2：n<3（忘了/较差）一律重置到一阶并降低难度因子
  if (n < 3) {
    return {
      stage: 1,
      intervalDays: 1,
      easeFactor: Math.max(1.3, state.easeFactor - 0.2),
    };
  }
  const easeFactor = Math.min(
    2.8,
    Math.max(1.3, state.easeFactor + (0.1 - (5 - n) * (0.08 + (5 - n) * 0.02))),
  );
  const intervalDays = state.stage === 1 ? 1 : Math.round(state.intervalDays * easeFactor);
  return {
    stage: Math.min(8, state.stage + 1),
    intervalDays,
    easeFactor,
  };
}
