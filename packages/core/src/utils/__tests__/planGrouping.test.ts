import { describe, expect, it } from "vitest";
import type { Chapter } from "../../api";
import { groupCoverageKps, groupKpLines } from "../planGrouping";

function ch(id: number, parentId: number | null, level: number, sort: number, name = `n${id}`): Chapter {
  return { id, courseId: 1, parentId, siyuanBlockId: null, name, level, sort };
}

interface Line {
  kpId: number;
  chapterId: number | null;
  sort: number;
}

const line = (kpId: number, chapterId: number | null, sort = kpId): Line => ({ kpId, chapterId, sort });

const rowDesc = <T extends Line>(rows: { kind: string; label?: string; line?: T }[]): string[] =>
  rows.map((r) => (r.kind === "kp" ? `kp:${r.line!.kpId}` : `${r.kind}:${r.label}`));

describe("groupKpLines 当日详情行 N 级分组", () => {
  const twoLevel = [ch(1, null, 1, 1), ch(2, 1, 2, 1), ch(3, 1, 2, 2)];

  it("两级回归：节先、章直属 KP 最后", () => {
    const rows = groupKpLines([line(10, 1), line(11, 2), line(12, 3)], twoLevel);
    expect(rowDesc(rows)).toEqual(["chapter:n1", "unit:n2", "kp:11", "unit:n3", "kp:12", "kp:10"]);
  });

  it("无 KP 的空节剪枝（旧行为保持）", () => {
    const rows = groupKpLines([line(10, 1)], twoLevel);
    expect(rowDesc(rows)).toEqual(["chapter:n1", "kp:10"]);
  });

  // 四级结构：1(L1) → 2(L2) → 3(L3) → 4(L4)；5(L2) 为 2 的兄弟
  const fourLevel = [ch(1, null, 1, 1), ch(2, 1, 2, 1), ch(3, 2, 3, 1), ch(4, 3, 4, 1), ch(5, 1, 2, 2)];

  it("L3 KP 落位于其父链行下（深层节点行 kind=unit）", () => {
    const rows = groupKpLines([line(20, 3)], fourLevel);
    expect(rowDesc(rows)).toEqual(["chapter:n1", "unit:n2", "unit:n3", "kp:20"]);
  });

  it("L4 KP：完整父链行逐级出现（含无直属 KP 的中间节点）", () => {
    const rows = groupKpLines([line(21, 4)], fourLevel);
    expect(rowDesc(rows)).toEqual(["chapter:n1", "unit:n2", "unit:n3", "unit:n4", "kp:21"]);
  });

  it("子节点先、节点直属 KP 后（两级旧序的 N 级推广）", () => {
    const rows = groupKpLines([line(22, 2), line(23, 3)], fourLevel);
    expect(rowDesc(rows)).toEqual(["chapter:n1", "unit:n2", "unit:n3", "kp:23", "kp:22"]);
  });

  it("顶层章直属 KP 在所有子树行之后（旧序保持）", () => {
    const rows = groupKpLines([line(1, 1), line(2, 2), line(3, 3)], fourLevel);
    expect(rowDesc(rows)).toEqual(["chapter:n1", "unit:n2", "unit:n3", "kp:3", "kp:2", "kp:1"]);
  });

  it("chapterId 悬空/为空 → 末尾裸 KP 行（旧行为保持）", () => {
    const rows = groupKpLines([line(1, 1), line(9, 99), line(10, null)], twoLevel);
    expect(rowDesc(rows)).toEqual(["chapter:n1", "kp:1", "kp:9", "kp:10"]);
  });

  it("孤儿章（parentId 指向已删）提升顶层并带头行（无 KP 的章不出现）", () => {
    const withOrphan = [...twoLevel, ch(9, 99, 3, 3, "孤儿节")];
    const rows = groupKpLines([line(9, 9)], withOrphan);
    expect(rowDesc(rows)).toEqual(["unit:孤儿节", "kp:9"]);
    const rows2 = groupKpLines([line(1, 1), line(9, 9)], withOrphan);
    expect(rowDesc(rows2)).toEqual(["chapter:n1", "kp:1", "unit:孤儿节", "kp:9"]);
  });

  it("多个顶层章按 sort 序", () => {
    const twoRoots = [ch(1, null, 1, 2), ch(6, null, 1, 1)];
    const rows = groupKpLines([line(1, 1), line(6, 6)], twoRoots);
    expect(rowDesc(rows)).toEqual(["chapter:n6", "kp:6", "chapter:n1", "kp:1"]);
  });

  it("空 lines → 空 rows", () => {
    expect(groupKpLines([], twoLevel)).toEqual([]);
  });
});

describe("groupCoverageKps 覆盖卡 N 级分组", () => {
  const twoLevel = [ch(1, null, 1, 1), ch(2, 1, 2, 1), ch(3, 1, 2, 2)];
  const fourLevel = [ch(1, null, 1, 1), ch(2, 1, 2, 1), ch(3, 2, 3, 1)];
  const kp = (id: number, chapterId: number | null, sort = id) => ({ id, chapterId, sort });

  const desc = (r: { unit?: string; kp: { id: number } }) => `${r.unit ?? "·"}:${r.kp.id}`;

  it("两级回归：节标题在该节首行、章直属 KP 无标题且最后", () => {
    const { groups, ungrouped } = groupCoverageKps([kp(10, 1), kp(11, 2), kp(12, 3)], twoLevel);
    expect(ungrouped).toEqual([]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("n1");
    expect(groups[0].rows.map(desc)).toEqual(["n2:11", "n3:12", "·:10"]);
  });

  it("L3 KP：标题为所属 L3 节名，排在父节直属 KP 之前", () => {
    const { groups, ungrouped } = groupCoverageKps([kp(2, 2), kp(3, 3)], fourLevel);
    expect(ungrouped).toEqual([]);
    expect(groups[0].rows.map(desc)).toEqual(["n3:3", "n2:2"]);
  });

  it("L2 无直属 KP 但 L3 有 → 不出现 L2 标题（标题绑定直属 KP 首行）", () => {
    const { groups } = groupCoverageKps([kp(3, 3)], fourLevel);
    expect(groups[0].rows.map(desc)).toEqual(["n3:3"]);
  });

  it("同节多 KP：仅首行带标题（旧行为保持）", () => {
    const { groups } = groupCoverageKps([kp(1, 2), kp(2, 2)], fourLevel);
    expect(groups[0].rows.map(desc)).toEqual(["n2:1", "·:2"]);
  });

  it("无 KP 的顶层章不产生空分组", () => {
    const { groups, ungrouped } = groupCoverageKps([kp(3, 3)], fourLevel);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("n1");
    expect(ungrouped).toEqual([]);
  });

  it("chapterId 悬空/为空 → ungrouped（不进分组）", () => {
    const { groups, ungrouped } = groupCoverageKps([kp(1, 1), kp(9, 99), kp(10, null)], twoLevel);
    expect(groups[0].rows.map(desc)).toEqual(["·:1"]);
    expect(ungrouped.map((k) => k.id)).toEqual([9, 10]);
  });

  it("孤儿章提升顶层自成分组（无 KP 的章不产生空分组）", () => {
    const withOrphan = [...twoLevel, ch(9, 99, 3, 3, "孤儿节")];
    const { groups } = groupCoverageKps([kp(1, 1), kp(9, 9)], withOrphan);
    expect(groups.map((g) => g.label)).toEqual(["n1", "孤儿节"]);
  });
});
