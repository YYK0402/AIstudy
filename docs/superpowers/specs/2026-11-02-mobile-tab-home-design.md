# 移动端（手机）体验设计：底部 Tab 导航 + 独立移动首页

- 日期：2026-11-02
- 状态：已确认（§1 导航与首页结构 / §2 数据层与适配范围均经用户确认）
- 用户决策记录：
  - 手机使用场景：**学习和刷题为主**
  - 导航形式：**底部 Tab 栏**（4 高频 + 「更多」）
  - Tab 组合：首页 / 学习 / 刷题 / 复习 / 更多（错题本、闪卡本等 7 项低频进「更多」弹层）
  - 首页课程切换：顶部课程行点击切换
  - 首页任务：**跨课程聚合**（B 案：汇总所有课程今日任务，一条队列刷完）
  - 首页形态：**独立移动端首页（B 案）**，桌面首页不动

## 背景与目标

当前应用是同一 web bundle 在思源桌面/移动端 webview 渲染（`/stage/build/desktop/` 与 `/stage/build/mobile/` 加载同一套）。手机上目前是桌面布局硬缩：侧边栏占宽严重、11 项导航拇指不可达。目标：

1. 手机上学习（看知识点→费曼复述→AI 评估）与刷题（组卷/答题/复习）零成本触达
2. 首页一屏完成每天的核心动作：切课程 + 刷完跨课程今日任务队列
3. 桌面端行为零变化

非目标（本轮不做）：知识图谱拖拽、题目/知识点编辑的专属移动布局；独立移动端入口/独立路由；离线。

## 现状基础（已核实）

- 导航：`Sidebar.vue` 固定左栏，3 组 11 项（学习 5 / 练习 5 / 洞察 1）+ 设置入口；侧边栏顶部含课程切换下拉（`courseStore`）
- 路由：vue-router 11 个 view（`/` `/course` `/content` `/plan` `/study` `/quiz` `/wrong` `/cards` `/review` `/graph` `/report` `/settings`）
- **跨课程今日任务聚合已存在于桌面 `HomeView`**：非归档课程 + 今日计划任务（learn/review/practice，可勾选）+ 到期 SM2 复习触点（KP/错题/**闪卡**，`queryDueReviews`），按课程归组、未完成在前——数据逻辑直接抽取复用
- 窄屏底子：`@container (max-width: 860/560px)` 分级规则（.content/.main/.ai-study-app 三容器）、`.table-scroll`、弹窗窄屏适配（v0.4.6 完成）
- 徽标数据：`wrongCount`/`cardDueCount` 现有计算可复用到 Tab 徽标（全局口径需按全部活跃课程汇总）

## 方案

### 1. 断点与布局骨架

- 新 `composables/useIsMobile.ts`：`matchMedia (max-width: 768px)` + change 监听（思源窗口缩放/设备旋转响应）
- `App.vue`：`<Sidebar v-if="!isMobile">`、`<TabBar v-if="isMobile">`；移动端 `.main` 全宽（去左侧栏偏移）
- 1127px 桌面窄页签不受影响（>768px 走桌面布局）

### 2. TabBar（新组件 `components/TabBar.vue`）

- 底部固定，5 项：**首页 `/` · 学习 `/study` · 刷题 `/quiz` · 复习 `/review` · 更多**
- `router-link` + active 态；**复习 Tab 徽标** = 全局到期复习数（含闪卡，全部活跃课程）
- 「更多」= 底部弹层（Bottom Sheet）：
  - 两列网格 7 项：错题本（徽标：全局未毕业错题数）/ 闪卡本（徽标：全局到期闪卡）/ 课程内容 / 学习计划 / 知识图谱 / 学习报告 / 设置
  - 两个快捷入口：**新建课程**、**上传资料**（打开现有 modal，与侧边栏同款）
  - 图标复用 Sidebar 的 icon set
- `padding-bottom: env(safe-area-inset-bottom)` 兼容 iPhone 手势条
- 弹层打开时遮罩点击/下滑关闭

### 3. 移动端首页（`components/home/MobileHomePanel.vue`）

**渲染位置**：`HomeView` 内部按 `isMobile` 分支渲染（`v-if` 切换 MobileHomePanel 与桌面内容）——路由 `/` 不变，keep-alive 缓存不受影响，无路由分叉。

结构（从上到下）：

1. **课程行**：当前课程名 + 「已掌握 M/N」+ ▾ → 点击打开课程切换 sheet；无课程时显示「新建课程」引导
2. **今日任务（跨课程聚合）**：
   - 课程分组：折叠头「课程 A · 3 项 · 学习2 复习1」，单课程默认展开、多课程默认收起（沿用现有 `applyDefaultExpand` 规则）
   - 任务行：类型图标 + 标题 + 状态；未完成在前，完成划线沉底
   - 计划任务行内勾选（现有 `pendingTaskIds` 防连点）
   - 点击直达（复用现有任务行动作语义，4.5 计划-学习挂钩）：learn/review 任务+KP → 切课程 + `/study?kp=`（学习页）；practice 任务+KP → `/quiz?kp=`（刷题页自动组卷）；到期复习触点 → `/review`（复习页评级即完成）；无 KP 旧任务仅勾选
   - 任务归属课程 ≠ 当前课程时，点击先 `courseStore.setCurrent` 再跳转
3. **不显示**（桌面保留）：课程卡片网格、时长趋势图、复习预测、错题快照

### 4. 课程切换（`components/CourseSwitcherSheet.vue`）

- 底部弹层：全部课程列表（当前课程标记、掌握进度、**归档课程置灰 + 「已归档」tag**）+ 底部「新建课程」
- 选择 = `courseStore.setCurrent(id)`（现有逻辑）+ 关闭；切到归档课程仅查看（现有语义）
- 调用点：MobileHome 课程行、移动端 Topbar 课程名
- **桌面侧边栏课程下拉不动**（避免影响桌面行为；组件不强行共用，逻辑靠 courseStore 共享）

### 5. Topbar 移动端简化

- 移动端：左 = 当前课程名（点击 = 课程切换 sheet），右 = 通知铃铛
- 隐藏：面包屑、今日任务计数（信息已被首页课程行 + 复习 Tab 徽标覆盖）
- 桌面 Topbar 不变

### 6. 数据层抽取（防首页逻辑分叉）

- 新 `composables/useTodayTasks.ts`：把 `HomeView` 内联的今日任务逻辑**原样搬移**——`load()`（跨课程聚合）、`todayGroups` 归组、勾选动作、`pendingTaskIds`、`applyDefaultExpand` 默认展开规则
- 桌面 `HomeView` 与 `MobileHomePanel` 均消费该 composable；桌面首页渲染结果与现在一致（纯重构，可回归对比）
- `courseStats`（卡片掌握度）留在桌面分支，MobileHomePanel 只取当前课程的 M/N

### 7. 视图适配范围

- 通用（style.css）：移动端触控目标 ≥44px（任务行/按钮/勾选/Tab 项高）、弹窗全屏延伸现有 560px 规则、表格横向滚动（`.table-scroll` 已有）
- 重点 4 页细调：MobileHomePanel、学习页（知识点 chip 流 + 复述输入框可达性）、刷题页（答题交互）、复习页（回想→揭示→评级三步纵向流）
- 不做：图谱拖拽/题目编辑专属移动布局（能进能看，编辑走桌面）；组卷面板保持可用不重排

## 文件清单

| 动作 | 文件 |
| --- | --- |
| 新增 | `packages/core/src/components/TabBar.vue` |
| 新增 | `packages/core/src/components/home/MobileHomePanel.vue` |
| 新增 | `packages/core/src/components/CourseSwitcherSheet.vue` |
| 新增 | `packages/core/src/composables/useTodayTasks.ts` |
| 新增 | `packages/core/src/composables/useIsMobile.ts` |
| 修改 | `packages/core/src/App.vue`（Sidebar/TabBar 分支） |
| 修改 | `packages/core/src/views/HomeView.vue`（抽数据层 + isMobile 分支） |
| 修改 | `packages/core/src/components/Topbar.vue`（移动端简化） |
| 修改 | `packages/core/src/style.css`（TabBar/Bottom Sheet/移动端触控/安全区） |

## 数据流

```
getData()
  ├─ 非归档课程 + 今日计划任务 + queryDueReviews(c.id) 到期复习（KP/错题/闪卡）
  ▼
useTodayTasks()（reactive items + todayGroups 归组 + 勾选动作）
  ├─ 桌面 HomeView（现有 UI 不变）
  └─ MobileHomePanel（课程分组折叠 + 任务行直达）
        点击 → courseStore.setCurrent + router.push(/study?kp= | /quiz?kp= | /review)
```

## 错误处理

- `useTodayTasks` 加载失败：`loadError` + 重试按钮（现有 LoadError 三态语义，桌面/移动一致）
- 课程 sheet 无课程：空态「还没有课程」+ 新建按钮
- `queryDueReviews` 单课程失败：沿用现有容错（跳过该课程，不阻塞其他课程聚合）

## 测试策略

1. **单测**（vitest，node）：
   - `useTodayTasks` 数据逻辑：跨课程聚合、归档课程排除、归组排序（未完成在前）、勾选态切换、默认展开规则（1 门展开/多门收起）
   - `useIsMobile`：matchMedia 断言 768 边界（≤768 true / 769 false）
2. **真机冒烟**（ego-browser iPhone UA，375px 与 430px 两档）：
   - TabBar 五页导航 + 复习徽标数正确
   - 首页：课程行切换（含归档置灰）、跨课程任务聚合（≥2 课程场景）、任务行直达跳转（切课程上下文正确）、勾选/评级全链路
   - 「更多」弹层 7 入口 + 新建课程/上传资料
   - 学习/刷题/复习 4 页移动端可用（答题→判分→错题入库）
3. **桌面回归**：1127px 页签无 TabBar、侧边栏/桌面首页/Topbar 与改动前一致（截图对比 + 既有冒烟流程）
4. 全量：vitest 508+ 全绿、双 vue-tsc、`build:web` + `build:plugin` + `pack:fnos`

## 风险与边界

| 风险 | 处置 |
| --- | --- |
| `useTodayTasks` 抽取改变桌面首页行为 | 纯搬移不改逻辑；桌面首页回归对比 |
| 768px 断点与思源桌面窗口最小宽冲突 | 思源桌面窗口实际最小宽 >800px；冒烟覆盖 1127px 不误触发 |
| Bottom Sheet 与现有 modal 焦点管理（modals.ts 焦点陷阱）冲突 | sheet 走现有 `.modal-mask` 约定，Esc/焦点循环复用 |
| 移动端长任务名/课程名溢出 | 单行省略 + title，已有 `.chip--ellipsis` 模式复用 |
| 跨端 core 改动 | 双端同发（飞牛 fnos 端同 bundle，无移动端 UI 差异影响，打包流程照旧） |
