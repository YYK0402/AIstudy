import { isNewerVersion } from "../utils/version";

/** 单条更新内容：head 为分组标题（挂在该组首条上），text 为条目正文 */
export interface ChangelogItem {
  head?: string;
  text: string;
}

export interface ChangelogEntry {
  version: string;
  /** YYYY-MM-DD */
  date: string;
  /** 一句话概述（可选） */
  intro?: string;
  items: ChangelogItem[];
}

/**
 * 内置更新日志（随包分发，不发起运行时请求）。
 * 约定：按版本从新到旧排列；每次发版在数组头部追加一条，内容对应 GitHub Release notes。
 */
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "0.3.1",
    date: "2026-10-30",
    intro: "课程包导出/导入（点对点分享）+ 学习计划暂停冻结 + 亮暗主题三态",
    items: [
      { head: "课程包导出 / 导入", text: "课程主页一键「导出课程包」，打包为一门课程的 .zip：章节 / 知识点 / 资料（文本 + 目录），可勾选附带领题库试卷、闪卡、原始资料文件" },
      { text: "首页「导入课程包」选择 .zip 即生成一门新课程：自动重映射 id 与全部外键、同名课程自动加「（导入）」后缀" },
      { text: "仅含课程本体，不含个人学习进度（掌握度 / 错题 / 复习队列 / AI 讲解）与本地文档绑定；纯本地、无后端，点对点分享" },
      { head: "学习计划", text: "暂停 = 排期冻结：暂停时记录暂停日，恢复时未完成任务与目标日期整体顺延暂停天数，已完成任务不动" },
      { text: "暂停标签显示「已暂停 · 自 MM/DD」，恢复时 toast 提示顺延条数与天数" },
      { head: "外观", text: "顶栏亮暗主题三态：自动 / 亮 / 暗，默认自动（06:00–18:00 亮、其余暗，跨时段自动切换）" },
    ],
  },
  {
    version: "0.3.0",
    date: "2026-10-30",
    intro: "学习计划甘特图视图 + UI 审计优化全量落地 + 3.8.9 兼容加固",
    items: [
      { head: "学习计划", text: "新增甘特图视图：章节 / 知识点任务条，按任务类型着色（学习 / 练习 / 复习 / 测验），已完成划线" },
      { text: "时间粒度聚焦（仿飞书）：全部 / 周 / 月 / 季 / 年切换，今天定位与区间翻页" },
      { text: "甘特内直接勾选任务、展开排期格查看当日任务明细、逾期任务顺延" },
      { text: "计划覆盖卡默认只列未排期知识点，全部排期可展开查看" },
      { head: "资料识别", text: "目录与知识点按课程全部资料聚合识别（聚合目录预览 / 确认后批量抽取未抽资料 / 多文件上传）" },
      { text: "修复分册合并目录时章节顺序错乱" },
      { head: "兼容性", text: "文档创建传 parentID 消歧，兼容 3.8.9 新标题模式（同名祖先 / 斜杠标题错误提示）" },
      { text: "修复 bazaar 校验：kernels 仅声明 all" },
      { head: "UI 与交互", text: "修复解析块不显示、报告堆叠条被压扁、填空翻译 tag 无色、闪卡列表无样式等 P0 缺陷" },
      { text: "16 处 window.confirm 替换为统一 ConfirmModal" },
      { text: "深色分层色值与浅色对比度优化、标题层级与间距节奏" },
      { text: "可访问性：答题 / 开关 / 弹窗键盘化、焦点陷阱、点击目标扩大" },
      { text: "顶栏新增「反馈 / 建议」入口（飞书表单）" },
    ],
  },
  {
    version: "0.2.0",
    date: "2026-10-28",
    intro: "稳定性大修 + 大批量数据体验优化（v0.1.0 之后累计 40 项审计修复全部落地）",
    items: [
      { head: "AI 调用", text: "长任务（出题/闪卡/资料解析）进行中可取消，不再空等" },
      { text: "AI 回复解析统一加固：思考块、代码围栏、截断 JSON 均能正确提取" },
      { text: "知识点过多时明确报错提示分批，超长上下文自动截断并注记" },
      { head: "数据与性能", text: "题库 / 错题本 / 闪卡列表分页（50 条每页），大批量题目不再卡顿" },
      { text: "页面切换保留浏览状态，返回不重新加载" },
      { text: "学习日志与作答记录超保留期自动归档为月度汇总（默认 90 天，设置页可配 90/180/365/永久），累计统计口径不变" },
      { text: "学习对话文档单知识点超 50 轮时折叠显示最近轮次" },
      { text: "列表 / 章节树 / 知识图谱的 O(n²) 热点优化" },
      { head: "稳定性", text: "修复 23 项 P0/P1 缺陷：数据保存与并发覆盖、思源笔记文档同步、切课数据竞态、级联删除遗漏等" },
      { text: "保存性能优化：只写有变化的课程文件" },
      { text: "修复 11 项健壮性问题（错误提示、空态、边界条件）" },
    ],
  },
  {
    version: "0.1.0",
    date: "2026-10-27",
    intro: "基于可自定义大模型服务商的思源自学课程插件：资料导入、知识点拆解、学习计划、题库刷题、错题复盘、知识图谱、学习报告",
    items: [
      { text: "支持任意 OpenAI 兼容大模型服务商，按任务分配模型" },
      { text: "PDF / Word / PPT / TXT / Markdown 资料解析（扫描件 OCR）" },
      { text: "费曼式讲解 + SM2 间隔重复复习" },
      { text: "课程 / 知识点 / 学习对话自动落库为笔记文档" },
    ],
  },
];

/**
 * 取高于 seenVersion 的更新条目（保持新到旧）。
 * seenVersion 为 null/空 → 返回全部（常驻「更新日志」入口用）。
 */
export function changelogSince(entries: ChangelogEntry[], seenVersion: string | null): ChangelogEntry[] {
  if (!seenVersion) return [...entries];
  return entries.filter((e) => isNewerVersion(e.version, seenVersion));
}
