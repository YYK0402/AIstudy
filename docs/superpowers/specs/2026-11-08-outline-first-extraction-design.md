# outline-first 全链路结构识别与知识点抽取 — 设计文档

- 日期：2026-11-08
- 状态：已评审（用户逐段确认 4 段设计）
- 前置：现有管线 = organize_doc 清理+标标题（8000 字符盲切段）→ aggregateCourseToc（字符串去重 + recognize_toc 仅 L1/L2）→ 两级章节树（chapter/unit）→ extract_kp 按章切块（30K 上限）+ `findChapterByTitle` 字符串模糊挂接

## 背景与目标

用户拍板的决策：

1. **痛点**：多资料识别时语义相同的章节没有合并（E）；产出的章节结构本身不合理（F）
2. **层级模型**：**可变深度 N 级树**（C 方案），小节成为一等节点
3. **同章/同节判定**：**AI 语义判断**（不做字符串规则匹配）
4. **范围**：**全链路重设计**（B 方案）：清理 + 结构识别 + 语义合并 + 抽取
5. **目标**：**精准优先，不再为省 token 牺牲质量**；抽取是最重要的部分
6. **方案**：outline-first 三阶段（结构先行、映射挂接、人工确认门保留）

核心洞察：当前挂接靠事后字符串匹配（`findChapterByTitle`），结构信息在 recognize_toc 处被截断为两级（`level !== 1 && level !== 2` 直接丢弃），「三级及以下不进课程目录」是 F 的案发现场（`ChapterTreePreviewModal.vue:61` 注释）。新设计让**跨资料语义合并产出显式映射**，挂接成为结构事实而非模糊匹配。

## 现状事实（代码佐证）

- `organize_doc`：8000 字符按段盲切（`material.ts:74-95`），prompt 含「标 #/##/### 标题」职责（`promptTemplates.ts:253-268`）；40% 长度安全网；章被切到两段时标题标注必然错乱
- `recognize_toc`：仅 L1/L2，200 行/60000 字上限（`kp.ts:315-369`）
- 聚合：`level:text` 字符串精确去重（`kp.ts:371-395`），无语义合并
- 章节模型：`Chapter.level: "chapter" | "unit"`（`types/appData.ts:61-70`）
- 预览弹窗写死两级，注释明确丢弃 L3+（`ChapterTreePreviewModal.vue:61-74`）
- 抽取：`chunkByChapters` 只认 `#`/第X章，回退 markdown 标题再回退 2000 字块；30K 章内再切（`extract.ts:111-129`）；KP 挂节靠 `findChapterByTitle` 归一化+双向包含（`kpMatch.ts:14-27`）
- 所有层级节点都落思源文档（`kp.ts:78-118` createChapter 无条件建文档）
- `importChapterTree` 幂等导入 + 改挂 + relink（`kp.ts:134-218`）
- 全量重抽 = 清空课程 KP + 逐资料重抽（`CourseContentView.vue:965-1007`）
- `chapterScope`/`effectiveNodeOf`/`chapterMove.ts` 全部硬编码两级假设

## 1. 数据模型

### 1.1 Chapter N 级化

- `Chapter.level: "chapter" | "unit"` → `level: number`（深度，1=章根，上限不限）
- `ChapterTreeNode`（预览→落库中间结构，`kp.ts:120-125`）：`level: number`，`parentName` 机制不变（flat 列表、父在子前）
- 一次性迁移（读时升版）：`"chapter"→1`、`"unit"→2`

### 1.2 TocMapping（新增 AppData 数组 `tocMappings`）

```ts
interface TocMapping {
  id: number;
  materialId: number;
  courseId: number;
  materialPath: string; // 资料 outline 节点路径，如「第1章>1.1 概述」
  chapterId: number;    // 归属的规范章节节点
}
```

- 一行 = 资料 M 的一个 outline 节点归属到哪个规范章节节点
- 级联删除：随资料删除（`deleteMaterial`）/ 随章节删除（`deleteChapters`）清理
- **抽取挂接走映射，`findChapterByTitle` 从抽取链路废除**（仅在历史 KP 重挂钩遗留场景保留兜底）

### 1.3 Material 侧

- `Material` 新增 `outline: string`（JSON：扁平 `{text: string; level: number}[]`，N 级，文档序）
- 新增 `outlineStatus: "none" | "done" | "partial"`（partial=有未定位节点）
- span（标题→文本位置）**不落库**，由 outline + contentText 确定性重算（见 2.2）

### 1.4 思源文档策略

- 深度 ≤2 节点（章/节）：照旧各建一个文档
- **深度 ≥3 节点：不建文档**（`siyuanBlockId=null`）；其下 KP 渲染到最近有文档的祖先（深度 ≤2）节点区域
- `createChapter`/`importChapterTree` 按深度决定 `persistDocIfEnabled` 调用

## 2. 四阶段流水线

每阶段独立后台任务（现有 bgTask 铃铛基建），阶段产物缓存落库，任一阶段失败可单阶段重跑。
例外：② 不作为独立 bg 任务暴露，内联于③（合并任务）执行（无 outline 资料自动补跑）；重试经资料菜单「重新识别结构」（先清该资料 outline 再触发合并）。

```
原文 → ①清理 → 干净文本(contentText)
     → ②结构识别 → outline(Material.outline)
     → ③语义合并(课程级, 人工确认门) → 章节树(chapters) + 映射(tocMappings)
     → ④抽取(每规范节点) → KPs(chapterId=映射节点)
```

### 2.1 ① 清理（`organize_doc`，改 prompt）

- 职责收窄：去页眉页脚噪声 / 拼断行 / 修 OCR / 可读性调整；**删除「标标题」「标题误判修正」两条职责**
- 新增约束：「保留文中已有 markdown 标题行原样，不加不删前缀」
- 8000 字符段落切段、40% 安全网、段失败保留原文：照旧

### 2.2 ② 结构识别（`recognize_outline`，新任务）

- 输出**扁平标题列表 `[{text, level}]`**（level=绝对深度 1..N，文档序）；**位置由代码对齐，不依赖模型报行号/偏移**
- 切块：单篇 ≤40K 字一次调用；超过则按段落边界切 40K 段，每段携带「已发现的全局 outline（`L{level} {text}` 行）+ 上段末尾 500 字重叠」上下文；段间去重拼接
- prompt 要点：只输出结构性标题不补造内容；level 依编号体系/版面（第X章/X.X/（X）/markdown # 为强提示）；与已发现 outline 层级一致；无标题段返回空数组；正文短语不当标题
- **位置对齐（纯代码，确定性）**：顺序处理，每标题从上一标题位置向后查找——归一化精确匹配 → 降级包含匹配（行长 ≤60）→ 仍失败标「未定位」（不阻塞，span 空）；位置单调递增约束
- 幂等：`Material.outline` 覆盖写；资料菜单「重新识别结构」= 先清该资料 outline 再重跑②并合入③（② 内联于③，不独立暴露）

### 2.3 ③ 语义合并（`merge_toc`，新任务，核心）

- **逐资料顺序合并**（拍板）：canonical tree 以现有课程树为种子（幂等/增量）；对每份资料一次调用：`（当前规范树 + 该资料 outline）→（更新后完整规范树 + 该资料映射行）`
  - 每次调用规模小、大课程不爆上下文、天然增量（新资料只合一次）
  - 跨资料同章异名（「第1章 极限」vs「第一章 极限与连续」）由与规范树既有节点逐一语义比对解决
  - 累积漂移风险由人工确认门兜底
- AI I/O 节点表示：flat `{id, parent, name, variants[], from[]}`，返回**完整**列表而非 diff
- 映射行 AI 侧用该资料 outline 的**节点序号**（0 起）指认；落库翻译成文本路径写 `tocMappings.materialPath`
- prompt 要点：语义同章判定（编号体系差异/措辞变体/缩写=同节，取更完整写名为规范名，异名进 variants）；不臆造输入外节点；保持文档顺序；跨资料层级一致；资料独有部分（附录等）建新节点
- 规模保护：单资料 outline >150 节点 → 按顶层边界拆半顺序合两次
- **人工确认门保留**：预览升级为递归 N 级树（见 3.1），确认后落库（`importChapterTree` 泛化 N 级 + 写 `tocMappings` + 写 `Material.outline`），触发未抽资料抽取（现有交互）

### 2.4 ④ 抽取（`extract_kp`，改 prompt + 执行单位变更）

- 执行单位：**规范节点**（拍板）。触发「抽取资料集合 M」→ 换算「M 们覆盖的、尚无 KP 的节点集合」→ 逐节点处理；**多资料共享节点只抽一次**，输入含全部贡献资料片段，KP `sourceAssetIds` 记全部资料
- 每节点输入：节点路径（章>节>小节）+ 该节点精确圈定原文（资料自然序拼接）+ **兄弟节点名**（边界感知）+ 该节点已有 KP 名 + 课程 KP 名清单（去重）
- 单节点原文 >60K → 节点内顺序分片多次调用合并（替代旧 30K 章切分）
- 输出 `[{name, description}]`——**删除 section 字段**，挂接走映射
- prompt 保留现有规则（教材原词 2-20 字/公式数值逐字/同标题编号子点合并/独立概念拆分/description 2-4 句），新增「输入即本节点完整正文，发现兄弟节点内容不得抽取」
- `kp.chapterName` 存节点名（兜底匹配 findDeepestChapterByTitle 按名取最深；深节点展示上下文由 chapterPathText 路径承担）
- 取消/互斥沿用现有 flag；进度文案「节点 i/N · 章>节>小节」
- 全量重抽语义不变：清空课程 KP → 重抽全部有映射文本的节点

## 3. UI 改造

### 3.1 目录预览弹窗（`ChapterTreePreviewModal` 重写渲染层）

- 递归 N 级树；节点行 = 可编辑名 + 异名变体 chips（「等 N 种写法」折叠）+ 来源资料徽章 + 未定位警告图标
- 操作：改名 / 删除子树 / 任意深度添加子节点；跨父移动不进预览（落库后主界面拖拽）
- 映射行随节点身份走：改名不影响映射；删除节点=丢弃其映射行；手加节点无映射、不参与抽取

### 3.2 主界面章节树（`CourseContentView`）

- `chapterTree` 两级 computed → 递归
- `chapterMove.ts` 拖拽规则泛化 N 级（同级换序 / 挂到任意深度节点下）
- 章节弹窗 `unit` → 通用 `child`（任意深度创建子节点）
- `chapterScope`/`effectiveNodeOf` 两级假设 → N 级祖先遍历（KP 区域同步取最近深度 ≤2 有文档祖先）

### 3.3 入口与配置

- 资料菜单：「重新识别结构」（先清目标资料 outline 再重跑②并合入③；② 不作为独立 bg 任务暴露，内联于③（合并任务）执行）；课程级目录重识别/重合并入口全部走新③（保留确认门）
- `PROMPT_TASKS` 11→12：删 `recognize_toc`，增 `recognize_outline` + `merge_toc`，`organize_doc`/`extract_kp` 改默认模板；任务分配 UI 零改动
- 计划/出题/闪卡/费曼 per-KP 无结构依赖，不受影响；fnos 端共用 core 自动双端可用

## 4. 兼容与迁移

- 一次性 AppData 迁移（读时升版）：`chapter.level` string→number；`tocMappings=[]`；清 `promptTemplates.recognize_toc` 残留自定义
- 旧资料无 outline：触发新流程从①②重跑；旧 KP `chapterId` 全部继续有效
- **破坏性**：数据模型破坏性变更，同一课程所有同步设备须同版本客户端；旧版客户端读新数据时章节 UI 降级显示（level 读不出），数据不损坏

## 5. 错误处理（挂现有 bgTask 铃铛基建）

| 阶段 | 失败处理 | 重试入口 |
|---|---|---|
| ② 未定位节点 | 不阻塞，预览展示警告数 | 资料菜单「重新识别结构」 |
| ③ 单资料合并失败（解析/超时） | 该资料预览降级显示原始 outline 列表 + 提示手工补章，不阻塞其他资料 | 课程级「重新合并目录」 |
| ④ 单节点失败 | errors 聚合（现状） | 资料级重试：「重新识别结构」=清 outline 重跑②再合并；节点抽取跳过已有 KP 的节点（增量） |

取消：现有 flag 机制，节点级 break。

## 6. 测试与验收

- 单测（纯函数）：outline 建树 / span 对齐 / level 迁移 / 映射应用（materialPath→chapterId）/ N 级 `chapterScope` / N 级 `chapterMove`
- 组件测试：预览弹窗递归树渲染
- 回归：现有 683 测试全绿
- 实机验收（用户参与）：
  1. 多资料课程重跑①→②→③，核对预览：同章语义合并 / 层级合理 / 未定位警告
  2. 确认后抽取，核对 KP 归属节点 + description 逐字保真
  3. 加一份资料 → 增量合并 → 核对
  4. 示例课（12 章 186 KP）：迁移 + 展示 + 学习流程回归

## 7. 明确不做（YAGNI）

- KP 级语义去重/合并（现痛点在章节级；KP 级 AI 合并留待后续）
- 预览内跨父拖拽（落库后主界面已有拖拽）
- 按模型自适应上下文阈值（40K/60K 先做常量，实测不够再调）
- 旧版客户端兼容层（同版本同步约束即可）

## 8. 模型选型注意

- `recognize_outline`/`merge_toc`/`extract_kp` 的大块调用（40K/60K 字输入）要求**大上下文模型**（≥128K 上下文为宜）；任务模型分配 UI 里给这三个任务加提示文案
- 上下文不足导致的调用失败走既有阶段重试入口，不做静默降级
