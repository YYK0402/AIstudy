# BUG 记录

## BUG-001 学习首页创建课程后「我的课程」卡片不刷新（生产构建）

- **状态**：未修复（已记录，待根因定位）
- **发现**：2026-10-20
- **严重性**：中（功能可用，切路由回来后数据正确；但 创建后即时反馈缺失）
- **用户确认的期望行为**：创建课程成功后**保持不切换**当前选中课程（仅列表刷新显示新卡片）

### 现象

生产构建（`npm run build:web` IIFE bundle）下：在「学习首页」通过「＋新建课程」弹窗创建课程，创建本身成功（pinia store 与 mock 数据层均已写入新课程），但：

1. 首页「我的课程」卡片列表不出现新课程；
2. 「3 门课程」等文案计数不变；
3. 新建课程弹窗中 reactively 绑定的部分状态更新（如 form reset 后 input 值）不反映；
4. 切到其他路由再切回来，首页立即显示全部课程（重新 mount 读 store 得到新值）；
5. 侧栏「当前课程」下拉在手动 toggle 打开时能看到新数据（本地 state 触发 render 后读到了最新 store 值）。

开发模式（vue dev runtime）下同路径完全正常，创建后即时更新。

### 复现矩阵

| 构建形态 | 结果 |
|---|---|
| prod + terser minify | 复现 |
| prod 不压缩（`--minify=false`） | 复现 |
| prod + `__VUE_PROD_DEVTOOLS__: true` | 复现 |
| prod + vue 降级 3.5.9（pinia#2778 修复版） | 复现 |
| prod + compilerOptions `hoistStatic/cacheHandlers` 关闭 | 复现 |
| dev（vue dev runtime） | 正常 |

### 环境与依赖

- vue 3.5.44（已回退测试 3.5.9 仍复现，非该已知 bug）、pinia 2.3.1、vue-router 4.6.4、vite 5、@vitejs/plugin-vue 5、vite-plugin-singlefile 2
- 构建 IIFE + `inlineDynamicImports`、路由组件为懒加载 `() => import(...)`
- smoke 复现环境：`/var/folders/xl/ssyfbsrs1sv14qh6t46w2p3m0000gn/T/opencode/webtest/{index.html,index.js}`，`python3 -m http.server 8371`（后台运行中），mock `window.siyuanAiStudy`（ getData/saveData 内存引用式）

### 已排除项

- 不是数据层问题：mock 数据层、pinia store（`$pinia._s.get("course").courses`）创建后均含新课程
- 不是绑定方式问题：直接 `courseStore.courses` 与 `storeToRefs(courseStore).courses` 均失败
- 不是双 App 挂载 / 双 pinia：`document.querySelectorAll("*")` 仅一个 `__vue_app__` holder，`createApp` 单次调用，style 节点单个
- 不是 Vue 静态提升/缓存处理器/terser 压缩：对应开关关闭或替换后仍然复现
- 不是 terser 事故：`--minify=false` 仍复现
- 不是 Vue 3.5.7~3.5.9 的 pinia#2778 类已知回归：降级 3.5.9 仍复现
- 不是 App 层崩溃/报错：console 无 Vue 错误（仅 form 字段 a11y 提示）

### 关键观测（行内定位线索）

- **mount 时已存在的数据渲染正确**：路由切回重 mount 的 HomeView 能读到 3 门课程
- **mount 之后发生的 store 状态变更全部不再触发重渲染**：HomeView 卡片、App 内三个 modal（NewCourse/Provider/Upload 均常驻 DOM 靠 `class open` 控制显隐）的状态绑定全部停摆；`modalStore.closeNewCourse()` 手动调用后 class 与 state 一致说明 store 正常，只是 UI 不响应
- **唯一可见的 UI 响应**是 Sidebar 的本地 state（dropdownOpen toggle）自身触发 render 时顺带读到最新 store 数据 —— 说明订阅链（track/trigger）在新数据变更时未触达任何组件 render effect
- 受影响组件均为「先 mount 后更新」；无「数据在 mount 之前就存在」以外的情况

### 下一步修复线索

1. 在 smoke 页 `bundle` 加载前 monkeypatch `Array.prototype`/`Object.defineProperty` 无望；更可行的是**开发模式 + 单独把路由组件改为同步 import**（去掉 `() => import(...)` 懒加载）测试，验证是否与 router 懒加载组件相关（vuejs/pinia#2778 也指向 router 组合场景）
2. 用 devtools 接口或 `__VUE_PROD_DEVTOOLS__` 对比 prod/dev 下 `effect` 的 `deps` 列表差异
3. 尝试升级 vue 至 3.6.x/3.7.x（当前 3.5.44），或 pinia 至 3.x（当前 2.3.1），观察是否官方已修
4. 兜底缓解方案（根因未明前可临时上线）：创建课程成功后手动做一次可见的强制刷新（如 `router.replace({ path: "/", hash: Date.now() })` 或对 `.course-grid` 打 key），保证新卡片立即可见且**不切换当前课程**

### 附：页面同时存在三个 modal 的说明

App.vue 中 `<NewCourseModal/><NewProviderModal/><UploadMaterialModal/>` 三个组件都常驻渲染（无 v-if），靠 `.modal-mask` 的 `open` class 控制显隐。调试时用 querySelector 检测「modal 是否还开着」（`.modal input` 存在性）方法是无效的——DOM 永远存在，应检查 `maskClass` 是否含 `open` 或 `getComputedStyle` 可见性。这是工具观察误差，不是产品 bug；但三个 modal 常驻 DOM 的设计后续可考虑加 v-if 降低常驻开销（优化项，非本 bug）。
