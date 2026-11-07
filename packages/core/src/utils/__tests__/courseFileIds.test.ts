import { describe, expect, it } from "vitest";
import { nextCourseId, parseCourseFileIds } from "../courseFileIds";

describe("parseCourseFileIds", () => {
  it("解析 course-<id> 文件名", () => {
    expect(parseCourseFileIds(["course-1", "course-2", "course-10"])).toEqual([1, 2, 10]);
  });

  it("排除 .bak 衍生文件与全局文件", () => {
    expect(
      parseCourseFileIds(["data", "course-2.bak-pre-passage-migration-2026-10-31T23-27-19", "course-1", "data.bak-2026-10-26"]),
    ).toEqual([1]);
  });

  it("忽略非课程文件与空列表", () => {
    expect(parseCourseFileIds(["assets", "course-x", "course-1a", "notes.md"])).toEqual([]);
    expect(parseCourseFileIds([])).toEqual([]);
  });

  it("去重", () => {
    expect(parseCourseFileIds(["course-1", "course-1"])).toEqual([1]);
  });
});

describe("nextCourseId", () => {
  it("仅按注册表分配（无磁盘文件）", () => {
    expect(nextCourseId([{ id: 1 }, { id: 4 }], [])).toBe(5);
  });

  it("注册表空但磁盘有孤儿文件：按磁盘最大 id 分配（冒烟事故场景）", () => {
    expect(nextCourseId([], [1, 2, 3, 4])).toBe(5);
    expect(nextCourseId([], [7])).toBe(8);
  });

  it("注册表与磁盘并存：取双方最大值", () => {
    expect(nextCourseId([{ id: 3 }], [5])).toBe(6);
    expect(nextCourseId([{ id: 9 }], [2])).toBe(10);
  });

  it("双方均为空：从 1 开始", () => {
    expect(nextCourseId([], [])).toBe(1);
  });
});
