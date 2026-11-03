# 知识点树与思源课程树双向同步 — 设计文档

- 日期：2026-11-03
- 状态：已评审（用户逐节确认 + 3 项关键决策拍板）
- 前置：知识点树 md 可编辑往返（导出身份标记 + 导入预览/落盘）已完成，本地提交 `513c8bc`

## 背景与目标

md 知识点树导入导出是**可移植格式**，继续作为非思源端（fnos/web）的唯一导入导出方式。思源端要**加深结合**：

1. 知识点树的变更（含 md 导入）要**直接更新思源里现有课程树的章节文档**（建/改名/移动/删除同步 + 知识点内容落章文档）
2. 用户可在**思源章文档里直接编辑知识点**，应用通过「从思源同步」读回（带预览确认）

用户拍板的 3 项决策：
- 读回触发：**显式按钮「从思源同步」**（不自动）
- 未归章 KP（`chapterId` 为空）：**落课程顶层文档**的锚点区
- 冲突策略：**停写 + 提示**（应用在思源侧检测到区域被用户改过 → 本次不覆盖，提示先同步）

## 现状事实（代码佐证）

- 思源落库是文档树：课程=顶层文档（`course.siyuanDocId`），章/节=子文档（`chapter.siyuanBlockId` 存文档 id，`kp.ts:85-97,144-150`）
- **章文档内容只有 `# 章名` 一行**，知识点不落库；`kp.blockId` 是用户手动绑定的既有文档引用，与本方案无关
- 已有同步：课程/章改名→`renameDoc`（`course.ts:59-65`、`kp.ts:311-318`），章移动→`moveDoc`（`kp.ts:330-346`），章删除→`removeDoc` 级联（`kp.ts:391-414`）；KP 任何修改都不写回思源
- md 导入（`api/kpTreeImport.ts`）当前**只改插件数据**，未接任何思源文档操作
- bridge 仅文档级 API：`ensureFolder/createDoc/removeDoc/updateDoc/getDocMarkdown/docExists/moveDoc/renameDoc/isValidDocRef`（`bridge/types.ts:67-77`）
- 锚点区模式已有先例：学习对话文档 `<!-- ai-study:conversations:begin/end -->`，锚点外用户内容永不触碰（`siyuanSync.ts:7-8,84-98`）
- 缺口：落库失败/开启持久化前创建的章节 `siyuanBlockId` 永久为 null，无补落库手段（本方案顺带修复）
- 非思源端 `capabilities.docs="none"`（fnos `bridge-shim.js:108`），文档方法全降级

## 方案（锚点区 + 两条单向管道）

拒绝的替代方案：
- 块级 API（每 KP 一个块）：需改三端 bridge 契约，3.8.x 无块级 HTTP API，工作量 ×3 收益低
- 整篇文档插件托管（updateDoc 整篇覆盖）：冲掉用户手写内容，违反锚点外不碰原则

## 1. 文档格式

- **章/节文档**：现有内容（`# 章名` + 用户手写内容，永不触碰）+ 文末追加锚点区：

```
<!-- ai-study:kps:begin -->
- 知识点名 [掌握度] <!-- kp:ID -->
  内容第一段。

  内容第二段。
- 另一个知识点 [未学习] <!-- kp:ID -->
<!-- ai-study:kps:end -->
```

- **课程顶层文档**：`# 课程名` + 同样的锚点区，区内 = **未归章 KP**（`chapterId` 为空或幽灵归属）
- 区内每行与 md 往返格式的 KP 行**逐行一致**（`- 名称 [掌握度tag]（N 错题）? <!-- kp:ID -->` + 2 空格缩进内容、空行分段）；区内**不含** `#` 标题、`> ` 统计行、ch 标记（章节由文档本身表达）
- 区内 `[掌握度]` 是参考标签：读回/导入都不改 mastery；区内不含错题数（区域是数据镜像，保持格式稳定）
- 小节（unit）是独立文档，各区只放**本节点直属 KP**（`nodeOf` 口径与导出一致：顶章直属 / 小节直属 / 未归章）
- 锚点常量：`KP_BEGIN = "<!-- ai-study:kps:begin -->"`、`KP_END = "<!-- ai-study:kps:end -->"`
- 章文档内**无区** = 该文档尚未纳入同步（历史数据），不是「空章」

## 2. 写回管道（应用 → 思源）

全部 fire-and-forget（数据先 saveData 落盘，同步失败仅 toast，不阻塞不回滚——与现有 `kp.ts:350-356` 模式一致）。前置条件：`docsEnabled() && settings.persistToSiyuan`，否则整体短路。

### 触发点

| 操作 | 写回动作 |
|---|---|
| KP 新增（`kp.ts` create、`extract.ts` 抽取完成批量） | 同步该 KP 所在节点的章文档（未归章→课程文档） |
| KP 改名/改内容（`updateKnowledgePoint`） | 同上 |
| KP 换章（`chapterId` 变更）/ 排序（`applyKnowledgePointSort`） | 同步**新旧两个**节点文档 |
| KP 删除 | 同步原节点文档 |
| 新章创建（`createChapter`/`importChapterTree`） | `persistDocIfEnabled` 建文档（现有逻辑）后**写入空区**；`siyuanBlockId` 为 null（开启持久化前创建/落库失败）的章在首次涉及时**createDoc 补建 + 回填 id**（路径 `/课程名/章名`，parentID=课程文档，复用 `kp.ts:88-89` 消歧方式） |
| md 导入确认后（`confirmKpTreeImport`） | ① 章结构变更：`diff.chaptersAdded`→createDoc 挂到课程文档（unit 挂父章）、`chaptersUpdated.name`→renameDoc、`chaptersUpdated.parentKey`→moveDoc、`chaptersRemoved`→removeDoc（级联，幂等 `removeDocIfExists`）② 受影响节点写区（KP 有更新/新增/删除的章 + 新建章的新文档 + 未归章有变化时的课程文档），并清理被删章的 `docRegions` 条目 |
| 课程改名（现有 renameDoc） | 无需写区（课程文档区内容不随课程名变） |

### 最后写入状态（防误报的核心）

`AppData.docRegions?: Record<docId, { h: string; ids: number[] }>`（可选字段，旧数据缺失=无状态）：
- `h` = 本应用**最后一次成功写入**的区内规范串哈希（djb2 hex；规范串 = 区内标记 KP 按序 `id|name|content` 拼接——用户只动空白不改变规范串，不视为用户改过）
- `ids` = 该区写入时的标记 KP id 集（用于读回时区分「应用后加的 KP」与「用户删的 KP」）
- **必须加入 `courseSplit` 的 global 块**（同 `reminders` 教训：不加就不落盘）

### 单文档写回流程 `syncNodeDoc(course, node, data)`

1. `node = null` 表示未归章→课程文档（`course.siyuanDocId`）；否则章/节文档（`chapter.siyuanBlockId`）
2. 文档 id 为空 → 补建（见触发点表，课程文档补建路径 `/课程名`、章 `/课程名/章名` 带 parentID）；仍失败 → toast，结束
3. `getDocMarkdown(id)`：
   - **文档不存在**（用户删了）→ 按节点名重建文档（`createDoc` 带 parentID）+ 写入区（学习对话文档同款自愈，`siyuanSync.ts:149-158`）+ 存状态
   - **文档存在**：
      - 有区 且 区规范哈希 == 存储 `h` → 用户没动过 → 用应用当前渲染替换区内容 + 更新存储状态（渲染规范哈希与 `h` 相同 = 应用也没变 → 跳过 `updateDoc` 省一次内核调用）
     - 有区 且 哈希 != `h` → **用户在思源改过 → 停写 + toast「章 X 在思源有未同步编辑，请先点『从思源同步』合并；本次应用侧变更尚未写入思源」**
     - 无区 且 无存储状态 → 历史文档，追加区（`\n\n` + 区）+ 存状态
     - 无区 且 有存储状态 → 用户删了整个区 → 停写 + toast（同上）
4. `updateDoc(id, 新全文)`（整篇 = 锚点外原文 + 新区；锚点外字节级保留）
5. 每文档防抖合并（同章连续多次操作只写一次，debounce ~500ms；同文档串行队列避免并发写）

### 渲染 `renderKpRegion(kps: KnowledgePoint[]): string`

sort 序，逐行 `- ${name} ${MASTERY_LABEL[mastery]} <!-- kp:${id} -->` + 内容逐行 2 空格缩进（空行保留）。无内容 KP 只有 bullet 行。纯函数。

## 3. 读回管道（思源 → 应用）

### UI

- 课程内容页新增按钮「从思源同步」：显示条件 `docsEnabled() && settings.persistToSiyuan && !archived && 当前课程存在`，与「导出知识点树/导入知识点树」同行
- 流程：点击 → busy → 逐文档 `getDocMarkdown`（课程文档 + 本课程全部章/节文档；`siyuanBlockId` 为 null 的章跳过并计数）→ 组装 `ParsedKpTree` → `computeKpTreeDiff` → 预览弹窗 → 确认 → `applyKpTreeDiff` + saveData → toast + 刷新视图

### ParsedKpTree 组装（读回特有）

- `chapters`：本课程**现有**章节全部作为带标记 `ParsedChapter`（key=`id:<chapter.id>`，unit 的 parentKey=父章 key）→ 读回**不产生**章节结构变更（新章只能经 md 导入或应用内新建）
- `kps`：解析每个文档的区 → `ParsedKp`（key=`id:<kpId>` 或 `new:<n>`，chapterKey=该文档对应章的 key；**课程文档的区 → chapterKey=null**）
- 复用 `computeKpTreeDiff` 基础语义：区内缺失的带标记 KP=删除、无标记条目=新增（默认未学习）、行序变化=sort 更新；**删除判定的精化（应用侧待写 KP 保留不删）以下节安全规则表为准**

### 安全规则（防误清空 / 防误删应用侧待写 KP）

逐文档先做前置分流（不涉及 diff）：

| 文档/区状态 | 存储状态 | 处理 |
|---|---|---|
| 文档不存在（用户删了文档） | 任意 | 跳过 + 计入提示「N 个章文档已被删除，本次未同步」（不自动清空该章 KP；下次写回自愈重建） |
| 无区 | 无存储 | 历史文档 → 跳过 + 计入提示「N 个章文档还没有知识点区，本次未同步」 |
| 无区 | 有存储 | 用户删了整个区 → **按「该章全部 KP 删除」进预览**（逐条列名，确认才执行） |
| 有区（含空区） | 任意 | 进入下方 diff |

对有区的文档，**该区是真相**，逐 KP 判定：

| KP 情况 | 判定 | 处理 |
|---|---|---|
| 区内带标记 且 应用也有 | — | 以区内为准更新 name/content/sort（用户在源头的编辑优先）；内容相同则无 diff |
| 区内无标记 | — | 新增 KP（默认未学习） |
| 应用有、区内没有，**id ∉ 存储 `ids`** | 应用最后写入后才新增的待写项（从未落区） | **保留不删**，合并回该区写回（避免把应用侧新增误判成用户删除） |
| 应用有、区内没有，**id ∈ 存储 `ids`** | 上次写入时在区里、现在被用户删了 | 进删除预览（逐条列名，确认才执行） |

- 未改动的文档：区 == 上次写入 == 应用现状，diff 天然为空，无需特判
- 确认后只落数据；对「保留了待写 KP」的文档写回合并后的区；**所有产生 diff 的文档把存储状态 `{h, ids}` 刷新为该区现状**（后续写回不再误报停写）

### 预览弹窗

- 把 `KpTreeImportModal.vue` 的预览区（更新/新增/删除知识点 + 章节变更 + 统计 + 确认按钮）**抽成共享组件** `KpTreeChangePreview.vue`（props：diff、kp/ch 旧名映射、警示文案、busy；emit：confirm）；md 导入弹窗与读回弹窗 `SiyuanKpSyncModal.vue` 各自只留自己的「输入源 + 头部说明」
- 读回预览头部说明：「以下变更来自思源文档中的知识点区；确认后更新应用数据（掌握度、题目、闪卡、排期不变）」
- 读回预览额外展示两类提示项（只读信息，不算变更数）：「N 个章文档已被删除 / 还没有知识点区，本次未同步」；「M 个应用侧新增知识点保留并已写回对应区」（即 id∉存储 ids 的保留项，让用户知道它们没被当成删除）

## 4. 非思源端

- fnos/web：`docsEnabled()=false`，写回/读回管道与按钮整体短路，行为不变
- md 知识点树导入导出（`513c8bc`）保持为通用可移植链路，两端都可用
- bridge 契约**不变**（只用现有文档级 API）

## 5. 改动文件

| 文件 | 改动 |
|---|---|
| `packages/core/src/api/kpDocSync.ts`（新） | 锚点常量、`renderKpRegion`、`parseKpRegion`（区内行→ParsedKp 列表+规范哈希）、`mergeKpRegion`（锚点外保留/追加/替换）、`syncNodeDoc`（单文档写回+停写检测+防抖+补建）、`docRegions` 读写（`AppData.docRegions` 状态）、`buildSiyuanParsedTree`（读回组树，含逐文档状态分流）、`syncFromSiyuan`（读全部文档→diff 预览）、`applySiyuanSync`（确认后落数据+合并写回+状态刷新）、`syncChapterStructure`（md 导入的章文档操作） |
| `packages/core/src/types/appData.ts` | `AppData.docRegions?: Record<string, { h: string; ids: number[] }>` |
| `packages/core/src/utils/courseSplit.ts` | **global 块加 `docRegions`**（同 `reminders` 模式，不落盘=状态丢失=停写误报）+ 往返测试 |
| `packages/core/src/utils/kpTreeImport.ts` | 抽 KP 行解析为共享函数（`parseKpLine`），主解析器与 `parseKpRegion` 复用 |
| `packages/core/src/api/kpTreeImport.ts` | `confirmKpTreeImport` 落数据后调 `syncChapterStructure` + 受影响章写区（fire-and-forget） |
| `packages/core/src/api/kp.ts` | KP 增/改/移/删/排序、新章创建挂写回触发点 |
| `packages/core/src/api/extract.ts` | 抽取完成批量同步受影响章文档 |
| `packages/core/src/components/KpTreeChangePreview.vue`（新） | 共享预览组件（自 KpTreeImportModal 抽出） |
| `packages/core/src/components/SiyuanKpSyncModal.vue`（新） | 读回弹窗（busy 态 + 共享预览） |
| `packages/core/src/components/KpTreeImportModal.vue` | 改用共享预览组件（行为不变） |
| `packages/core/src/views/CourseContentView.vue` | 「从思源同步」按钮 + 弹窗挂载 + saved 刷新 + onDeactivated 关闭 |
| `packages/core/src/api/index.ts`、`style.css` | 出口/样式（预览组件已有样式可复用，微调） |

## 6. 错误处理与边界

- 一切写回失败：数据已落盘，toast 提示具体章名与原因（复用 `persistDocIfEnabled` 的 label 提示模式）
- `getDocMarkdown` 失败（文档被删）：写回按「文档不存在」自愈重建；读回跳过该文档并计数提示
- 停写检测的比对口径：区**规范串哈希**（`id|name|content` 按序拼接）vs 存储 `h`——用户在思源里只动空白/空行不触发停写（写回时顺带规范）；改任何 KP 名称/内容/行序/增删行都触发
- 应用领先（改过但还没写）不会误报停写：比对基准是「本应用最后写入的状态」而非「应用当前状态」
- 防抖窗口内的读回按钮点击：允许（读回读的是最新文档，与未 flush 的写回无关；写回队列读到旧渲染会再触发停写检测保护）
- 归档课程：按钮隐藏，md 导入按钮也不可见（现有 `v-if="!archived"`），无写路径
- 章/课程删除时清理对应 `docRegions` 条目（文档已级联删除，状态留存无意义且会累积）
- `persistToSiyuan` 中途关闭：写回短路、区原地保留；重新开启后哈希比对照常工作（区未被用户动过则不触发停写）
- YAGNI 不做：块级 API、区外内容感知、跨课程移动、区内容自动迁移（章改名后区随文档走，天然无迁移问题）、文档修改时间戳三方合并

## 7. 测试与验收

**单测（纯函数，`packages/core/src/**/__tests__/`）**
- `kpDocSync.test.ts`：render↔parse 往返（多段落/空内容/掌握度标签不变）；merge 保留锚点外字节；无区追加；区规范哈希（空白差异不触发、内容/行序差异触发）；写回分流（哈希一致=写、不一致=停写、无区无状态=追加、无区有状态=停写）；**应用领先不误导**（存储 h 为旧状态、应用已改、区未动 → 正常写回不误报）；读回分流（无区无状态=跳过、无区有状态=全删预览、**id∉存储 ids 的应用新 KP 保留并合并回区**、**id∈存储 ids 的缺失行=用户删除进预览**、跨文档移动=chapterKey 变更、无标记行=added、未改动文档 diff 为空）；`buildSiyuanParsedTree`（多文档归章、课程文档区→未归章、unit 文档）
- `courseSplit.test.ts` 补 `docRegions` global 往返（同 `reminders` 用例模式）
- 现有 `kpTreeImport.test.ts` 回归（抽公共解析后行为不变）

**全链路**
- 双端 `vue-tsc --noEmit` + `npx vitest run` + `build:web && build:plugin`
- 真机冒烟（示例课）：
  1. 应用内改 KP 内容/新增 KP → 思源章文档出现锚点区且内容正确（锚点外已有内容保留）
  2. 思源里手改区内一行内容、删一个 KP、加一个无标记条目 → 「从思源同步」→ 预览 3 类变更 → 确认 → 应用数据更新、mastery 保持
  3. 冲突停写：思源改区后应用内再改 KP → toast 提示、文档内容不变（用户编辑不被冲掉）→ 从思源同步（确认）→ 再改 → 正常写回
  4. 应用领先不误导：连续应用内改两次 KP（期间无思源编辑）→ 第二次写回不弹停写提示、文档区最终为最新
  5. md 导入（含新章/改名/删除）→ 思源课程树文档同步建/改名/删，章文档区更新
  6. 非思源端不受影响（类型层面：fnos bridge 无文档能力，管道短路）

## 8. 与发版策略的关系

功能迭代：本地 commit 不 push、不发版（同 `513c8bc`），随下次批量发版一并出（版本 0.5.4，changelog 与 A4 一起归 0.5.4）。
