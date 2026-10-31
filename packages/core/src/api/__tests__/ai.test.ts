import { describe, expect, it } from "vitest";
import { stripThinking } from "../ai";

// think 标签用拼接构造（工具链路会把源码中的原始标签串转写成省略号）
const OPEN = "<" + "think>";
const CLOSE = "</" + "think>";
const OPEN_UP = "<" + "THINK>";
const CLOSE_UP = "</" + "THINK>";

describe("stripThinking 剥离模型内联思考块", () => {
  it("无思考块：原样返回（仅去首尾空白）", () => {
    expect(stripThinking("答案是 E")).toBe("答案是 E");
    expect(stripThinking("  答案是 E\n")).toBe("答案是 E");
  });

  it("思考块在正文前：只留正文", () => {
    expect(stripThinking(OPEN + "let me think" + CLOSE + "好的，选 E。")).toBe("好的，选 E。");
  });

  it("多个思考块：全部剥离", () => {
    expect(stripThinking(OPEN + "a" + CLOSE + "答案一" + OPEN + "b" + CLOSE + "答案二")).toBe("答案一答案二");
  });

  it("思考块在正文后：只留正文", () => {
    expect(stripThinking("选 E。" + OPEN + "afterthought" + CLOSE)).toBe("选 E。");
  });

  it("标签大小写不敏感", () => {
    expect(stripThinking(OPEN_UP + "a" + CLOSE_UP + "正文")).toBe("正文");
  });

  it("思考块跨多行", () => {
    expect(stripThinking(OPEN + "\nline1\nline2\n" + CLOSE + "正文")).toBe("正文");
  });

  it("未闭合的思考块（响应被截断）：丢弃思考部分、保留前面的正文", () => {
    expect(stripThinking("正文部分" + OPEN + "未闭合的思考")).toBe("正文部分");
  });

  it("未闭合且前面无正文：返回空串", () => {
    expect(stripThinking(OPEN + "只思考没回答")).toBe("");
  });

  it("整段都是思考块：返回空串（由调用方按「AI 未返回回答」处理）", () => {
    expect(stripThinking(OPEN + "只有思考" + CLOSE)).toBe("");
  });

  it("空串：返回空串", () => {
    expect(stripThinking("")).toBe("");
  });
});
