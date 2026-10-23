# 研习 · AI 智能学习（思源笔记插件）

基于思源笔记底座 + 可自定义大模型服务商的课程自学插件，融合冯·诺依曼学习法与间隔重复理论。

支持资料导入、知识点拆解、学习计划生成、题库刷题、错题复盘、知识图谱、学习报告。插件入口在思源菜单栏，点击后在**思源窗口内以自定义页签**打开整套学习界面。

## 技术栈

- 插件入口：TypeScript（构建为 CommonJS，`siyuan` 作为 external）
- 前端：Vue 3 + TypeScript + Vite + Vue Router + Pinia（内联为 IIFE JS bundle，直接挂载）
- 数据：思源官方插件存储 `loadData`/`saveData`（JSON 文件，存 `data/storage/petal/`）

## 架构

```
┌─ 思源主窗口（渲染进程）──────────────────┐
│ src/index.ts（插件入口）                │
│  ├─ 顶栏图标 → 打开自定义页签            │
│  ├─ addTab 注册页签                      │
│  ├─ 动态加载前端 bundle 并直接 mount      │
│  ├─ 数据：loadData/saveData（JSON）      │
│  └─ 暴露 window.siyuanAiStudy 数据 API   │
└──────────────┬──────────────────────────┘
               │ 同渲染进程，直接函数调用（无桥接）
┌──────────────▼──────────────────────────┐
│ 页签内前端（Vue 3 SPA，web/）            │
│  ├─ 10 个页面（首页/课程/刷题/图谱…）     │
│  ├─ web/src/api（数据与业务 API 封装）    │
│  └─ 直接调 window.siyuanAiStudy / 思源 API│
└─────────────────────────────────────────┘
```

前端以 IIFE bundle 形式由主入口动态加载，并直接 mount 到页签元素上，与插件实例运行在同一渲染进程，无需 postMessage 桥接；外部 LLM 调用后续经思源内核 `/api/network/forwardProxy` 代理（绕过 CORS）。

## 数据模型

数据以 JSON 持久化，模型见 `src/data.ts`（与 `web/src/api/index.ts` 中的类型一致），覆盖：

服务商、模型、任务模型绑定、调用日志、课程、章节、知识点、资料、资料-章节关联、题目、答题记录、错题、学习计划、学习任务、讲解记录、复习调度、学习记录。

> 注：思源 `/api/query/sql` 为只读接口，无法建表/写数据，故数据存储采用 `loadData`/`saveData` 的 JSON 方案。

## 开发

```bash
npm install          # 安装依赖
npm run build        # 构建（前端 IIFE bundle + 插件主入口 → dist/）
npm run make-link    # 软链接 dist 到思源插件目录（开发调试）
node scripts/make_dev_link.js /path/to/SiYuan   # 或手动指定工作空间
```

在思源中：设置 → 集市 → 已下载 → 刷新 → 启用「AI 智能学习」，点击顶栏图标打开学习页签。

## 目录结构

```
├── plugin.json            # 插件清单
├── vite.config.ts         # 插件主入口构建配置
├── src/                   # 插件后端（主窗口侧）
│   ├── index.ts           # 入口：顶栏图标 + 页签 + 数据初始化 + 暴露 API
│   └── data.ts            # 数据模型 + 默认空数据
├── web/                   # 页签内前端（Vue 3）
│   ├── vite.config.ts     # IIFE bundle 构建
│   └── src/
│       ├── mount.ts       # 前端入口（挂载到页签元素）
│       ├── views/         # 10 个页面
│       ├── components/    # Sidebar / Topbar / NewCourseModal
│       ├── stores/        # theme / course / modal / provider
│       └── api/           # 数据与业务 API
├── i18n/                  # 多语言
└── prototype/             # UI 原型（HTML，供设计确认）
```

## 功能清单

核心学习链路已全部打通：

- [x] 大模型服务商管理（OpenAI 兼容）、连通性测试、模型列表拉取、AI 任务模型分配
- [x] 资料上传与文档文本解析（PDF/Word/PPT/TXT/Markdown，含 GBK 回退与标题结构识别；扫描件 PDF 可选内核 OCR 提取正文）
- [x] 章节树（手动搭建 / 按标题自动识别，可选 AI 矫正去噪合并 / 批量导入与删除）、知识点 AI 抽取（分块、去重、章节绑定）
- [x] AI 出题（单选/多选/判断/简答）、刷题即时批改、简答题 AI 阅卷
- [x] 错题归集、自研 SM2 间隔重复复习
- [x] 冯诺依曼讲解评估、AI 学习计划生成、学习统计与 AI 综合报告（导出 Markdown）
- [x] 知识图谱：AI 推理前置关系 / 手动连线、SVG 分层布局、掌握度着色、写入思源文档
- [x] 资料/章节/课程落库思源（可开关），课程/章节改名同步文档名，删除资料/课程级联清理（含资源目录源文件）

已知边界：

- 前端 UI 为中文单语（i18n 仅覆盖插件名/顶栏标题），英文界面待排期
- 删除资料时经 `removeUnusedAsset` 同步删除资源目录源文件；若源文件已被其他文档引用（如手动拖入笔记）或仍被其他资料共用，内核会跳过不删
- PDF 标题识别为字号/居中启发式，结构复杂的 PDF 需在目录预览中人工修正；可在「模型配置 → AI 任务模型分配」为「目录识别矫正」配置模型，重新识别时由 AI 自动去噪/合并/纠层（失败自动回退原始识别）
- 扫描件（纯图片 PDF）无文字层，需上传时勾选「OCR 识别扫描件」（逐页渲染图片调思源内核 OCR，耗时较长）；OCR 结果仅正文、无章节结构，目录需手动搭建；内核 OCR 仅思源桌面版可用，Web 版/移动端不可用
