import { describe, expect, it } from "vitest";
import { validateDocPath, sanitizeDocSegment } from "../docPath";

describe("validateDocPath", () => {
  it("合法路径通过", () => {
    expect(() => validateDocPath("/近代史/第一章")).not.toThrow();
    expect(() => validateDocPath("/A/B/C/学习对话")).not.toThrow();
  });

  it("拒绝 .. 段（防越出插件笔记本）", () => {
    expect(() => validateDocPath("/..")).toThrow();
    expect(() => validateDocPath("/a/../b")).toThrow();
  });

  it("拒绝空段（连续斜杠/尾斜杠）", () => {
    expect(() => validateDocPath("/a//b")).toThrow();
    expect(() => validateDocPath("/a/")).toThrow();
  });

  it("拒绝不以 / 开头的路径", () => {
    expect(() => validateDocPath("a/b")).toThrow();
  });

  it("拒绝控制字符", () => {
    expect(() => validateDocPath("/a\u0001b")).toThrow();
    expect(() => validateDocPath("/a\nb")).toThrow();
  });

  it("拒绝超长段", () => {
    expect(() => validateDocPath("/" + "x".repeat(129))).toThrow();
  });

  it("拒绝空路径与无文档名", () => {
    expect(() => validateDocPath("")).toThrow();
    expect(() => validateDocPath("/")).toThrow();
  });
});

describe("sanitizeDocSegment", () => {
  it("把名称中的 / 转全角 ／（防内核按目录分隔符自动建出额外层级）", () => {
    expect(sanitizeDocSegment("重点/难点/考点")).toBe("重点／难点／考点");
    expect(sanitizeDocSegment("8.3.5 项目风险度量方法【多选题/简答题】")).toBe("8.3.5 项目风险度量方法【多选题／简答题】");
  });

  it("不含斜杠的名称原样返回", () => {
    expect(sanitizeDocSegment("第01章 绪论")).toBe("第01章 绪论");
  });

  it("全角 ／ 保持不变（幂等）", () => {
    expect(sanitizeDocSegment("重点／难点")).toBe("重点／难点");
  });
});
