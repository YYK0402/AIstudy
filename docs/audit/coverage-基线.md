# 测试覆盖率基线（2026-11-01）

## 范围与方法

- 命令：`npx vitest run --coverage`（@vitest/coverage-v8）
- 纳入：`packages/core/src/utils/**` + `packages/core/src/api/**`（core 纯逻辑层）
- 排除（node 环境不可测）：
  - `utils/modals.ts`、`utils/pdfOcr.ts`：依赖 DOM/canvas/MutationObserver
  - `utils/index.ts`：barrel 导出文件
  - 视图/组件层（`views/`、`components/`）：未配 jsdom 环境，不纳入（见修复计划 R5.6，已决策跳过）
- 产物：`docs/audit/coverage/`（lcov，gitignored，本地查看用）

## 基线数字（2026-11-01，508 用例）

| 目录 | Lines | Branch | Funcs |
| --- | --- | --- | --- |
| **utils** | **85.35%** | 91.63% | 78.90% |
| api | 41.39% | 81.81% | 42.97% |
| 全部 | 54.80% | 87.42% | 55.17% |

## 阈值

`vitest.config.ts` 对 `packages/core/src/utils/**` 设 **lines ≥ 80**（审计要求「核心 utils 行覆盖 ≥80%」的落地）。
api 层不设阈值：大量函数经桥调用内核/网络，纯 node 测试只能覆盖纯函数部分，全局阈值会随桥代码增长假性下降。

## 本轮（2026-11-01）为推达 80% 新增的测试

| 文件 | 之前 | 之后 |
| --- | --- | --- |
| utils/wrongStreak.ts | 无测试 | 100%（9 例） |
| utils/weakKps.ts | 无测试 | 100%（7 例） |
| utils/masteryTree.ts | 无测试 | 100%（7 例） |
| utils/flashcardGen.ts | 无测试 | 95.23%（8 例） |
| utils/chapterMove.ts | 无测试 | ~100%（8 例） |
| utils/masteryHeatmap.ts | 无测试 | ~100%（3 例） |
| utils/csvIds.ts | 12.5% | 100%（4 例） |
| utils/studyTrend.ts | 22.22% | ~100%（6 例） |
| utils/graphPositions.ts | 无测试 | ~100%（5 例） |
| utils/graphLayout.ts clampPosition NaN | 未覆盖 | 修复 NaN 传染 + 4 例 |
| api/planSchedule.ts | 无跨年用例 | +2 例 |
| utils/questionImport.ts | 缺 CRLF/第 9 选项/`- A. `/paperName | +4 例 |

## 已知未覆盖（后续迭代按需补）

- api 层桥依赖函数（material.ts / report.ts / studyData.ts 等，行覆盖 1%~30%）：需桥 mock 或真机
- utils/documentParser.ts 16.92%：PDF 行聚合的复杂分支（核心路径 `aggregatePdfRows` 已有随机对照测试）
- utils/textChunker.ts 部分分支、utils/reviewDue.ts 22-25 行
- 视图/组件层全部（jsdom 未配）
