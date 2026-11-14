# 项目规则

## 工作流程
- **先方案后动手**：任何代码改动（新功能 / 修改 / 重构 / 修 bug）动手前，必须先输出方案（目标、改动文件、关键设计、验证方式），经用户确认后才能实施。
  - 纯问答、排查定位、只读分析不需要方案。
  - 用户明确说“直接做”“按刚才的方案做”时可跳过确认。
- **先拉后改**：每次代码修改前先 `git pull` 拉取远端最新代码；合并（merge/rebase/PR）前先检查有无冲突，有冲突先解决再继续，禁止盲目合并。

## 仓库结构（monorepo）
- npm workspaces：`packages/core`（全部功能，三端共享）+ `packages/siyuan`（思源适配器）；后续 `packages/fnos`、`packages/obsidian`。
- 根 `package.json` 是 private 容器（版本号的唯一来源）；`packages/siyuan/plugin.json` 是思源插件清单。

## 构建与部署
- 插件目录是**真实目录** `~/SiYuan/data/plugins/AIstudy`（内容 = `<repo>/dist` 的拷贝，目录名须与 `plugin.json` 的 name 一致，reloadPlugin 按此名匹配）。**禁止改回符号链接**：思源 S3 同步的 dejavu 快照 walk 不跟随符号链接目录，本地快照看不到插件文件而云端有 → 每轮恢复前检查必报 `file changed during recovery` 整轮同步中止（2026-11-07 事故根因）。
- **日常迭代用 `npm run build:web && npm run build:plugin && rsync -a --delete dist/ ~/SiYuan/data/plugins/AIstudy/`（不 clean）**；`npm run build` 含 `clean` 会删 dist，思源内核会把插件当卸载（petal 掉线，需重启思源才恢复）。rsync 后 reloadPlugin 生效。
- 改动后验证顺序：`npx vue-tsc --noEmit -p packages/siyuan/tsconfig.json && npx vue-tsc --noEmit -p packages/core/tsconfig.json` → `npx vitest run`（纯函数 + 组件测试，`packages/core/src/**/__tests__` 与 `packages/siyuan/src/__tests__`）→ 上述构建 → 浏览器冒烟（涉真实思源能力的需真机确认）。
- **冒烟由 agent 用 ego-browser 自动完成**（用户要求，不用 Google Chrome）：打开 `http://127.0.0.1:6806` → **整页刷新（page.reload）** → 点顶栏 `div[aria-label="AI 智能学习"]` 开页签 → 验证 `.ai-study-app` 挂载与课程数据 → 数据注入/业务路径走应用 UI → 测完清理测试数据。
  - 整页刷新是 fresh-mount 的唯一可靠方式：web bundle 每页会话只加载一次；**关页签重开 ≠ 重新挂载**——应用是单实例 + DOM 迁移（`mount.ts` 的 `findLiveRoot` 把活实例 adopt 到新面板），`onMounted` 不重跑，验证挂载期逻辑（如今日提醒）必须整页刷新；合成事件关页签可能不触发内核 destroy，实例会以隐藏 DOM 存活（判别法：`$pinia.state.value.notify.tasks` 里的历史条目仍在 = 旧实例）。
  - bridge 直传 `mount(el, bridge)`，**不再挂 `window.__AI_STUDY_BRIDGE__`**（契约重构后）。读应用状态：挂载根不在 `.ai-study-app` 及其祖先上，用 `[...document.querySelectorAll("div")].find((n) => n.__vue_app__)` 找挂载根（当前为 `div.fn__flex-1.fn__none`）→ `config.globalProperties.$pinia.state.value`（modal/course/notify/today 等 store，chapters/kps 不在 store 里，走 petal 文件）。
  - **内核 petal 缓存优先于磁盘**：直改 `~/SiYuan/data/storage/petal/AIstudy/` 文件插件不可见，整页刷新也不读盘（内核仅进程启动时读盘）；`/api/petal/*` HTTP API 空响应不可用。注入测试数据用 UI：首页「导入课程包」弹窗内「试一试示例课」一键导入完整课程（当前常量：4 章 + 12 知识点 + 20 题目/1 试卷/10 闪卡 + gen_plan 生成 14 天计划，含一次小规模真实 gen_plan AI 调用；导入后 bell 等 gen_plan done），清理走「课程主页 → 编辑课程信息 → 删除课程」（删课后 petal `course-<id>` 文件按设计保留为孤儿：加载只合并注册表内课程、`nextCourseId` 跳过磁盘孤儿 id，见 `utils/courseFileIds.ts`，2026-11-07 冒烟事故加固）；需要磁盘级注入时只能重启思源进程。petal 课程文件可直接 `json.load` 读数据真相（`~/SiYuan/data/storage/petal/AIstudy/course-<id>` 与 `data` 全局文件）。
- 前端样式统一写在 `packages/core/src/style.css`：`mount.ts` 只把该文件内联注入，组件 `<style scoped>` 会被抽到未被加载的 `dist/web/style.css`，样式不生效。
- **双端同发**：每次发版/打包，只要改动涉及 `packages/core`（两端共享）就必须两端一起打包——思源 `npm run build:web && npm run build:plugin && node scripts/make_install.js` + 飞牛 `npm run pack:fnos`，禁止只发一端导致两端包内 core 版本不一致。
- **端严格分离（不同展示端禁止互相携带产物，2026-11-07 事故教训）**：
  - `dist/` 是**思源端专用 staging**，其他端产物（如飞牛 `.fpk`）禁止输出到 `dist/` 下任何位置；`make_install.js` 对 dist 顶层做白名单硬校验，出现非思源条目即打包失败。
  - 各端打包产物只进本端目录：飞牛 `.fpk` → `packages/fnos/dist/ai-study.fpk`（`pack-fpk.sh` 已固定）；未来新端同理（`packages/<端>/dist/`）。
  - 各端打包器必须自带严格校验，fail-loud：思源 `make_install.js`（dist 顶层白名单）；飞牛 `validate-package.mjs`（包内禁止出现思源标记文件 `plugin.json`/`README-siyuan.md`）。新增端时同步补上对应端的隔离校验。
  - 部署到宿主工作空间（如 `~/SiYuan/data/plugins/AIstudy`）只拷贝本端产物；`rsync -a --delete dist/ ~/SiYuan/data/plugins/AIstudy/` 部署的就是纯思源 staging，无需 exclude。
  - core 三端共享的是**源码**（`packages/core`），不是产物目录；共享产物只允许单向引用（如飞牛 UI 复用 `dist/web/index.js` core bundle 作为输入）。

## 发版策略（2026-11-03 起）
- **功能迭代不发版、不推远端**：功能开发只做本地提交（commit 不 push origin），不 bump 版本、不打包/Release——版本停留在当前已发布版本（当前 v0.5.7），集市同步停留；本地 dist 照常构建供自己的思源使用。
- **BUG 修复走完整发版**：按下方「发布（集市上架）」标准流程执行（patch bump → 修复提交与版本 bump 分开提交 → 构建 → push main + tag → GitHub Release → 集市复验）。
- **功能批量发版**：时机由用户明确指定（如某功能批次完成后说「发版」），届时一次性执行标准流程；release notes 必须覆盖自上一 Release 以来的全部变更。

## 发布（集市上架）
- **集市只认 GitHub Release**：思源集市（bazaar）Stage 工作流每 1–3 小时按插件仓库「含 package.zip 的正式 GitHub Release」自动拉取索引。只 bump `plugin.json` 版本 + 推代码**不会**让新版进集市（v0.2.1–v0.2.4 事故：集市停在 v0.2.0 数日，2026-10-30 排查发现）。
- 标准发布流程（按顺序执行，不能止步于版本 bump）：
  1. 类型检查 + 测试（见「构建与部署」验证顺序）
  2. `packages/siyuan/plugin.json` 与根 `package.json` 的 version 升到目标版本
  3. 功能提交（`feat: ...`）与版本 bump（`chore: 发布 vX.Y.Z（…）`）分开提交，push main
  4. `npm run build:web && npm run build:plugin && node scripts/make_install.js` 生成仓库根 `package.zip`（gitignored，脚本校验清单与包结构，失败会退出）
  5. `git tag vX.Y.Z <版本bump提交> && git push origin vX.Y.Z`
  6. `gh release create vX.Y.Z --title "AI 智能学习 vX.Y.Z" --notes-file <notes> package.zip`（notes 需覆盖自上一 Release 以来的全部变更，集市用户是从旧版直接跳新版）
  7. 验证：release 资产含 package.zip；1–3 小时后用下面命令复验集市版本
- 集市版本复验（思源运行中，默认端口 6806）：
  `curl -s -X POST -H "Content-Type: application/json" -d '{"frontend":"desktop"}' http://127.0.0.1:6806/api/bazaar/getBazaarPlugin`
  看 AIstudy 的 `version` / `repoRef`（repoRef = 集市已收录的 Release tag）
- 排错：部署状态见 siyuan-note/bazaar [Stage 工作流](https://github.com/siyuan-note/bazaar/actions/workflows/stage.yml)；长时间未更新查同仓库 `stage-fail` 标签 issue。本插件已在上架清单（plugins.txt），后续更新无需再提 PR。
