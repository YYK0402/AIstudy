# Obsidian 移植方案

> 状态：规划中，暂未启动。本文记录把「AI 智能学习」从思源插件移植到 Obsidian 的调研结论、架构策略与实施计划，供后期启动时参照。
>
> 最后更新：2026-10-30（思源版 v0.3.1 已发布）

## 背景

「AI 智能学习」目前是思源笔记插件（`siyuan-ai-study`），已上架思源集市。Obsidian 与思源同为 local-first + Markdown 的笔记软件，用户群有重叠。目标是让插件也能在 Obsidian 上使用并上架 Obsidian 社区插件目录。

**核心结论**：这不是「打包上传」，而是**移植**——两个平台的内核 API、数据模型、UI 宿主都不同。前端 + AI + 纯逻辑可大量复用，但平台桥接层、存储、资料解析/OCR、笔记落库需要重写。

## 一、Obsidian 社区插件上架流程（已核实）

与思源集市类似，均为「公开 GitHub 仓 + Release + 提 PR 进索引」：

1. **公开 GitHub 仓库**，默认分支放：`manifest.json`、`main.js`、`styles.css`、`README.md`
2. **打 GitHub Release**，tag 必须 == `manifest.json` 的 `version`；Obsidian 从 **Release**（不是 repo 默认分支、也不是 package.zip）拉取 `main.js`/`manifest.json`/`styles.css`
3. **提 PR** 到 `obsidianmd/obsidian-releases`，往 `community-plugins.json` 追加一条：`{ id, name, author, description, repo }`（`repo` 形如 `YYK0402/xxx`）
4. **评审**：须符合 Obsidian developer policies。AI 联网调用**必须在 README 披露**；无未披露的数据采集；manifest 有效
5. 合并后进入 Obsidian 客户端「社区插件」列表

`manifest.json` 必填字段：`id` / `name` / `version` / `minAppVersion` / `description` / `author` / `isDesktopOnly`（可选 `authorUrl`）。

**拉取机制细节**（摘自 obsidian-releases README）：
- Obsidian 读 `community-plugins.json`，用 `name`/`author`/`description` 做搜索
- 用户打开详情页时，从你的 repo 拉 `manifest.json` + `README.md`
- `manifest.json` 只用于确定最新版本号；实际文件从 GitHub Release 下载
- 若 `minAppVersion` 高于当前 App，会查 `versions.json` 找兼容版本

## 二、移植策略：共享核心 + 薄平台适配器（monorepo）

### 2.1 「后期功能要不要开发两遍」

取决于架构：

- **fork 两份代码各自维护** → 每个功能写两遍，且两份会越漂越远。**不推荐。**
- **共享核心 + 薄平台适配器（推荐）** → 业务功能只写一遍。标准 ports & adapters（六边形架构）做法。

### 2.2 分层：共享 vs 每平台

| 层 | 是否共享 | 说明 |
|---|---|---|
| 数据模型 `AppData` | ✅ 共享 | 类型定义一份 |
| 纯逻辑（SM2 / 排期 / 甘特 / 课程包 zip / 出题提示词） | ✅ 共享 | 纯函数 + 测试原样搬，现有已较干净 |
| AI 调用层（fetch 直连 OpenAI 兼容端点） | ✅ 共享 | 平台无关，跑在渲染进程 |
| Vue 前端（所有视图 UI + 交互） | ✅ 共享 | 前提：把 `window.siyuanAiStudy.*` 抽象成 `PlatformAPI` 接口，注入而非读全局 |
| **桥接层**（文档增删改 / 存储 / 挂载 / 资产 / OCR） | ❌ 每平台一份 | 思源内核 vs Obsidian API |

**结论**：占代码量约 70–80% 的学习业务（AI 讲解、刷题、闪卡、复习、计划、甘特、报告）平台无关，抽出共享后**新功能基本只开发一遍**；只有碰「平台 I/O 边界」的功能（新文档操作、OCR、挂载差异）才需两边各补一点。

### 2.3 一次性成本

现前端直接调 `window.siyuanAiStudy` 全局对象。要共享，需先重构成 `PlatformAPI` 接口 + 两个实现（SiYuan / Obsidian）。这一步是**纯重构**，用现有 280 个测试兜底，思源侧行为不变。

### 2.4 永远双倍的（运维，非开发）

两次构建、两份 manifest 版本、两个商店提交、两套发布流水线。用 **monorepo**（共享 `core/` + `siyuan/` + `obsidian/`，一个仓两个构建目标）避免两仓漂移。

## 三、MVP 范围

**目标**：Obsidian 里最小可用闭环——建课、AI 讲解、刷题、闪卡复习，先验证桥接层跑通，再扩。

**做**
- 数据 `loadData/saveData`
- 桥接层（见 4.1 映射表）
- Vue app 挂进 `ItemView`
- 设置页（模型配置）
- AI 费曼讲解
- 刷题（出题 + 作答 + 批改）
- 闪卡 + SM2 复习
- 基础学习计划

**不做（后置）**
- **资料文件解析 / OCR**（PDF / Word / PPT，最重的块）
- 自动落库笔记
- 知识图谱
- 学习报告
- 课程包导出/导入（zip 逻辑可共享，但资产上传部分平台相关）

## 四、桥接映射（思源 → Obsidian）

### 4.1 能力映射表

| 能力 | 思源（现状） | Obsidian |
|---|---|---|
| 读写数据 | petal `saveData/getData` | `plugin.loadData()/saveData()`（plugin-data.json） |
| Toast | `showMessage` | `new Notice(msg)` |
| AI 调用 | fetch（已平台无关） | 同 fetch，配置来自 settings |
| 建 / 改 / 删文档 | `createSiyuanDoc` / `renameSiyuanDoc` / `removeSiyuanDoc` | `vault.create` / `vault.rename` / `vault.delete` |
| 读文档 | `getSiyuanDocMarkdown` | `vault.read(file)` |
| 文档是否存在 | `siyuanDocExists` | `vault.getAbstractFile / getCachedMarkdown` |
| 上传资产 | `/api/asset/upload` | `vault.createBinary`（附件 = vault 内文件） |
| OCR | `ocrAsset`（思源内置，仅桌面） | **无等价** → 外部服务 / 后置 |
| 挂载 | 思源页签 + `AiStudyApp.mount` | `ItemView`（挂 `view.contentEl`）+ ribbon 图标 + command |
| 设置页 | web `SettingsView` | `PluginSettingTab`（复用 Vue 设置视图） |

### 4.2 `PlatformAPI` 接口（草案）

把现 `StudyApi`（`src/index.ts`）的对外方法抽成平台无关接口，前端依赖此接口；思源 / Obsidian 各给一份实现，mount 时注入。

```
interface PlatformAPI {
  // 数据
  getData(): AppData;
  saveData(data: AppData): Promise<{ code: number; msg?: string }>;
  // 提示
  showMessage(message: string, timeout?: number, type?: "info" | "error"): void;
  // AI（平台无关，可下沉到共享层，接口仅透传配置）
  callAi(input: CallAiInput): Promise<CallAiResult>;
  cancelAiCall(taskKey: string, scope?: string): void;
  // 笔记文档（MVP 可先抛「暂不支持」）
  createDoc(markdown: string, name: string): Promise<{ id: string }>;
  readDoc(id: string): Promise<string | null>;
  renameDoc(id: string, name: string): Promise<void>;
  deleteDoc(id: string): Promise<void>;
  // 资产
  uploadAsset(file: File): Promise<{ assetPath: string }>;
  ocrAsset(assetPath: string): Promise<string>; // Obsidian 端 MVP 抛不支持
}
```

> 注：思源现接口里的 `ensureNotebook` / `moveSiyuanDoc` 等思源特有方法，抽接口时归入「可选扩展」，前端按能力探测降级。

## 五、仓库结构（monorepo）

```
AIstudy/
  core/            # 共享：types、纯逻辑、AI、Vue app（PlatformAPI 解耦）
  siyuan/          # 现有 src + web（改成依赖 core + SiYuan PlatformAPI 实现）
  obsidian/        # 新：manifest.json、main.ts(extends Plugin)、esbuild.config.mjs
  package.json     # workspace 根
```

## 六、构建链

- **Obsidian 端**：esbuild → `main.js`（CJS，`target: es2018`，`external: ["obsidian", "electron", "electron-updater", "@codemirror/*"]`）
- **Vue app**：构建为 ESM 库，两端 `import` 并在 mount 时注入各自 `PlatformAPI`（替代现 IIFE + 读 `window.siyuanAiStudy` 的方式）
- **思源端**：保持现有 `build:web` + `build:plugin` 流程，仅入口改为注入 SiYuan 实现
- 发布：两端各自 manifest 版本、各自 Release / 商店提交

## 七、里程碑

| 里程碑 | 内容 | 产出 |
|---|---|---|
| **M0** | monorepo 重构 + 抽 `PlatformAPI`（纯重构，280 测试兜底，思源侧行为不变） | 可共享的 `core/`，思源版回归通过 |
| **M1** | Obsidian 骨架：manifest + esbuild + `ItemView` 挂载 + 设置页 + 数据读写 | Obsidian 里能打开看到首页 |
| **M2** | AI 讲解 + 刷题 + 闪卡 SM2（核心学习闭环） | 最小可用 MVP |
| **M3** | 学习计划 + 甘特（纯前端，直接加） | 计划闭环 |
| **M4** | 资料解析（先纯文本）→ OCR（外部服务） | 资料导入 |
| **M5** | 落库笔记、课程包、知识图谱、报告（增量） | 功能对齐 |
| **M6** | 上架：Release（tag=version，含 main.js/manifest/styles.css）+ 提 PR 进 `community-plugins.json` | Obsidian 社区可安装 |

## 八、待拍板事项（启动前需确认）

1. **M0 共享重构的时机**：现在先做（前期干净但先付重构成本），还是先「复制一份」把 Obsidian MVP 跑通、验证需求后再回头抽共享（快但短期两份代码）？
2. **资料解析是否进 MVP**：建议不进，先手动建课 / 导入，把最重的 OCR 后置。
3. **桌面端 or 移动端**：建议先 `isDesktopOnly: true`（移动端会限制可用 API）。

## 九、参考

- Obsidian 开发者文档：https://docs.obsidian.md
- 提交插件指南：https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin
- 开发者政策：https://docs.obsidian.md/Developer+policies
- 社区插件索引仓：https://github.com/obsidianmd/obsidian-releases（`community-plugins.json`，现约 9600+ 插件）
- 思源集市索引仓：https://github.com/siyuan-note/bazaar（`plugins.txt`）
