import { describe, expect, it, vi } from "vitest";
import { buildOutlineChunks, mergeOutlineNodes, parseOutlineResponse } from "../outlineExtract";

describe("parseOutlineResponse", () => {
  it("解析 JSON（含代码围栏与思考泄漏前缀）", () => {
    const content = '```json\n{"headings": [{"text": "第1章 极限", "level": 1}, {"text": "1.1 定义", "level": 2}]}\n```';
    expect(parseOutlineResponse(content)).toEqual([
      { text: "第1章 极限", level: 1 },
      { text: "1.1 定义", level: 2 },
    ]);
  });
  it("过滤非法项：level 越界/空文本/目录点线", () => {
    const content = `{"headings": [
      {"text": "第1章 …… 3", "level": 1},
      {"text": "", "level": 1},
      {"text": "第2章", "level": 0},
      {"text": "第3章", "level": 9},
      {"text": "第4章", "level": 1}
    ]}`;
    expect(parseOutlineResponse(content)).toEqual([{ text: "第4章", level: 1 }]);
  });
  it("无 JSON 抛错", () => {
    expect(() => parseOutlineResponse("抱歉，我无法处理")).toThrow(/JSON/);
  });
  it("缺 headings 数组抛错", () => {
    expect(() => parseOutlineResponse('{"foo": 1}')).toThrow(/headings/);
  });
  it("节点数上限 1000（L3）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const items = Array.from({ length: 1100 }, (_, i) => `{"text": "t${i}", "level": 1}`).join(",");
      expect(parseOutlineResponse(`{"headings": [${items}]}`)).toHaveLength(1000);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe("buildOutlineChunks", () => {
  it("短文本单段无重叠", () => {
    const chunks = buildOutlineChunks("甲\n\n乙\n\n丙", 40000, 500);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].overlap).toBe(false);
    expect(chunks[0].text).toBe("甲\n\n乙\n\n丙");
  });
  it("超长文本按段落边界切段，续段携带前段尾部重叠", () => {
    const paras = Array.from({ length: 30 }, (_, i) => `P${i}${"x".repeat(2000)}`);
    const chunks = buildOutlineChunks(paras.join("\n\n"), 10000, 500);
    expect(chunks.length).toBeGreaterThan(1);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].overlap).toBe(true);
      // text 以前一段尾部 500 字开头
      expect(chunks[i].text.startsWith(chunks[i - 1].text.slice(-500))).toBe(true);
      expect(chunks[i].bodyStart).toBeGreaterThan(0);
    }
  });
  it("超长单段强制切", () => {
    const chunks = buildOutlineChunks("a".repeat(25000), 10000, 500);
    expect(chunks.length).toBe(3);
  });
});

describe("mergeOutlineNodes", () => {
  it("丢弃续段开头与累积尾部重复的标题（重叠区）", () => {
    const acc = [{ text: "第1章", level: 1 }, { text: "1.1 甲", level: 2 }];
    const next = [{ text: "1.1 甲", level: 2 }, { text: "1.2 乙", level: 2 }];
    expect(mergeOutlineNodes(acc, next)).toEqual([
      { text: "第1章", level: 1 },
      { text: "1.1 甲", level: 2 },
      { text: "1.2 乙", level: 2 },
    ]);
  });
  it("无重复时顺序拼接", () => {
    expect(mergeOutlineNodes([], [{ text: "A", level: 1 }])).toEqual([{ text: "A", level: 1 }]);
  });
  it("密集标题重叠窗：≥2 连续重复节点被正确去重", () => {
    const acc = [{ text: "第1章", level: 1 }, { text: "1.1 甲", level: 2 }, { text: "1.2 乙", level: 2 }];
    const next = [{ text: "1.1 甲", level: 2 }, { text: "1.2 乙", level: 2 }, { text: "1.3 丙", level: 2 }];
    expect(mergeOutlineNodes(acc, next)).toEqual([
      { text: "第1章", level: 1 },
      { text: "1.1 甲", level: 2 },
      { text: "1.2 乙", level: 2 },
      { text: "1.3 丙", level: 2 },
    ]);
  });
  it("合法连续同名同 level 标题：非重叠部分不误丢", () => {
    // 文档中 B 连续出现 3 次；chunk1 识别到第 1 个 B（acc 尾部），
    // chunk2 上下文重叠区含第 1 个 B + 正文含第 2/3 个 B → 只应去重重叠区那 1 个
    const acc = [{ text: "A", level: 1 }, { text: "B", level: 2 }];
    const next = [{ text: "B", level: 2 }, { text: "B", level: 2 }, { text: "C", level: 2 }];
    expect(mergeOutlineNodes(acc, next)).toEqual([
      { text: "A", level: 1 },
      { text: "B", level: 2 },
      { text: "B", level: 2 },
      { text: "C", level: 2 },
    ]);
  });
});


describe("mergeOutlineNodes 归一化去重（L3）", () => {
  it("重叠标题仅空白差异：去重不产生重复节点", () => {
    const acc = [{ text: "1.1 概述", level: 2 }];
    const next = [
      { text: "1.1   概述", level: 2 },
      { text: "1.2 细节", level: 2 },
    ];
    expect(mergeOutlineNodes(acc, next)).toEqual([
      { text: "1.1 概述", level: 2 },
      { text: "1.2 细节", level: 2 },
    ]);
  });
  it("重叠但 level 不同：不合并", () => {
    const acc = [{ text: "1.1 概述", level: 2 }];
    const next = [
      { text: "1.1 概述", level: 3 },
      { text: "1.1.1 子节", level: 3 },
    ];
    expect(mergeOutlineNodes(acc, next)).toHaveLength(3);
  });
});

