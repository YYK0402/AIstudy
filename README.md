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

## 待实现

骨架已打通「顶栏图标 → 页签 → 直接挂载 → 数据读写 → 页面渲染」，以下业务能力待接入：

- [ ] 大模型服务商连通性测试、AI 调用（经 `/api/network/forwardProxy` 代理）
- [ ] 资料上传与文档文本解析（PDF/Word/PPT）
- [ ] 知识点增量抽取
- [ ] AI 学习计划生成
- [ ] AI 出题、简答阅卷
- [ ] 冯诺依曼讲解评估
- [ ] 间隔重复调度（自研 SM2）
- [ ] 学习报告导出
