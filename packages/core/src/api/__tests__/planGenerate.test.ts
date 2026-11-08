import { describe, expect, it } from "vitest";
import { createEmptyData } from "../../types/appData";
import type { AppData, Chapter, Course, KnowledgePoint, StudyTask } from "../../types/appData";
import { setBridge } from "../../bridge";
import type { StudyBridge } from "../../bridge/types";
import { generateStudyPlan } from "../plan";

function course(id: number, name: string): Course {
  return {
    id, siyuanDocId: null, name, description: "", target: "", totalCycle: "",
    status: "active", createTime: "2026-11-01T00:00:00.000Z",
  };
}

function ch(id: number, parentId: number | null, level: number, sort: number, name: string): Chapter {
  return { id, courseId: 1, parentId, siyuanBlockId: null, name, level, sort };
}

function kp(id: number, chapterId: number | null, sort: number, name = `kp${id}`): KnowledgePoint {
  return {
    id, courseId: 1, chapterId, blockId: null, name, content: "", mastery: "unlearn",
    sourceAssetIds: "", prevKpIds: "", chapterName: "", sort, createTime: "2026-11-01T00:00:00.000Z",
  };
}

/** 注入测试数据并替换桥（每个用例独立数据，避免计划互相污染） */
function installData(chapters: Chapter[], kps: KnowledgePoint[]): AppData {
  const data = createEmptyData();
  data.courses.push(course(1, "测试课"));
  data.chapters.push(...chapters);
  data.knowledgePoints.push(...kps);
  setBridge({
    getData: async () => data,
    saveData: async () => ({ code: 0 }),
  } as unknown as StudyBridge);
  return data;
}

const input = { startDate: "2026-11-10", targetDate: "2026-11-12", dailyHour: "2" };

/** 章末测评任务（test 且 chapterId 非 null；结业模考 chapterId 为 null 不含） */
function chapterTestTasks(tasks: StudyTask[]): StudyTask[] {
  return tasks.filter((t) => t.taskType === "test" && t.chapterId !== null);
}

describe("generateStudyPlan 章末测评排期（KP 归属最近 level-1 祖先）", () => {
  it("KP 全挂 L3 的章：章末测评仍排到该顶层章最后学习日（现状漏排）", async () => {
    // 章1(L1) → 节11(L2) → 小节111(L3)；章2(L1)
    installData(
      [ch(1, null, 1, 1, "第一章"), ch(2, null, 1, 2, "第二章"), ch(11, 1, 2, 1, "1.1 节"), ch(111, 11, 3, 1, "1.1.1 小节")],
      [kp(101, 111, 1), kp(102, 111, 2), kp(201, 2, 1)],
    );
    const { tasks } = await generateStudyPlan(1, input);
    const chTests = chapterTestTasks(tasks);
    // KP 按 chapterId 序排 3 天（perDay=1）：11-10=kp201(章2)、11-11=kp101、11-12=kp102（后两者 L3）
    // 章1 最后学习日 = 11-12；章2（L1 直属，行为不变）= 11-10
    expect(chTests.filter((t) => t.chapterId === 1).map((t) => t.scheduledDate)).toEqual(["2026-11-12"]);
    expect(chTests.filter((t) => t.chapterId === 2).map((t) => t.scheduledDate)).toEqual(["2026-11-10"]);
    // L3 节点 id 不得作为测评归属出现
    expect(chTests.some((t) => t.chapterId === 111)).toBe(false);
  });

  it("混合深度（L1 直属 + L2 + L3）：最后日取子树最晚，每顶层章恰好一次，不落其他章", async () => {
    installData(
      [ch(1, null, 1, 1, "第一章"), ch(2, null, 1, 2, "第二章（无 KP）"), ch(11, 1, 2, 1, "1.1 节"), ch(111, 11, 3, 1, "1.1.1 小节")],
      [kp(101, 1, 1), kp(102, 11, 2), kp(103, 111, 3)],
    );
    const { tasks } = await generateStudyPlan(1, input);
    const chTests = chapterTestTasks(tasks);
    // 11-10=kp101(L1 直属)、11-11=kp102(L2)、11-12=kp103(L3) → 章1 最后日 11-12，恰好一条
    expect(chTests).toHaveLength(1);
    expect(chTests[0].chapterId).toBe(1);
    expect(chTests[0].scheduledDate).toBe("2026-11-12");
  });

  it("幽灵节点（KP 所属章已删）：跳过不崩溃、不误归属任何章", async () => {
    installData(
      [ch(1, null, 1, 1, "第一章")],
      [kp(101, 999, 1), kp(102, 1, 2)],
    );
    const { tasks } = await generateStudyPlan(1, input);
    // chapterId 序：kp102(章1) 排 11-10、幽灵 kp101(999) 排 11-11
    // 章1 测评取自身 KP 的最后学习日（11-10）；幽灵日（11-11）不归属任何章，也不产生 chapterId=999 的测评
    const chTests = chapterTestTasks(tasks);
    expect(chTests.map((t) => [t.chapterId, t.scheduledDate])).toEqual([[1, "2026-11-10"]]);
    expect(chTests.some((t) => t.chapterId === 999)).toBe(false);
  });

  it("结业模考恒排目标日（chapterId=null 的 test 任务）", async () => {
    installData([ch(1, null, 1, 1, "第一章")], [kp(101, 1, 1)]);
    const { tasks } = await generateStudyPlan(1, input);
    const exam = tasks.find((t) => t.taskType === "test" && t.chapterId === null);
    expect(exam?.title).toBe("结业模考");
    expect(exam?.scheduledDate).toBe("2026-11-12");
  });
});
