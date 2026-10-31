import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEmptyData, type AppData } from "../../../../core/src/types/appData";
import { loadUserData, saveUserData, assetDir } from "../user-data";

let tmpRoot: string;

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "fnos-user-data-"));
  process.env.TRIM_PKGVAR = tmpRoot;
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  delete process.env.TRIM_PKGVAR;
});

function makeData(): AppData {
  const data = createEmptyData();
  data.courses = [
    { id: 1, siyuanDocId: "doc1", name: "课程一", description: "", target: "", totalCycle: "", status: "active", createTime: "2026-01-01T00:00:00Z" },
    { id: 2, siyuanDocId: null, name: "课程二", description: "", target: "", totalCycle: "", status: "active", createTime: "2026-01-02T00:00:00Z" },
  ];
  data.providers = [{ id: 9, name: "p", baseUrl: "http://x", apiKey: "enc1:k", timeout: 60000, enabled: true, createTime: "2026-01-01T00:00:00Z" }];
  data.cryptoKeyMaterial = "abcd";
  data.chapters = [
    { id: 10, courseId: 1, parentId: null, siyuanBlockId: null, name: "章A", level: "chapter", sort: 1 },
    { id: 11, courseId: 2, parentId: null, siyuanBlockId: null, name: "章B", level: "chapter", sort: 1 },
  ];
  data.knowledgePoints = [
    { id: 100, courseId: 1, chapterId: 10, blockId: null, name: "KP1", content: "c", mastery: "unlearn", sourceAssetIds: "", prevKpIds: "", chapterName: "章A", sort: 1, createTime: "2026-01-01T00:00:00Z" },
    { id: 101, courseId: 2, chapterId: 11, blockId: null, name: "KP2", content: "c", mastery: "mastered", sourceAssetIds: "", prevKpIds: "", chapterName: "章B", sort: 1, createTime: "2026-01-01T00:00:00Z" },
  ];
  data.questions = [
    { id: 400, courseId: 1, kpIds: "100", title: "Q1", options: "[]", answer: "A", analysis: "", qType: "single", difficulty: "medium", source: "manual", paperId: null, createTime: "2026-01-01T00:00:00Z" },
    { id: 401, courseId: 2, kpIds: "101", title: "Q2", options: "[]", answer: "B", analysis: "", qType: "single", difficulty: "easy", source: "manual", paperId: null, createTime: "2026-01-01T00:00:00Z" },
  ];
  return data;
}

function listUserDir(uid: string): string[] {
  return readdirSync(join(tmpRoot, "data", uid)).sort();
}

describe("fnOS user-data（按课程拆写）", () => {
  it("空用户返回空数据", () => {
    const data = loadUserData("4001");
    expect(data.courses).toEqual([]);
    expect(listUserDir("4001")).toEqual([]);
  });

  it("旧单文件布局首次加载自动迁移为按课程布局", () => {
    const uid = "4002";
    mkdirSync(join(tmpRoot, "data"), { recursive: true });
    writeFileSync(join(tmpRoot, "data", `${uid}.json`), JSON.stringify(makeData()));

    const data = loadUserData(uid);

    expect(existsSync(join(tmpRoot, "data", `${uid}.json`))).toBe(false);
    expect(listUserDir(uid)).toEqual(["course-1.json", "course-2.json", "global.json"]);
    // 合并视图完整
    expect(data.courses).toHaveLength(2);
    expect(data.chapters).toHaveLength(2);
    expect(data.knowledgePoints).toHaveLength(2);
    // 课程文件只含本课程实体
    const c1 = JSON.parse(readFileSync(join(tmpRoot, "data", uid, "course-1.json"), "utf8"));
    expect(c1.chapters).toHaveLength(1);
    expect(c1.knowledgePoints[0].id).toBe(100);
    const c2 = JSON.parse(readFileSync(join(tmpRoot, "data", uid, "course-2.json"), "utf8"));
    expect(c2.chapters).toHaveLength(1);
    expect(c2.knowledgePoints[0].id).toBe(101);
    // 全局文件不含课程实体
    const g = JSON.parse(readFileSync(join(tmpRoot, "data", uid, "global.json"), "utf8"));
    expect(g.chapters).toEqual([]);
    expect(g.providers).toHaveLength(1);
  });

  it("保存只写有变化的文件，返回真实脏集", async () => {
    const uid = "4003";
    const data = makeData();

    const first = await saveUserData(uid, data);
    expect(first.global).toBe(true);
    expect(first.courseIds.sort()).toEqual([1, 2]);

    // 无变化再存：全部跳过
    const second = await saveUserData(uid, data);
    expect(second.global).toBe(false);
    expect(second.courseIds).toEqual([]);

    // 只改课程 2 的知识点
    const changed = makeData();
    changed.knowledgePoints[1].mastery = "unlearn";
    const third = await saveUserData(uid, changed);
    expect(third.global).toBe(false);
    expect(third.courseIds).toEqual([2]);

    // 落盘内容正确
    const loaded = loadUserData(uid);
    expect(loaded.knowledgePoints.find((k) => k.id === 101)!.mastery).toBe("unlearn");
  });

  it("删除课程后物理清理课程文件", async () => {
    const uid = "4004";
    const data = makeData();
    await saveUserData(uid, data);
    expect(listUserDir(uid)).toEqual(["course-1.json", "course-2.json", "global.json"]);

    // 删课程 2（及其知识点/题目，模拟 core 删除级联后的数据）
    const after = makeData();
    after.courses = after.courses.filter((c) => c.id !== 2);
    after.chapters = after.chapters.filter((c) => c.courseId !== 2);
    after.knowledgePoints = after.knowledgePoints.filter((k) => k.courseId !== 2);
    after.questions = after.questions.filter((q) => q.courseId !== 2);
    await saveUserData(uid, after);

    expect(listUserDir(uid)).toEqual(["course-1.json", "global.json"]);
    const loaded = loadUserData(uid);
    expect(loaded.courses).toHaveLength(1);
    expect(loaded.knowledgePoints).toHaveLength(1);
  });

  it("并发保存串行化（同 uid 队列）", async () => {
    const uid = "4005";
    const data = makeData();
    // 并发 5 次：全部成功且最终数据一致
    const results = await Promise.all([
      saveUserData(uid, data),
      saveUserData(uid, data),
      saveUserData(uid, data),
      saveUserData(uid, data),
      saveUserData(uid, data),
    ]);
    expect(results.every((r) => typeof r.global === "boolean")).toBe(true);
    const loaded = loadUserData(uid);
    expect(loaded.courses).toHaveLength(2);
    expect(loaded.knowledgePoints).toHaveLength(2);
  });

  it("assetDir 校验 uid 并返回隔离目录", () => {
    const dir = assetDir("4006");
    expect(dir).toBe(join(tmpRoot, "assets", "4006"));
    expect(existsSync(dir)).toBe(true);
    expect(() => assetDir("bad!")).toThrow("非法用户 ID");
  });
});
