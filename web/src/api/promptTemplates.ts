// 提示词模板中心：11 类 AI 任务的默认模板 + 变量占位符渲染
// 模板中用 {{varName}} 占位，调用点通过 renderPrompt 注入实际值；
// 未知占位符原样保留（便于用户在自定义模板中发现笔误）。
import type { AppData, PromptTemplateDef } from "../types/appData";

export interface PromptVarInfo {
  name: string;
  desc: string;
}

export interface PromptTaskMeta {
  key: string;
  name: string;
  /** 任务用途一句话说明（设置页展示） */
  desc: string;
  /** 模板可用变量清单（system + user 中出现的占位符） */
  vars: PromptVarInfo[];
  defaultTemplate: PromptTemplateDef;
}

export const PROMPT_TASKS: PromptTaskMeta[] = [
  {
    key: "extract_kp",
    name: "文档知识点抽取",
    desc: "整章抽取课程知识点（带课程目录与已有知识点上下文）",
    vars: [
      { name: "locator", desc: "文本位置说明（章名或「文本片段（第 i/N 块）」）" },
      { name: "blockText", desc: "当前分块文本内容（通常为一整章，含章内节结构）" },
      { name: "courseName", desc: "课程名称" },
      { name: "tocLines", desc: "课程完整目录，每行「章 / 节」" },
      { name: "existingKpNames", desc: "课程已有知识点名称列表（用于去重，可能为「（暂无）」）" },
    ],
    defaultTemplate: {
      system:
        "你是教材知识点设计师，为课程《{{courseName}}》设计有利于学习和考核的知识点体系。\n" +
        "课程目录：\n{{tocLines}}\n" +
        "提取策略：基于标题结构提取。文本中的标题层级包括：# 章标题、## 节标题、" +
        "一/二/三或（一）（二）等子标题。每个子标题所覆盖的内容范围，就是一个知识点。\n" +
        "合并规则：同一标题下的编号子要点（如一、二、三列出的特征/表现/原因/影响）属于同一个知识点，" +
        "合并在 description 中，不要拆成多个知识点；但如果每个子项本身是独立概念（如不同条约、不同事件、不同定理、不同人物），各自独立为知识点。\n" +
        "数量标准：以内容结构为准，不设固定数量，避免过度拆分。\n" +
        "name 必须用教材原词（2-20 字），禁止自造词；" +
        "description 覆盖该知识点下的所有核心要点，保持完整性，通常 2-4 句，优先采用教材原文表述，含公式或关键数值时逐字保留。\n" +
        "课程已有知识点（避免重复与同义拆分，但不要因此遗漏本段新概念）：\n{{existingKpNames}}\n" +
        "输出 JSON 数组，每项含 name、description、section 三个字段。" +
        "section = 该知识点在正文中所属小节的标题，照抄原文小节名（如「第一节 长期筹资概述」）；正文无小节结构或无法判断时填空字符串。" +
        "只返回 JSON，不要任何其他文字。",
      user: "{{locator}}：\n{{blockText}}",
    },
  },
  {
    key: "gen_plan",
    name: "AI 学习计划生成",
    desc: "在系统学习骨架上穿插补充复习/练习任务",
    vars: [
      { name: "courseName", desc: "课程名称" },
      { name: "today", desc: "今天日期（YYYY-MM-DD）" },
      { name: "targetDate", desc: "目标完成日期（YYYY-MM-DD）" },
      { name: "days", desc: "总天数" },
      { name: "dailyHour", desc: "每日学习时长（小时）" },
      { name: "skeletonLines", desc: "学习骨架，每行「日期：id. 知识点名、id. 知识点名」" },
    ],
    defaultTemplate: {
      system:
        "你是学习计划规划师。课程的学习骨架（每个知识点一条 learn 任务）已由系统按天排好，你只负责穿插补充 review（复习）/ practice（练习）任务。" +
        "输出 JSON 数组，每项含 date（YYYY-MM-DD，必须在规定日期范围内）、taskType（'review' 或 'practice'）、kpId（关联知识点 id，整数；不针对特定知识点填 0）、title（任务标题，简洁具体，含知识点名）。" +
        "要求：practice 安排在对应知识点学习日之后；后期穿插整体复习；数量与每日时长匹配（每天 1-2 条为宜）；不要输出 learn 任务。" +
        "只返回 JSON 数组，不要任何其他文字。",
      user:
        "课程：{{courseName}}\n今天是：{{today}}\n目标日期：{{targetDate}}（共 {{days}} 天）\n每日学习时长：{{dailyHour}} 小时\n\n学习骨架（日期：id. 知识点名）：\n{{skeletonLines}}",
    },
  },
  {
    key: "gen_question",
    name: "AI 习题生成",
    desc: "围绕选中知识点按题型/难度生成习题",
    vars: [
      { name: "qType", desc: "题型键：single / multiple / judge / essay / cloze / translation" },
      { name: "difficulty", desc: "难度键：easy / medium / hard" },
      { name: "courseName", desc: "课程名称" },
      { name: "count", desc: "生成题数" },
      { name: "qTypeLabel", desc: "题型中文名（如「单选」）" },
      { name: "diffLabel", desc: "难度中文名（如「中等」）" },
      { name: "kpLines", desc: "知识点列表，每行「- id. 名称：描述」" },
    ],
    defaultTemplate: {
      system:
        "你是习题命题助手。根据给定知识点及描述出题。输出 JSON 数组，每项含：" +
        "qType（'{{qType}}'）、kpIds（关联知识点 id 数组）、title（题干）、options（选项文本数组）、answer（正确答案）、analysis（解析）、difficulty（'{{difficulty}}'）。" +
        "各题型要求——" +
        "single：options 恰好 4 项，answer 为正确选项文本；" +
        "multiple：options 恰好 4-5 项，answer 为多个正确选项文本以逗号分隔；" +
        'judge：options 固定为 ["正确","错误"]，answer 为「正确」或「错误」；' +
        "essay：options 为空数组 []，answer 为参考答案要点；" +
        "cloze：options 为空数组 []，题干中包含 ____ 表示填空位置，answer 为填空的正确答案文本；" +
        "translation：options 为空数组 []，题干为待翻译原文，answer 为参考译文。" +
        "只返回 JSON 数组，不要任何其他文字。",
      user:
        "课程：{{courseName}}\n共出 {{count}} 道 {{qTypeLabel}} 题，难度{{diffLabel}}。\n仅围绕以下知识点命题，如知识点数量多于题数可跨题分布：\n\n{{kpLines}}",
    },
  },
  {
    key: "eval_explain",
    name: "讲解内容评估",
    desc: "费曼复述评分：正确性/覆盖度/清晰度，0-100",
    vars: [
      { name: "kpName", desc: "知识点名称" },
      { name: "kpContent", desc: "要点基准（知识点描述，无描述时调用方已填占位说明）" },
      { name: "userContent", desc: "学生的讲解原文" },
    ],
    defaultTemplate: {
      system:
        "你是教学评估专家。学生学习了某知识点后用自己的话向你讲解（冯诺依曼学习法），你评估讲解质量。" +
        "从三方面打分并综合为 0-100 整数：正确性（有无事实/逻辑错误，错一处大幅扣分）、覆盖度（相对要点基准遗漏多少）、清晰度（表达是否通顺有条理）。" +
        '输出 JSON 对象：{"score": 0-100, "feedback": "中文点评，两三句：先说讲对了哪些，再指出理解偏差或遗漏，最后给一条补强建议"}。只返回 JSON。',
      user: "知识点：{{kpName}}\n要点基准（描述）：{{kpContent}}\n\n学生讲解：\n{{userContent}}",
    },
  },
  {
    key: "gen_ask",
    name: "费曼提问生成",
    desc: "按知识点内容生成针对性提问，供输出式练习使用",
    vars: [
      { name: "courseName", desc: "课程名称" },
      { name: "kpName", desc: "知识点名称" },
      { name: "kpContent", desc: "知识点描述（无描述时调用方已填占位说明）" },
    ],
    defaultTemplate: {
      system:
        "你是费曼学习法教练。根据给定知识点生成一句中文提问，让学生用自己的话讲解该知识点。" +
        "要求：提问必须针对该知识点自身的内容，并采用对应学科的思维（数学/公式类问条件、推导或如何套用；编程类问代码示例、适用场景或常见坑；法律类问案例或适用情形；经管类问含义、构成或怎么用）；" +
        "禁止问「为什么重要」这类元问题，也不要评价知识点本身；" +
        "学生回答这个问题时应能覆盖：它是什么、怎么理解，以及尽可能举例或说明使用场景。" +
        "一两句话，口语自然，以「请」字开头。只返回提问文本，不要引号、序号或任何其他字符。",
      user: "课程：{{courseName}}\n知识点：{{kpName}}\n知识点描述：{{kpContent}}",
    },
  },
  {
    key: "grade_answer",
    name: "简答题 AI 阅卷",
    desc: "简答题按参考答案判分 + 点评",
    vars: [
      { name: "title", desc: "题目题干" },
      { name: "answer", desc: "参考答案" },
      { name: "userAnswer", desc: "学生作答（未作答时调用方已填占位说明）" },
    ],
    defaultTemplate: {
      system:
        "你是简答题阅卷老师。根据参考答案对学生作答判分：抓住要点即可，不逐字抠，表述不同但要点达意同样给分。" +
        '输出 JSON 对象：{"score": 0-100 的整数, "feedback": "简要点评（答对了哪些、遗漏了什么，一两句话）"}。只返回 JSON。',
      user: "题目：{{title}}\n\n参考答案：{{answer}}\n\n学生作答：{{userAnswer}}",
    },
  },
  {
    key: "gen_report",
    name: "学习报告生成",
    desc: "基于统计数据生成 Markdown 学习报告",
    vars: [
      { name: "courseName", desc: "课程名称" },
      { name: "target", desc: "课程目标（未设定时调用方已填占位说明）" },
      { name: "statsJson", desc: "学习统计数据（格式化 JSON）" },
      { name: "kpLines", desc: "知识点清单，每行「- 名称[掌握度]」" },
    ],
    defaultTemplate: {
      system:
        "你是学习顾问。根据用户的学习统计数据写一份学习报告（Markdown 格式），包含四个二级标题：## 学习行为总结、## 薄弱环节分析、## 下阶段建议、## 鼓励。\n" +
        "点评要有依据（引用具体数字）；薄弱环节结合掌握度分布、答题正确率、未掌握知识点指出；建议要具体可执行（时间段/时长/复习策略）。中文，500 字以内。只返回 Markdown 正文。",
      user:
        "课程：{{courseName}}\n目标：{{target}}\n\n统计数据（JSON）：\n{{statsJson}}\n\n课程知识点：\n{{kpLines}}",
    },
  },
  {
    key: "infer_graph",
    name: "图谱关联关系推理",
    desc: "推断知识点之间的前置关系",
    vars: [{ name: "kpLines", desc: "知识点列表，每行「- id. 名称：描述」" }],
    defaultTemplate: {
      system:
        "你是知识结构分析助手。根据给定的知识点推断它们之间的前置关系（学习某知识点前需要先掌握另一个知识点才属于前置）。" +
        '输出 JSON 数组，每项 {"kpId": 当前知识点 id, "prevKpIds": 前置知识点 id 数组}。' +
        "规则：id 必须来自给定列表；不允许自引用；没有明确前置关系的知识点 prevKpIds 为空数组；关系要少而准，不要臆造。只返回 JSON 数组。",
      user: "知识点列表：\n{{kpLines}}",
    },
  },
  {
    key: "recognize_toc",
    name: "目录识别矫正",
    desc: "矫正自动识别的教材标题层级（章=L1 / 节=L2）",
    vars: [{ name: "lines", desc: "识别到的标题列表，每行「序号. [L1|L2] 标题文本」" }],
    defaultTemplate: {
      system:
        "你是教材目录分析助手。输入是按文档顺序自动识别的标题列表（L1=章，L2=节）。请做以下矫正：" +
        "1) 删除非标题项：封面标题、页眉页脚、公式、题号、选项行、表格内容；" +
        "2) 合并同一标题的重复/变体表述（如「第1章 极限」与「第一章 极限」），保留更完整的写法；" +
        "3) 修正层级错误：章应为 L1，章下的小节应为 L2；" +
        "4) 不要臆造输入中不存在的标题，不要改变原标题含义，保持文档顺序。" +
        '输出 JSON 数组，每项 {"text": 标题文本, "level": 1 或 2}。只返回 JSON 数组，不要任何其他文字。',
      user: "识别到的标题列表：\n{{lines}}",
    },
  },
  {
    key: "gen_flashcard",
    name: "AI 闪卡生成",
    desc: "为选中知识点生成双面闪卡（正面问题 / 背面答案要点）",
    vars: [
      { name: "courseName", desc: "课程名称" },
      { name: "kpLines", desc: "知识点列表，每行「i. 名称：描述」（i 为 0 起序号，供输出 index 字段引用）" },
    ],
    defaultTemplate: {
      system:
        "你是闪卡制作助手。根据给定的知识点及其描述，为每个知识点生成一张双面闪卡。" +
        "front（正面）= 一个中文提问：简洁、可凭记忆作答、覆盖该知识点的核心（可以是定义/解释/构成/应用/易错点角度），禁止「为什么重要」这类元问题；" +
        "back（背面）= 答案要点：1-3 句、抓要点不展开，以知识点描述为依据，不得编造描述之外的具体事实（公式、数值须与描述一致）。" +
        "输出 JSON 数组，每项含 index（对应输入列表中的知识点序号，0 起的整数，与输入一一对应）、front（问题文本）、back（答案要点文本），条数与知识点数一致。" +
        "只返回 JSON 数组，不要任何其他文字。",
      user: "课程：{{courseName}}\n知识点列表（i. 名称：描述）：\n{{kpLines}}",
    },
  },
  {
    key: "organize_doc",
    name: "文档结构梳理",
    desc: "整理资料正文（去页眉页脚水印噪声、拼断行、修复 OCR 缺字误识、标注章/节标题）",
    vars: [{ name: "chunk", desc: "资料原文的一个片段（按顺序分段，每段约 8000 字符）" }],
    defaultTemplate: {
      system:
        "你是教材文本整理助手。输入是教材/讲义原文的一个片段（从完整资料中按顺序截取，前后还有相邻片段；文本可能来自 PDF 解析或 OCR 识别，可能含有识别噪声）。请做以下六件事：" +
        "1) 删除非正文噪声：页眉、页脚、页码、书籍名称/网站/版权水印、每页重复的样板文字（如版权声明、重复出现的标题栏）——每页开头或结尾重复出现的内容通常是页眉页脚；" +
        "2) 把被换行截断的句子拼回完整（同一句话断成多行时合并为一段），必要时调整措辞使语句通顺；" +
        "3) 修复明显的识别错误：对 OCR/解析导致的缺字、错字、多字，根据上下文修正；" +
        "4) 正文的事实内容不得删减或遗漏，但允许调整段落结构和改写不通顺的语句，使整体可读；" +
        "5) 识别标题并加 markdown 前缀，共三级：" +
        "   - 章标题（如「第X章」「第X部分」）行首加「# 」" +
        "   - 节标题（如「第X节」「X.X」）行首加「## 」" +
        "   - 子标题（如「一、二、三」「（一）（二）」「1. 2.」等独立成行的主题名）行首加「### 」；" +
        "6) 标题误判修正：只有独立成行且前后有空行或段落边界的行才是标题；" +
        "正文中的短语、段落首行、编号列表项（如「①xxx」）不得标记为标题。" +
        "标题行只加前缀、不改原文；输出整理后的片段全文，不要任何解释、不要代码块围栏。",
      user: "待整理片段：\n{{chunk}}",
    },
  },
];

export function findPromptTask(key: string): PromptTaskMeta | undefined {
  return PROMPT_TASKS.find((t) => t.key === key);
}

/** 渲染模板：替换 {{var}}；未知占位符原样保留 */
export function renderPrompt(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (m, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m,
  );
}

/** 取任务生效模板：自定义优先，未覆盖用内置默认 */
export function resolvePromptTemplate(data: AppData, taskKey: string): PromptTemplateDef {
  const custom = data.promptTemplates?.[taskKey];
  if (custom && typeof custom.system === "string" && typeof custom.user === "string") {
    return { system: custom.system, user: custom.user };
  }
  const meta = findPromptTask(taskKey);
  if (!meta) {
    throw new Error(`未知提示词任务：${taskKey}`);
  }
  return { ...meta.defaultTemplate };
}
