import { describe, expect, it } from "vitest";
import { parseFlashcardsJson } from "../flashcardGen";

describe("parseFlashcardsJson", () => {
  it("空输出：解析级错误", () => {
    const r = parseFlashcardsJson("   ", 3);
    expect(r.items).toEqual([]);
    expect(r.errors).toHaveLength(1);
  });

  it("无 JSON 数组：解析级错误", () => {
    const r = parseFlashcardsJson("好的，以下是闪卡内容（忘记给 JSON 了）", 3);
    expect(r.items).toEqual([]);
    expect(r.errors).toHaveLength(1);
  });

  it("围栏包裹 + 前后说明文字：正常解析", () => {
    const raw = '收到！为你生成闪卡：\n```json\n[{"index":0,"front":"F0","back":"B0"}]\n```\n以上，加油！';
    const r = parseFlashcardsJson(raw, 1);
    expect(r.errors).toEqual([]);
    expect(r.items).toEqual([{ index: 0, front: "F0", back: "B0" }]);
  });

  it("JSON 是对象而非数组：解析级错误", () => {
    const r = parseFlashcardsJson('{"index":0,"front":"F","back":"B"}', 1);
    expect(r.items).toEqual([]);
    expect(r.errors).toHaveLength(1);
  });

  it("index 越界 / 非整数 / 负数：跳过计数", () => {
    const raw = JSON.stringify([
      { index: 5, front: "F", back: "B" }, // >= kpCount
      { index: 0.5, front: "F", back: "B" }, // 非整数
      { index: -1, front: "F", back: "B" }, // 负数
      { index: 0, front: "F", back: "B" }, // 有效
    ]);
    const r = parseFlashcardsJson(raw, 2);
    expect(r.items).toHaveLength(1);
    expect(r.skipped).toBe(3);
    expect(r.errors).toEqual([]);
  });

  it("重复 index：首个保留，后续跳过", () => {
    const raw = JSON.stringify([
      { index: 0, front: "F1", back: "B1" },
      { index: 0, front: "F2", back: "B2" },
    ]);
    const r = parseFlashcardsJson(raw, 1);
    expect(r.items).toEqual([{ index: 0, front: "F1", back: "B1" }]);
    expect(r.skipped).toBe(1);
  });

  it("front/back 空或空白：跳过；合法项 trim", () => {
    const raw = JSON.stringify([
      { index: 0, front: "", back: "B" },
      { index: 1, front: "F", back: "   " },
      { index: 2, front: " F ", back: "B\t" },
    ]);
    const r = parseFlashcardsJson(raw, 3);
    expect(r.items).toEqual([{ index: 2, front: "F", back: "B" }]);
    expect(r.skipped).toBe(2);
  });

  it("非对象项（数字/字符串/null/数组）：跳过", () => {
    const raw = JSON.stringify([1, "x", null, ["a"], { index: 0, front: "F", back: "B" }]);
    const r = parseFlashcardsJson(raw, 1);
    expect(r.items).toHaveLength(1);
    expect(r.skipped).toBe(4);
  });
});
