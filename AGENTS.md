# 项目规则

## 工作流程
- **先方案后动手**：任何代码改动（新功能 / 修改 / 重构 / 修 bug）动手前，必须先输出方案（目标、改动文件、关键设计、验证方式），经用户确认后才能实施。
  - 纯问答、排查定位、只读分析不需要方案。
  - 用户明确说“直接做”“按刚才的方案做”时可跳过确认。

## 构建与部署
- 插件目录是符号链接 `~/SiYuan/data/plugins/siyuan-ai-study -> <repo>/dist`。
- **日常迭代用 `npm run build:web && npm run build:plugin`（不 clean）**；`npm run build` 含 `clean` 会删 dist，思源内核会把插件当卸载（petal 掉线，需重启思源才恢复）。
- 改动后验证顺序：`npx vue-tsc --noEmit -p tsconfig.json && npx vue-tsc --noEmit -p web/tsconfig.json` → `npx vitest run`（纯函数 + 组件测试，`web/src/**/__tests__`）→ 上述构建 → 浏览器冒烟（涉真实思源能力的需真机确认）。
- 前端样式统一写在 `web/src/style.css`：`mount.ts` 只把该文件内联注入，组件 `<style scoped>` 会被抽到未被加载的 `dist/web/style.css`，样式不生效。

## 发布（集市上架）
- **集市只认 GitHub Release**：思源集市（bazaar）Stage 工作流每 1–3 小时按插件仓库「含 package.zip 的正式 GitHub Release」自动拉取索引。只 bump `plugin.json` 版本 + 推代码**不会**让新版进集市（v0.2.1–v0.2.4 事故：集市停在 v0.2.0 数日，2026-10-30 排查发现）。
- 标准发布流程（按顺序执行，不能止步于版本 bump）：
  1. 类型检查 + 测试（见「构建与部署」验证顺序）
  2. `plugin.json` 与 `package.json` 的 version 升到目标版本
  3. 功能提交（`feat: ...`）与版本 bump（`chore: 发布 vX.Y.Z（…）`）分开提交，push main
  4. `npm run build:web && npm run build:plugin && node scripts/make_install.js` 生成仓库根 `package.zip`（gitignored，脚本校验清单与包结构，失败会退出）
  5. `git tag vX.Y.Z <版本bump提交> && git push origin vX.Y.Z`
  6. `gh release create vX.Y.Z --title "AI 智能学习 vX.Y.Z" --notes-file <notes> package.zip`（notes 需覆盖自上一 Release 以来的全部变更，集市用户是从旧版直接跳新版）
  7. 验证：release 资产含 package.zip；1–3 小时后用下面命令复验集市版本
- 集市版本复验（思源运行中，默认端口 6806）：
  `curl -s -X POST -H "Content-Type: application/json" -d '{"frontend":"desktop"}' http://127.0.0.1:6806/api/bazaar/getBazaarPlugin`
  看 AIstudy 的 `version` / `repoRef`（repoRef = 集市已收录的 Release tag）
- 排错：部署状态见 siyuan-note/bazaar [Stage 工作流](https://github.com/siyuan-note/bazaar/actions/workflows/stage.yml)；长时间未更新查同仓库 `stage-fail` 标签 issue。本插件已在上架清单（plugins.txt），后续更新无需再提 PR。
