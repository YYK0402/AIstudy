import { describe, expect, it } from "vitest";
import { createEmptyCourseData, type CourseData, type Question } from "../../types/appData";
import { mergePassageGroup, migratePassageQuestions } from "../passageMigration";

const PASSAGE = "For language __41__ (learner), these forms are __42__ (usual) in daily life.";

function legacyQ(id: number, no: number, word: string, answer: string, extra?: Partial<Question>): Question {
  return {
    id,
    courseId: 2,
    kpIds: "3",
    title: `${PASSAGE}\n\n第 ${no} 题：用所给单词 ${word} 的适当形式填空`,
    options: "[]",
    answer,
    analysis: `第${no}题解析`,
    qType: "cloze",
    difficulty: "medium",
    source: "manual",
    paperId: null,
    createTime: `2026-01-${String(id).padStart(2, "0")}T00:00:00Z`,
    ...extra,
  };
}

function baseCd(questions: Question[]): CourseData {
  const cd = createEmptyCourseData();
  cd.questions = questions;
  return cd;
}

describe("migratePassageQuestions", () => {
  it("同文章多题合并为一篇文章题", () => {
    const cd = baseCd([
      legacyQ(175, 41, "learner", "learners"),
      legacyQ(176, 42, "usual", "unusual", { difficulty: "hard", kpIds: "3,7" }),
    ]);
    const { cd: out, changed } = migratePassageQuestions(cd);
    expect(changed).toBe(true);
    expect(out.questions).toHaveLength(1);
    const m = out.questions[0];
    expect(m.qType).toBe("fill");
    expect(m.id).toBe(177);
    expect(m.title).toBe(PASSAGE);
    expect(m.answer).toBe("41:learners|42:unusual");
    expect(m.analysis).toBe("41:第41题解析|42:第42题解析");
    expect(JSON.parse(m.blanks!)).toEqual([
      { no: 41, hint: "learner" },
      { no: 42, hint: "usual" },
    ]);
    expect(m.kpIds).toBe("3,7");
    expect(m.difficulty).toBe("hard");
    expect(m.createTime).toBe("2026-01-175T00:00:00Z");
  });

  it("关联记录重映射并去重（作答保留、错题/问答/复习各留一）", () => {
    const cd = baseCd([
      legacyQ(10, 41, "learner", "learners"),
      legacyQ(11, 42, "usual", "unusual"),
    ]);
    cd.answerRecords = [
      { id: 1, qId: 10, userAnswer: "learns", isCorrect: false, score: "0", createTime: "t1" },
      { id: 2, qId: 11, userAnswer: "usual", isCorrect: false, score: "0", createTime: "t2" },
    ];
    cd.wrongQuestions = [
      { id: 1, recordId: 1, qId: 10, reviewTimes: 2, createTime: "t1" },
      { id: 2, recordId: 2, qId: 11, reviewTimes: 0, createTime: "t2" },
    ];
    cd.questionAsks = [
      { id: 1, qId: 10, courseId: 2, turns: [], updateTime: "2026-01-01T00:00:00Z" },
      { id: 2, qId: 11, courseId: 2, turns: [], updateTime: "2026-01-02T00:00:00Z" },
    ];
    cd.reviewSchedules = [
      { id: 1, kpId: null, qId: 10, stage: 0, dueTime: "d1", easeFactor: 2.5, intervalDays: 0, lastReviewTime: null, reviewTimes: 1 },
      { id: 2, kpId: null, qId: 11, stage: 0, dueTime: "d2", easeFactor: 2.5, intervalDays: 0, lastReviewTime: null, reviewTimes: 0 },
    ];
    const { cd: out } = migratePassageQuestions(cd);
    const mergedId = out.questions[0].id;
    expect(out.answerRecords).toHaveLength(2);
    expect(out.answerRecords.every((r) => r.qId === mergedId)).toBe(true);
    expect(out.wrongQuestions).toHaveLength(1);
    expect(out.wrongQuestions[0]).toMatchObject({ id: 1, qId: mergedId, reviewTimes: 2 });
    expect(out.questionAsks).toHaveLength(1);
    expect(out.questionAsks[0]).toMatchObject({ id: 2, qId: mergedId });
    expect(out.reviewSchedules).toHaveLength(1);
    expect(out.reviewSchedules[0].qId).toBe(mergedId);
  });

  it("恰好 1 个空位的旧 cloze 改名 fill、补 blanks、答案写成 1:值", () => {
    const cd = baseCd([
      legacyQ(117, 1, "", "2100", {
        title: "《南京条约》赔款____万银元。",
        answer: "2100",
      }),
    ]);
    const { cd: out, changed } = migratePassageQuestions(cd);
    expect(changed).toBe(true);
    expect(out.questions[0].qType).toBe("fill");
    expect(out.questions[0].id).toBe(117);
    expect(JSON.parse(out.questions[0].blanks!)).toEqual([{ no: 1 }]);
    expect(out.questions[0].answer).toBe("1:2100");
  });

  it("0 个或多个空位（含答案嵌题干的重复题）不拆，保持整串判分", () => {
    const cd = baseCd([
      legacyQ(274, 1, "", "一般现在时", {
        title: "【语法专项真题带练】\n\n判断时态：She goes to school every day.",
        answer: "一般现在时",
      }),
      legacyQ(224, 1, "", "found", {
        title: "One day he __ (find) that people spend a lot of time __ (look) for jobs online.",
        answer: "found",
      }),
    ]);
    const { cd: out } = migratePassageQuestions(cd);
    expect(out.questions.every((q) => q.blanks === undefined)).toBe(true);
    expect(out.questions.every((q) => q.qType === "fill")).toBe(true);
    expect(out.questions.map((q) => q.answer)).toEqual(["一般现在时", "found"]);
  });

  it("幂等：迁移后再跑无变化", () => {
    const cd = baseCd([
      legacyQ(175, 41, "learner", "learners"),
      legacyQ(176, 42, "usual", "unusual"),
    ]);
    const first = migratePassageQuestions(cd);
    const snapshot = JSON.stringify(first.cd);
    const second = migratePassageQuestions(first.cd);
    expect(second.changed).toBe(false);
    expect(JSON.stringify(second.cd)).toBe(snapshot);
  });

  it("新版四选完形（options 非空）不参与迁移", () => {
    const cloze: Question = {
      id: 200,
      courseId: 2,
      kpIds: "",
      title: "完形文章 __41__。",
      options: JSON.stringify([["A", "B", "C", "D"]]),
      answer: "41:B",
      analysis: "",
      qType: "cloze",
      difficulty: "medium",
      source: "ai",
      paperId: null,
      createTime: "t",
    };
    const { cd: out, changed } = migratePassageQuestions(baseCd([cloze]));
    expect(changed).toBe(false);
    expect(out.questions[0].qType).toBe("cloze");
  });

  it("残缺组（同文章仅 1 题带结尾行）按单空题改名，不合并", () => {
    const cd = baseCd([legacyQ(5, 41, "learner", "learners")]);
    const { cd: out } = migratePassageQuestions(cd);
    expect(out.questions).toHaveLength(1);
    expect(out.questions[0].qType).toBe("fill");
    expect(out.questions[0].id).toBe(5);
  });
});

describe("mergePassageGroup", () => {
  it("按编号排序 blanks 与答案；结尾行无词时 hint 回退取文章内标注", () => {
    const mk = (id: number, no: number, ans: string): Question => ({
      ...legacyQ(id, no, "", ans),
      title: `${PASSAGE}\n\n第 ${no} 题：填空`,
      analysis: "",
    });
    const merged = mergePassageGroup(
      [
        { q: mk(1, 42, "unusual"), no: 42, hint: undefined },
        { q: mk(2, 41, "learners"), no: 41, hint: undefined },
      ],
      99,
    );
    expect(merged.answer).toBe("41:learners|42:unusual");
    expect(JSON.parse(merged.blanks!)).toEqual([
      { no: 41, hint: "learner" },
      { no: 42, hint: "usual" },
    ]);
    expect(merged.analysis).toBe("");
  });
});
