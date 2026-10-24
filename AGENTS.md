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
