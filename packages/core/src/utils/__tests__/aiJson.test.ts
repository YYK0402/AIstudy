import { describe, it, expect } from "vitest";
import { extractJsonCandidates, parseJsonCandidates, unwrapArray, stripThinkBlocks } from "../aiJson";

const THINK_OPEN = "<" + "think" + ">";
const THINK_CLOSE = "</" + "think" + ">";

describe("stripThinkBlocks", () => {
  it("闭合思考块：取最后一个结束标记之后的正文", () => {
    const raw = THINK_OPEN + "好的，这是结果：" + THINK_CLOSE + "\n[1, 2]";
    expect(stripThinkBlocks(raw)).toBe("[1, 2]");
  });

  it("多个思考块：取最后一个结束标记", () => {
    const raw = THINK_OPEN + "a" + THINK_CLOSE + "\n" + THINK_OPEN + "b" + THINK_CLOSE + "\n最终：c";
    expect(stripThinkBlocks(raw)).toBe("最终：c");
  });

  it("未闭合思考块：取最后一个 Let's xxx. 过渡句之后", () => {
    const raw = THINK_OPEN + "Let's analyze the document.\nThe answer is 42.";
    expect(stripThinkBlocks(raw)).toBe("The answer is 42.");
  });

  it("无思考块：原样返回（仅 trim）", () => {
    expect(stripThinkBlocks("  hello ")).toBe("hello");
  });
});

describe("extractJsonCandidates", () => {
  it("数组：围栏内容优先", () => {
    const raw = "前缀 ```json\n[1, 2]\n``` 后缀";
    expect(extractJsonCandidates(raw, "array")).toEqual(["[1, 2]"]);
  });

  it("裸数组原文（带前后说明文字）：包含贪婪截取候选", () => {
    const out = extractJsonCandidates('以下是闪卡：[{"a":1}] 完毕', "array");
    expect(out).toContain('[{"a":1}]');
  });

  it("裸原文以 [ 开头时整体作为首个候选", () => {
    const raw = '[{"a":1}, {"b":2}]';
    const out = extractJsonCandidates(raw, "array");
    expect(out[0]).toBe(raw);
  });

  it("对象：围栏 > 裸原文 > 贪婪截取", () => {
    const raw = '```json\n{"score": 80, "feedback": "好"}\n```';
    expect(extractJsonCandidates(raw, "object")).toEqual(['{"score": 80, "feedback": "好"}']);
  });

  it("空输入：无候选", () => {
    expect(extractJsonCandidates("   ", "array")).toEqual([]);
  });

  it("重复候选去重", () => {
    const raw = "[1, 2]";
    const out = extractJsonCandidates(raw, "array");
    expect(new Set(out).size).toBe(out.length);
  });
});

describe("parseJsonCandidates", () => {
  it("第一个可解析候选胜出", () => {
    const out = parseJsonCandidates(["bad json", '[{"a":1}]']);
    expect(out).toEqual([{ a: 1 }]);
  });

  it("全部失败返回 null", () => {
    expect(parseJsonCandidates(["bad", "{oops"])).toBeNull();
    expect(parseJsonCandidates([])).toBeNull();
  });
});

describe("unwrapArray", () => {
  it("数组原样返回", () => {
    expect(unwrapArray([1, 2])).toEqual([1, 2]);
  });

  it("对象包装：提取 questions/items/data/list 第一个数组字段", () => {
    expect(unwrapArray({ questions: [1, 2] })).toEqual([1, 2]);
    expect(unwrapArray({ items: [3] })).toEqual([3]);
    expect(unwrapArray({ data: [4] })).toEqual([4]);
    expect(unwrapArray({ list: [5] })).toEqual([5]);
  });

  it("非数组对象 / 非对象返回 null", () => {
    expect(unwrapArray({ score: 1 })).toBeNull();
    expect(unwrapArray("str")).toBeNull();
    expect(unwrapArray(null)).toBeNull();
  });
});
