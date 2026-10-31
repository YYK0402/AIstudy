import { describe, expect, it } from "vitest";
import {
  formatPassageAnalysis,
  formatPassageAnswer,
  gradePassage,
  parsePassageAnswer,
  parsePassageBlanks,
} from "../passage";

describe("parsePassageBlanks", () => {
  it("解析编号空位与括号内原形词", () => {
    const title = "For language __41__ (learner), these forms are __42__ (usual) in daily life.";
    expect(parsePassageBlanks(title)).toEqual([
      { no: 41, hint: "learner" },
      { no: 42, hint: "usual" },
    ]);
  });

  it("支持全角括号与无括号标记", () => {
    expect(parsePassageBlanks("他__10__（able）完成。__11__很快。")).toEqual([
      { no: 10, hint: "able" },
      { no: 11 },
    ]);
  });

  it("单空 ____ 归一为 no=1", () => {
    expect(parsePassageBlanks("《南京条约》赔款____万银元。")).toEqual([{ no: 1 }]);
  });

  it("解析 __ (word) 与裸 __ 标记（未编号按顺序 1、2…）", () => {
    expect(parsePassageBlanks("needs __ (require) no perfection.")).toEqual([
      { no: 1, hint: "require" },
    ]);
    expect(parsePassageBlanks("he __ (find) that people __ (look) for jobs.")).toEqual([
      { no: 1, hint: "find" },
      { no: 2, hint: "look" },
    ]);
    expect(parsePassageBlanks("__ he is ill, he is absent today.")).toEqual([{ no: 1 }]);
  });

  it("编号与未编号混排时互不干扰", () => {
    expect(parsePassageBlanks("__41__ (a) 然后 ____ 再 __ (b)。")).toEqual([
      { no: 41, hint: "a" },
      { no: 1 },
      { no: 2, hint: "b" },
    ]);
  });

  it("无标记返回空数组", () => {
    expect(parsePassageBlanks("普通题干")).toEqual([]);
  });
});

describe("parsePassageAnswer", () => {
  it("解析 no:值 管道串", () => {
    const m = parsePassageAnswer("41:learners|42:usual");
    expect(m.get(41)).toBe("learners");
    expect(m.get(42)).toBe("usual");
    expect(m.size).toBe(2);
  });

  it("容忍空格与乱序", () => {
    const m = parsePassageAnswer(" 42 : usual | 41:learners ");
    expect(m.get(41)).toBe("learners");
    expect(m.get(42)).toBe("usual");
  });

  it("纯文本答案（非 no: 形态）返回空", () => {
    expect(parsePassageAnswer("2100").size).toBe(0);
    expect(parsePassageAnswer("").size).toBe(0);
  });

  it("值内含冒号时只按首个冒号拆", () => {
    expect(parsePassageAnswer("41:it is: ok").get(41)).toBe("it is: ok");
  });
});

describe("formatPassageAnswer", () => {
  it("按编号升序拼接", () => {
    expect(formatPassageAnswer([[42, "usual"], [41, "learners"]])).toBe("41:learners|42:usual");
  });
});

describe("formatPassageAnalysis", () => {
  it("逐空解析串转逐行展示", () => {
    expect(formatPassageAnalysis("41:复数形式|42:动词原形")).toBe("41：复数形式\n42：动词原形");
  });
  it("普通文本原样返回", () => {
    expect(formatPassageAnalysis("整体解析")).toBe("整体解析");
  });
});

describe("gradePassage", () => {
  const correct = "41:learners|42:usual|43:enable";

  it("全对：100 分且 isCorrect", () => {
    const g = gradePassage("41:learners|42:usual|43:enable", correct);
    expect(g.total).toBe(3);
    expect(g.correctCount).toBe(3);
    expect(g.score).toBe("100");
    expect(g.isCorrect).toBe(true);
  });

  it("大小写与首尾空格不敏感", () => {
    const g = gradePassage("41: Learners |42:USUAL|43:enable", correct);
    expect(g.isCorrect).toBe(true);
  });

  it("部分正确：按正确率计分、不算全对", () => {
    const g = gradePassage("41:learners|42:usua|43:enable", correct);
    expect(g.correctCount).toBe(2);
    expect(g.score).toBe("67");
    expect(g.isCorrect).toBe(false);
    expect(g.perBlank[1]).toMatchObject({ no: 42, right: false });
  });

  it("未填空位按错计", () => {
    const g = gradePassage("41:learners|43:enable", correct);
    expect(g.perBlank.find((p) => p.no === 42)).toMatchObject({ user: "", right: false });
    expect(g.score).toBe("67");
  });

  it("以正确答案的空位为基准（用户多填的空忽略）", () => {
    const g = gradePassage("41:learners|42:usual|43:enable|99:x", correct);
    expect(g.total).toBe(3);
  });
});
