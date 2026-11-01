import { describe, expect, it } from "vitest";
import { validateDocPath } from "../docPath";

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
