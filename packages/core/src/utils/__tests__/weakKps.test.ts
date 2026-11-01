import { describe, expect, it } from "vitest";
import type { KnowledgePoint, Mastery } from "../../types/appData";
import { rankWeakKps } from "../weakKps";

function kp(id: number, mastery: Mastery, name = `kp${id}`): KnowledgePoint {
  return {
    id,
    courseId: 1,
    chapterId: null,
    blockId: null,
    name,
    content: "",
    mastery,
    sourceAssetIds: "",
    prevKpIds: "",
    chapterName: "",
    sort: id,
    createTime: "2026-11-01T00:00:00.000Z",
  };
}

describe("rankWeakKps", () => {
  it("讲解最低分恰好 60：不加「讲解低分」原因（惩罚公式照常）；59：加原因", () => {
    const base = { kps: [kp(1, "known")], wrongKpCounts: new Map(), topN: 10 };
    const at60 = rankWeakKps({ ...base, explainScores: [{ kpId: 1, aiScore: "60" }] });
    expect(at60[0].score).toBe(25 + Math.round(40 * 0.4));
    expect(at60[0].reasons).toEqual([]);
    const at59 = rankWeakKps({ ...base, explainScores: [{ kpId: 1, aiScore: "59" }] });
    expect(at59[0].score).toBe(25 + Math.round(41 * 0.4));
    expect(at59[0].reasons).toContain("讲解低分 59");
  });

  it("多轮讲解取最低分", () => {
    const r = rankWeakKps({
      kps: [kp(1, "known")],
      explainScores: [
        { kpId: 1, aiScore: "90" },
        { kpId: 1, aiScore: "40" },
      ],
      wrongKpCounts: new Map(),
    });
    expect(r[0].score).toBe(25 + Math.round(60 * 0.4));
  });

  it("错题惩罚 8 分/条，5 条封顶（6 条不再加）", () => {
    const base = { kps: [kp(1, "known")], explainScores: [] as Array<{ kpId: number; aiScore: string }> };
    const five = rankWeakKps({ ...base, wrongKpCounts: new Map([[1, 5]]) });
    const six = rankWeakKps({ ...base, wrongKpCounts: new Map([[1, 6]]) });
    expect(five[0].score).toBe(25 + 40);
    expect(six[0].score).toBe(25 + 40);
    expect(five[0].reasons).toContain("错题 5 题");
    expect(six[0].reasons).toContain("错题 6 题");
  });

  it("aiScore 非数字跳过（不惩罚也不报错）", () => {
    const r = rankWeakKps({
      kps: [kp(1, "known")],
      explainScores: [
        { kpId: 1, aiScore: "N/A" },
        { kpId: 1, aiScore: "50" },
      ],
      wrongKpCounts: new Map(),
    });
    expect(r[0].score).toBe(25 + Math.round(50 * 0.4));
  });

  it("proficient 且无讲解无错题：零分不出现", () => {
    const r = rankWeakKps({ kps: [kp(1, "proficient")], explainScores: [], wrongKpCounts: new Map() });
    expect(r).toEqual([]);
  });

  it("unlearn 无其他原因：reasons 补「未学习」", () => {
    const r = rankWeakKps({ kps: [kp(1, "unlearn")], explainScores: [], wrongKpCounts: new Map() });
    expect(r[0].score).toBe(40);
    expect(r[0].reasons).toContain("未学习");
  });

  it("topN 截断 + 同分按 kpId 升序稳定", () => {
    const kps = [kp(3, "unlearn"), kp(1, "unlearn"), kp(2, "unlearn")];
    const all = rankWeakKps({ kps, explainScores: [], wrongKpCounts: new Map(), topN: 10 });
    expect(all.map((e) => e.kpId)).toEqual([1, 2, 3]);
    const top = rankWeakKps({ kps, explainScores: [], wrongKpCounts: new Map(), topN: 2 });
    expect(top.map((e) => e.kpId)).toEqual([1, 2]);
  });
});
