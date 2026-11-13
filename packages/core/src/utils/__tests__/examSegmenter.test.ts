import { describe, expect, it } from "vitest";
import { segmentExamPaper } from "../examSegmenter";

const PAPER_1 = `# 2024年考研政治真题
（考试时间 180 分钟，满分 100 分）

一、单选题（每题 2 分，共 10 分）
1. 下列对货币时间价值理解正确的是？
A. 资金的现值
B. 资金随时间推移产生的增值
C. 未来资金的折现
D. 风险报酬
2. 中央银行最主要的货币政策工具是？
A. 存款准备金率
B. 公开市场操作
C. 再贴现率
D. 财政税收政策

二、多选题（每题 3 分，共 9 分）
3. 下列属于货币政策工具的有？
A. 存款准备金率
B. 公开市场操作
C. 再贴现率
D. 税收政策
4. 通货膨胀的表现形式包括？
A. 物价总水平持续上涨
B. 货币购买力下降
C. 利率固定不变
D. 资产价格扭曲

三、简答题（每题 5 分，共 10 分）
5. 简述货币时间价值的含义。
6. 简述财政政策的主要工具。

【参考答案】
1-2: B B
3. A B C
4. A B D
5. 货币时间价值是指资金在投资过程中随时间推移产生的增值。
6. 财政政策的主要工具是财政支出与收入。
解析：货币时间价值是金融决策的核心概念。`;

describe("segmentExamPaper", () => {
  it("按大题与题号切题，题干/选项/大题归属完整", () => {
    const r = segmentExamPaper(PAPER_1);
    expect(r.questions.map((q) => q.num)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(r.questions[0].title).toContain("货币时间价值");
    expect(r.questions[0].options).toEqual(["资金的现值", "资金随时间推移产生的增值", "未来资金的折现", "风险报酬"]);
    expect(r.questions[0].sectionName).toContain("单选题");
    expect(r.questions[4].sectionName).toContain("简答题");
    expect(r.paperName).toBe("2024年考研政治真题");
    expect(r.paperYear).toBe(2024);
  });

  it("密集矩阵（容忍空格）与逐题答案缝合，简答解析归位", () => {
    const r = segmentExamPaper(PAPER_1);
    expect(r.questions.map((q) => q.answer)).toEqual([
      "B",
      "B",
      "A B C",
      "A B D",
      "货币时间价值是指资金在投资过程中随时间推移产生的增值。",
      "财政政策的主要工具是财政支出与收入。",
    ]);
    expect(r.questions[5].analysis).toBe("货币时间价值是金融决策的核心概念。");
    expect(r.warnings.filter((w) => w.includes("未找到答案"))).toHaveLength(0);
  });

  it("答案区缺失某题答案时告警", () => {
    const text = "一、单选题\n1. 甲？\nA. 一\nB. 二\n2. 乙？\nA. 三\nB. 四\n【参考答案】\n1. A";
    const r = segmentExamPaper(text);
    expect(r.questions[0].answer).toBe("A");
    expect(r.questions[1].answer).toBe("");
    expect(r.warnings.some((w) => w.includes("第 2 题") && w.includes("未找到答案"))).toBe(true);
  });

  it("单行多选项横向拆分", () => {
    const text = "一、单选题\n1. 选对的？\nA. 甲 B. 乙 C. 丙 D. 丁\n【参考答案】\n1. C";
    const r = segmentExamPaper(text);
    expect(r.questions[0].options).toEqual(["甲", "乙", "丙", "丁"]);
    expect(r.questions[0].answer).toBe("C");
  });

  it("选项正文里的 B. 不被误拆（前一选项无尾随空白）", () => {
    const text = "一、单选题\n1. 营养相关？\nA. 维生素B. 钙是矿物质\nB. 铁\nC. 锌\nD. 碘\n【参考答案】\n1. B";
    const r = segmentExamPaper(text);
    expect(r.questions[0].options[0]).toBe("维生素B. 钙是矿物质");
    expect(r.questions[0].options).toHaveLength(4);
  });

  it("子小问 (1)(2) 并入题干", () => {
    const text = "一、简答题\n1. 试述货币政策的传导机制：\n(1) 利率渠道的含义；\n(2) 资产价格渠道的含义。\n【参考答案】\n1. 利率渠道指……";
    const r = segmentExamPaper(text);
    expect(r.questions[0].title).toContain("(1) 利率渠道的含义");
    expect(r.questions[0].title).toContain("(2) 资产价格渠道的含义");
    expect(r.questions[0].answer).toBe("利率渠道指……");
  });

  it("全角数字/字母自愈（１ / Ａ）", () => {
    const text = "一、单选题\n１. 全角题号？\nＡ. 甲\nＢ. 乙\n【参考答案】\n１. Ａ";
    const r = segmentExamPaper(text);
    expect(r.questions).toHaveLength(1);
    expect(r.questions[0].num).toBe(1);
    expect(r.questions[0].options).toEqual(["甲", "乙"]);
    expect(r.questions[0].answer).toBe("A");
  });

  it("小数行首（1.5倍）不当题号", () => {
    const text = "一、单选题\n1. 增长率？\nA. 甲\nB. 乙\nC. 丙\nD. 丁\n2. 某指标是 1.5 倍关系。\nA. 是\nB. 否\n【参考答案】\n1-2: B A";
    const r = segmentExamPaper(text);
    expect(r.questions.map((q) => q.num)).toEqual([1, 2]);
    expect(r.questions[1].title).toContain("1.5 倍关系");
    expect(r.questions[1].answer).toBe("A");
  });

  it("简答答案里的数字（1949.）不被当作下一题", () => {
    const text = "一、简答题\n1. 简述新中国成立的意义。\n【参考答案】\n1. 1949. 年新中国成立标志着新民主主义革命胜利，开启了历史新纪元。";
    const r = segmentExamPaper(text);
    expect(r.questions).toHaveLength(1);
    expect(r.questions[0].answer).toBe("1949. 年新中国成立标志着新民主主义革命胜利，开启了历史新纪元。");
    expect(r.warnings).toHaveLength(0);
  });

  it("多行解析归属最近题号并续行", () => {
    const text = "一、简答题\n1. 简述 A。\n2. 简述 B。\n【参考答案】\n1. 答案一\n解析：第一行。\n第二行续。\n2. 答案二";
    const r = segmentExamPaper(text);
    expect(r.questions[0].analysis).toBe("第一行。 第二行续。");
    expect(r.questions[1].answer).toBe("答案二");
    expect(r.questions[1].analysis).toBe("");
  });

  it("答案区多余题号与重复题号均告警", () => {
    const text = "一、单选题\n1. 甲？\nA. 一\nB. 二\n1. 重复题？\nA. 三\nB. 四\n【参考答案】\n1. A\n9. D";
    const r = segmentExamPaper(text);
    expect(r.questions).toHaveLength(2);
    expect(r.warnings.some((w) => w.includes("题号 1 重复"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("第 9 题答案无对应题干"))).toBe(true);
  });

  it("密集矩阵字符数不匹配时告警且不缝合", () => {
    const text = "一、单选题\n1. 甲？\nA. 一\nB. 二\n【参考答案】\n1-2: BAC";
    const r = segmentExamPaper(text);
    expect(r.questions[0].answer).toBe("");
    expect(r.warnings.some((w) => w.includes("字符数与题号范围不一致"))).toBe(true);
  });

  it("题干续行以「答案是」开头不误触答案区", () => {
    const text = "一、简答题\n1. 判断题：\n下列关于答案是唯一的说法是否正确？\n【参考答案】\n1. 该说法不正确。";
    const r = segmentExamPaper(text);
    expect(r.questions).toHaveLength(1);
    expect(r.questions[0].answer).toBe("该说法不正确。");
  });

  it("无题号文本不产生题目（留给结构化兜底）", () => {
    const r = segmentExamPaper("货币时间价值是指资金增值。\nA. 甲\nB. 乙");
    expect(r.questions).toHaveLength(0);
  });

  it("每题内联 答案：/解析：（P2 格式）", () => {
    const text = "1. 题目一？\nA. 一\nB. 二\n答案: B\n2. 题目二？\nA. 三\nB. 四\n答案: C\n解析: 选 C 的原因";
    const r = segmentExamPaper(text);
    expect(r.questions).toHaveLength(2);
    expect(r.questions[0].answer).toBe("B");
    expect(r.questions[1].answer).toBe("C");
    expect(r.questions[1].analysis).toBe("选 C 的原因");
  });

  it("裸「答案：」内容为题号开头时按答案区头处理", () => {
    const text = "1. 题目一？\nA. 一\nB. 二\n2. 题目二？\nA. 三\nB. 四\n答案: 1-2: B A";
    const r = segmentExamPaper(text);
    expect(r.questions[0].answer).toBe("B");
    expect(r.questions[1].answer).toBe("A");
  });

  it("内联多选答案「答案：A B C」整行保留", () => {
    const text = "一、多选题\n1. 多选？\nA. 甲\nB. 乙\nC. 丙\nD. 丁\n答案: A B C";
    const r = segmentExamPaper(text);
    expect(r.questions[0].answer).toBe("A B C");
  });
});
