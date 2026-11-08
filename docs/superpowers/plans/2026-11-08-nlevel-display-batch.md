# 实施计划：N 级显示欠账批次（2026-11-08）

设计依据：`docs/superpowers/specs/2026-11-08-outline-first-extraction-design.md` §5 错误处理与终审 deferred triage（`.superpowers/sdd/2026-11-08-outline-first-extraction/progress.md` Task 9/终审条目）。

## 全局约束

- 2 空格缩进；camelCase；中文注释；禁 `any`、禁 `eslint-disable`/`@ts-ignore`
- 树构建一律复用 `utils/outline.ts`，不新建树工具（本批次在 outline.ts 补一个无 courseId 过滤的变体，见 Task 1）
- 样式全部写 `packages/core/src/style.css`（组件 `<style scoped>` 不生效）
- 每任务完成前全绿：`npx vue-tsc --noEmit -p packages/siyuan/tsconfig.json && npx vue-tsc --noEmit -p packages/core/tsconfig.json && npx vitest run`
- 只本地 commit，禁止 push、禁止改版本号、禁止打包
- 测试模式：纯函数直接 import；组件测试 @vue/test-utils；不用 vi.mock
- 基线：767 测试（批次起点 HEAD = 实施前记录）

## 共享契约

- **KP 归属判定**（全批次统一）：`k.chapterId === null` 或 `chapterById.has(k.chapterId) === false`（幽灵）→ 未归章；否则 KP 直属该节点（任意深度）
- **祖先聚合**：节点计数 = 直属 KP + 全部后代节点 KP（递归）
- **顶层章**：`level === 1`（与 `parentId === null` 等价，level===深度不变量由 Task 9 拖拽重算保证）
- 深度标签：1=章 / 2=节 / ≥3=小节（复用 `tp-tag chapter/unit/sub`）

---

## Task 1: 掌握度纯函数 N 级化（outline 变体 + masteryTree + masteryHeatmap）

### 目标

深度≥3 节点的 KP 在掌握树/掌握热力图正确显示与聚合（现状：L3 KP 被计为「未归章」）。

### 改动文件

1. `packages/core/src/utils/outline.ts`
   - 新增导出 `buildChapterTreeFlat(chapters: Chapter[]): NestedChapter[]`——算法与 `buildChapterTree` 完全相同（同级 sort 序、孤儿 parentId 指向已删节点提升顶层追加末尾），仅去掉 `courseId` 过滤（调用方传入课程范围 chapters）
   - `buildChapterTree` 改薄包装：`buildChapterTreeFlat(chapters.filter((c) => c.courseId === courseId))`（行为零变化，现有测试锁住）
2. `packages/core/src/utils/masteryTree.ts`
   - `MasteryTreeChapter.units: MasteryTreeNode[]` → `children: MasteryTreeNode[]`（递归，任意深度）
   - `buildMasteryTree(kps, chapters)`：树用 `buildChapterTreeFlat(chapters)`；KP 按 `k.chapterId` 直属分组（存在性判定用 chapterById，删掉 `topIds`/`unitOfTop` 两级判定）；每节点计数 = 直属 + 全部后代递归聚合；未归章 = null/幽灵
   - 文件头注释「两级章节树」措辞更新
3. `packages/core/src/utils/masteryHeatmap.ts`
   - 行语义不变（每顶层章一行 + 未归章行）；KP 归属从「直属/节」改为**最近 level-1 祖先**（parentId 链上溯；自身 level 1 取自身；链断/幽灵 → 未归章）；删 `unitOfTop`
   - JSDoc 更新

### 测试

- `outline.test.ts`：`buildChapterTreeFlat` 与 `buildChapterTree` 同课程数据结果一致 + 孤儿提升
- `masteryTree.test.ts`：新增 L3 用例——L1→L2→L3 各挂 KP：L3 行出现于 L2 children、L2/L1 计数含 L3 KP、L3 直属 KP 不在 L2 直属计数外重复计；幽灵 chapterId 归未归章
- `masteryHeatmap.test.ts`：L3 KP 计入其顶层章行（现状会进未归章——先 RED）

### Commit

`feat: 掌握树/掌握热力图 N 级化——L3 KP 正确聚合，删两级硬编码`

---

## Task 2: 掌握树/甘特图显示 N 级递归

### 目标

学习报告「章节掌握树」与学习计划甘特图渲染任意深度节点（现状模板两级 v-for，L3 不显示）。

### 改动文件

1. 新建 `packages/core/src/components/MasteryTreeNode.vue`
   - 递归组件：props `node: MasteryTreeNode`、`depth: number`；渲染现有 `.mtree-node` 结构 + `v-for="c in node.children"` 递归自身（`depth + 1`）
   - 行内标签/进度条/分布条逻辑与 ReportView 现状一致（`MASTERY_LABELS`/`nodePct` 经 prop 函数或 import 复用）
   - 缩进：沿用 `.mtree-children`（Task 9 已在 style.css 定义）；depth≥3 行加 `.mtree-node.lv-deep` 类（样式若缺补 style.css，字号/缩进沿用现有族）
2. `packages/core/src/views/ReportView.vue`
   - 「章节掌握树」区：两级 template（`ch.units`）替换为 `<MasteryTreeNode :node="ch" :depth="1" v-for>`；unassigned 行保持
   - `treeData` 数据源不变（Task 1 已 N 级化）
3. `packages/core/src/components/PlanGanttView.vue`
   - `ch.units` 两级渲染（:78 区）改递归 children（同样式族缩进；实现时读该文件确认数据来源——若其 chapter 行自带 `units` 字段则同步换 `children`）
4. `packages/core/src/style.css`：按需补 `.lv-deep` / 甘特 L3 行缩进（最小增量，沿用现有色板）

### 测试

- `components/__tests__/PlanGanttView.test.ts`：现有用例不回归 + 新增 L3 数据渲染用例（L3 行出现、缩进类存在）
- 新增 `components/__tests__/MasteryTreeNode.test.ts`：递归渲染 L1→L3 三层、children 计数透传

### Commit

`feat: 章节掌握树/学习计划甘特 N 级递归渲染`

---

## Task 3: 选择器 N 级化（KpTreePicker + KnowledgePointEditModal）

### 目标

任意深度节点可被选中：出题/组卷 KP 树选择器、知识点编辑弹窗的归属章节下拉（现状 L3 不可见不可选）。

### 改动文件

1. 新建 `packages/core/src/components/KpTreeBranch.vue`（递归分支）
   - 从 `KpTreePicker.vue` 模板抽出单章渲染体为递归组件：props = 节点章节、`depth`、`children: Chapter[]`、`kpsByNode`/`selected`/`expanded`/`isSearching` + 回调（`toggleNode`/`toggleKp`/`toggleExpand`/`isNodeAll`/`isNodePartial`/`kpsOfNode`/`allKpIdsOfNode` 经 props 函数传递）
   - 行样式沿用 `.kpsm-row ch/unit` 族；depth≥3 加 `.kpsm-row.deep`（缩进 `padding-left: calc(16px * depth)` 或沿用 children 容器嵌套——实现时以现有嵌套结构为准最小改）
   - 展开开关：有 children 的节点都有 `.tgl`（现状仅章级有）
2. `packages/core/src/components/KpTreePicker.vue`
   - 模板：顶层 `v-for` 改 `<KpTreeBranch v-for="ch in visibleChapters" :depth="1">`
   - `unitsByChapter` → `childrenByParent: Map<number, Chapter[]>`（任意 `parentId != null`，sort 序）
   - `nodeKpIds`：递归（节点 = 直属 + 全部后代，DFS）
   - `orderKey`：`[顶层祖先章 sort, 节点前序索引, kp.sort, kp.id]`——节点前序索引由 `buildChapterTreeFlat` 一次 DFS 预计算（替代现「章 sort + 节 sort」二元）
   - `visibleChapters`/`visibleUnitsOf` 搜索过滤改递归（保留含命中 KP 的分支）
   - `autoExpand` watch：默认展开顶层章（语义不变，L3 不默认展开）
   - 教材序 emit 逻辑不变（`orderKey` 泛化后自然生效）
3. `packages/core/src/components/KnowledgePointEditModal.vue`
   - `chapterTree` computed 改**扁平行列表** `{ id, name, depth }[]`（`buildChapterTreeFlat` 前序展平，深度 = 树层；下拉面板无需折叠）
   - 模板：两级 template 改单 `v-for` 行；缩进 `:style="{ paddingLeft: depth * 14 + 'px' }"` 或 class 档（沿用 `.ct-row.unit` 族）；tag 按深度 `tp-tag chapter/unit/sub`（≥3 用 sub）
   - `pickChapter`/`selectedLabel` 不变（任意 id 可选）
4. `packages/core/src/style.css`：按需补 `.kpsm-row.deep` / `.ct-row.deep` 缩进档

### 测试

- 新增 `components/__tests__/KpTreePicker.test.ts`：L1→L2→L3 fixture——L3 行渲染、点 L3 行选中其 KP、点 L1 行选中含 L3 的全部 KP（indeterminate 中间态）、教材序 emit 顺序（L1 直属 → L2 → L3）
- 新增 `components/__tests__/KnowledgePointEditModal.test.ts`：L3 行出现在下拉、可选、选中 label 正确
- 现有消费方（KpSelectModal/QuestionSetModal）无 props 变化 → 不回归

### Commit

`feat: KP 树选择器/知识点编辑章节下拉 N 级——任意深度可选`

---

## Task 4: 知识点树导出/导入 N 级往返

### 目标

手动导出/导入的知识点树 md 支持任意深度，往返结构不变（现状：导出丢 L3 结构，L3 下 KP 进「未归章」；导入只认 #/##）。

### 改动文件

1. `packages/core/src/utils/kpTreeExport.ts`
   - `buildKpTreeMarkdown`：`tops`/`unitsOf` 两级遍历 → `buildChapterTreeFlat` 递归；节点深度 d 输出 `'#'.repeat(Math.min(d, 6)) + ' '` 标题行（ch 标记/计数后缀不变）；KP `nodeOf` = `chapterById.has(k.chapterId) ? k.chapterId : null`（删两级判定）
   - 文件头 JSDoc「顶章 H1 → 小节 H2」→「N 级标题（# 深度 = 节点层级）」
   - 说明头「x 章」统计 = 顶层章数（不变）
2. `packages/core/src/utils/kpTreeImport.ts`
   - `parseHeading(line, level: 1|2)` → `parseHeading(line, depth: number)`（`'#'.repeat(depth) + ' '` 前缀；ch 标记/计数剥离不变）
   - 解析循环：章标题识别 `^(#{1,6})\s`，`depth = # 数`；**父节点 = 标题栈中最近一层更浅的章**（栈式，替代现「上一个 # 章」）；`ParsedChapter.level` 存深度数字、`parentKey` = 父章 key（根 null）
   - diff 段：`parentChanged` 判定泛化到所有层级（现仅 `c.level === 2` 分支）——现父 = `c.parentId`，解析父 = 解析章 `parentKey`（id:/new/none 三态映射沿用）；`ch.level === 1` 顶层章 parent 恒 none
   - apply 段：新增/变更章的 `level = 父.level + 1`（根 1）；`chapters.find(c => c.id === k.chapterId && c.level === 2)`（:530 区）等两级残留逐处核对泛化（以「存在性 + 父链」判定）
   - 兼容：旧两层 md（仅 #/##）自然按深度解析，行为不变（现有测试锁住）
3. `packages/core/src/components/KpTreeExportModal.vue`：无结构变化（只调 buildKpTreeMarkdown），文案若提及「章/节」措辞核对

### 测试

- `kpTreeExport.test.ts`：新增 N 级导出用例（L1→L2→L3 标题深度正确、ch 标记、L3 KP 归属、未归章兜底）
- `kpTreeImport.test.ts`：新增 N 级解析用例（### 挂 ## 下、跨章栈回退、旧两层文件不变量）+ **roundtrip 用例**：N 级 fixture → `buildKpTreeMarkdown` → `parseKpTreeMarkdown` → 结构等价（章 id/名/父子/KP 归属/教材序）+ 对已有 L3 课程数据导入自身导出 = 零 diff
- 现有全部用例不回归（两层兼容）

### Commit

`feat: 知识点树导出/导入 N 级往返（标题深度=节点层级，旧格式兼容）`

---

## Task 5: 章末测评排期 + 同步读回 + 预览文案

### 目标

收尾三处两级残留：章末测评漏排「KP 全在 L3」的章、思源同步读回树的 L3 父链、导入预览文案。

### 改动文件

1. `packages/core/src/api/plan.ts`（章末测评段，约 :465-480）
   - `chapterLastDay` 的 chId 解析：`node?.level === 2 && parentId != null ? parentId : kp.chapterId`（单跳）→ **最近 level-1 祖先**（parentId 链上溯至 level===1；节点自身 level 1 取自身；节点不存在跳过）
   - 排期语义不变：每顶层章一次、排在该章（含全部后代）KP 的最后学习日
2. `packages/core/src/api/kpDocSync.ts`（:276）
   - `parentKey: c.level === 2 && c.parentId !== null ? \`id:${c.parentId}\` : null` → `c.level > 1 && c.parentId !== null ? ...`（读回树 L3 父链完整）
3. `packages/core/src/components/ChapterChangePreview.vue`（:94）
   - `a.level === 1 ? "新增顶章" : \`新增小节（${chName(a.parentKey)}）\`` → 按深度：1=「新增顶章」/ 2=「新增小节（父名）」/ ≥3=「新增深层节点（父名）」（措辞随现有风格）
4. 全仓 grep 复核：`level === 2` 残留逐处定性（doc 政策判定 level≤2 建文档的**保留**——那是文档策略不是显示；仅显示/选择/排期类泛化）

### 测试

- `plan` 相关测试（plan.test.ts 或对应文件）：新增用例——KP 全挂 L3 的章，章末测评仍排到该顶层章最后学习日（现状漏排——先 RED）；混合深度（L1 直属 + L3）最后日取最晚
- `kpDocSync.test.ts`：`buildSiyuanParsedTree` L3 章 parentKey = 父 id（现状 null——先 RED）
- `ChapterChangePreview`：有组件测试则补 L3 文案用例，无则跳过（记录）

### Commit

`fix: 章末测评/同步读回/预览文案 N 级残留——L3 归属与父链修复`

---

## 批次收尾

- 全量：vue-tsc 双端 + vitest + `npm run build:web && npm run build:plugin` + rsync 部署 + ego 真机冒烟：
  1. 示例课导入 → UI 手工建 L3 小节（章 → ＋子级 → 节 → ＋子级）
  2. 建 KP 挂 L3 → 验证：章节掌握树 L3 行、知识点编辑下拉可选 L3、出题 KP 选择器 L3 可选、知识点树导出含 ### 结构
  3. 学习计划章末测评：L3 KP 的章出现测评任务
  4. 清理测试数据（删示例课）
- 终审（whole-batch review）→ 修复波（如需）→ 台账收尾

## 明确不做（YAGNI）

- 掌握树/热力图深度折叠交互（全展开即可，层级深了再说）
- 导出格式的版本字段/双格式降级（旧两层 md 按深度自然兼容）
- doc 同步（从思源同步）的 md 路径——已核实不经过 buildKpTreeMarkdown/parseKpTreeMarkdown，无需改
