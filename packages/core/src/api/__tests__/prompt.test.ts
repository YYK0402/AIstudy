import { describe, expect, it } from "vitest";
import { PROMPT_TASKS, renderPrompt } from "../promptTemplates";

const keys = Object.keys(PROMPT_TASKS);

describe("PROMPT_TASKS 任务集合", () => {
  it("新增 recognize_outline 与 merge_toc", () => {
    expect(keys).toContain("recognize_outline");
    expect(keys).toContain("merge_toc");
  });
  it("删除 recognize_toc（旧两级矫正任务）", () => {
    expect(keys).not.toContain("recognize_toc");
  });
  it("organize_doc 不再要求标注标题", () => {
    const tpl = PROMPT_TASKS.organize_doc;
    expect(tpl.system).not.toMatch(/标注|添加.*标题|markdown 标题/);
    expect(tpl.system).toMatch(/已有.*标题.*保留|保留.*标题.*原样/);
  });
  it("extract_kp 输出不再有 section 字段，且要求兄弟节点边界", () => {
    const tpl = PROMPT_TASKS.extract_kp;
    expect(tpl.system).not.toMatch(/section/);
    expect(tpl.system).toMatch(/兄弟/);
    expect(tpl.user).toContain("{{siblings}}");
  });
  it("所有模板变量可渲染（无未替换 {{}} 残留于占位符替换后）", () => {
    for (const [key, tpl] of Object.entries(PROMPT_TASKS)) {
      const vars = [...new Set((tpl.system + tpl.user).match(/\{\{(\w+)\}\}/g) ?? [])]
        .map((v) => v.replace(/[{}]/g, ""));
      const rendered = renderPrompt(tpl.user, Object.fromEntries(vars.map((v) => [v, "X"])));
      expect(rendered).not.toMatch(/\{\{\w+\}\}/);
      // system 无变量时也验证可渲染
      renderPrompt(tpl.system, {});
    }
  });
  it("三个大块任务 desc 带大上下文提示", () => {
    for (const key of ["recognize_outline", "merge_toc", "extract_kp"]) {
      expect(PROMPT_TASKS[key].desc).toMatch(/上下文|长文/);
    }
  });
});
