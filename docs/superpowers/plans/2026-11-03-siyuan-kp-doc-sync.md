# 知识点树 ↔ 思源课程树双向同步 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 知识点树变更（KP 增/改名/改内容/换章/排序/删除、md 导入、AI 批量抽取、示例课）自动写回思源课程树章文档的知识锚点区（含章文档建/改名/移动/删除同步 + `siyuanBlockId`/`siyuanDocId` 为 null 的惰性补建）；用户可在思源章文档直接编辑知识点，经「从思源同步」按钮读回（预览确认制）。非思源宿主零影响。

**Architecture:** 锚点区 + 两条单向管道（spec §1–§3）：
- 章/节文档、课程顶层文档末尾追加 `<!-- ai-study:kps:begin/end -->` 锚点区，区是应用数据镜像（仅本节点直属 KP、sort 序、与 md 往返 KP 行逐行一致）；锚点外内容永不触碰
- 写回（应用→思源）：fire-and-forget，500ms 防抖 + 每文档串行队列；停写检测基于「本应用最后成功写入状态」（`AppData.docRegions`: docId → `{h: 规范串哈希, ids: 标记 KP id 集}`）；文档被删自愈重建；docId 为空惰性补建
- 读回（思源→应用）：显式按钮 → 读全部文档 → 组装 `ParsedKpTree` → `computeKpTreeDiff` → 预览 → 确认落盘 + 刷新区状态；删除消歧（id ∉ 存储 ids 并集 = 应用待写保留；id ∈ = 用户删除进预览）

**Tech Stack:** Vue 3 + pinia + vitest（node 环境，桥 mock 用 `setBridge`）；bridge 只用现有文档级 API（`createDoc/updateDoc/getDocMarkdown/docExists/moveDoc/renameDoc/removeDoc/ensureFolder`），契约不变。

**Spec:** `docs/superpowers/specs/2026-11-03-siyuan-kp-doc-sync-design.md`（已评审批准）

**规格实现细化（3 项，语义不变）：**
1. 区规范串**含无标记条目**（`new|name|content`）：增/删无标记条目也触发停写（落实 spec「增删行都触发」；纯 md 解析层面非 bullet 的自由文本行不计入，属 YAGNI 边界）
2. 「用户删了整个区 → 全章 KP 删除」预览确认后**删除该文档的 docRegions 条目**（此后按历史文档处理、下次写入追加区），避免停写死循环
3. 同步确认后对**所有产生 diff 且读时有区**的文档一律用应用当前渲染重写区并存渲染态（简化 spec「仅保留待写 KP 的文档才合并写回」；结果一致：同步后区 == 应用态，后续写回 skip）

## Global Constraints

- 2 空格缩进、camelCase、函数名动词开头、中文注释
- 禁止 `any`、禁止 `eslint-disable` / `@ts-ignore`
- 前端样式一律写 `packages/core/src/style.css`（组件 `<style scoped>` 不生效）
- 每个任务完成标准：`npx vue-tsc --noEmit -p packages/siyuan/tsconfig.json && npx vue-tsc --noEmit -p packages/core/tsconfig.json && npx vitest run` 全绿
- 非思源宿主（`docsEnabled()=false`）管道整体短路；md 往返导入导出（`513c8bc`）行为不变
- 写回全部 fire-and-forget：数据先 `saveData` 落盘，同步失败仅 toast，不阻塞不回滚（同 `siyuanSync.ts` 模式）
- 测试 mock 模式（参照 `packages/core/src/api/__tests__/siyuanSync.test.ts`）：`setBridge({...} as unknown as StudyBridge)` + `createEmptyData()` 造数据 + `globalThis.window` 桩（须保留 `addEventListener`/`dispatchEvent`，storage.ts 顶层依赖）
- 发版策略：功能迭代只本地 commit，不 push、不 bump（下次批量发版归 0.5.4）

---

### Task 1: `docRegions` 状态字段 + courseSplit 持久化

**Files:**
- Modify: `packages/core/src/types/appData.ts`
- Modify: `packages/core/src/utils/courseSplit.ts`
- Test: `packages/core/src/utils/__tests__/courseSplit.test.ts`

**Interfaces:**
- Produces: `AppData.docRegions?: Record<string, DocRegionState>`；`DocRegionState = { h: string; ids: number[] }`（h=最后成功写入的区规范串 djb2 哈希；ids=该次写入区内标记 KP id 集）
- 后续任务 3/5/6 全部消费此状态

- [ ] **Step 1: 加类型**

`packages/core/src/types/appData.ts`——`StudyLogMonthly` 接口之前（`AppSettings` 之前）加：

```ts
/** 思源知识点锚点区写回状态：docId → 最后成功写入状态 */
export interface DocRegionState {
  /** 最后成功写入时的区规范串哈希（条目按序 `id|name|content` 拼接的 djb2 hex） */
  h: string;
  /** 该次写入时区内标记 KP 的 id 集（读回消歧「应用待写」与「用户删除」） */
  ids: number[];
}
```

`AppData` 接口内 `reminders` 字段之后加：

```ts
  /** 思源知识点锚点区写回状态（key = 思源文档 id）；缺失 = 从未写入过（旧数据） */
  docRegions?: Record<string, DocRegionState>;
```

- [ ] **Step 2: 写失败测试**

`packages/core/src/utils/__tests__/courseSplit.test.ts`——`describe("splitAppData")` 内、`reminders` 相关断言旁加用例：

```ts
  it("docRegions 进全局块并随 merge 往返", () => {
    const data = makeData();
    data.docRegions = { doc1: { h: "1505", ids: [100, 101] } };
    const { global, courses } = splitAppData(data);
    expect(global.docRegions).toEqual({ doc1: { h: "1505", ids: [100, 101] } });
    const merged = mergeAppData(global, courses);
    expect(merged.docRegions).toEqual({ doc1: { h: "1505", ids: [100, 101] } });
  });
```

Run: `npx vitest run packages/core/src/utils/__tests__/courseSplit.test.ts` → 预期失败（`docRegions` 未进 global）

- [ ] **Step 3: 实现 courseSplit**

`packages/core/src/utils/courseSplit.ts`——`splitAppData` 内 `global.reminders = data.reminders;` 之后加一行：

```ts
  global.docRegions = data.docRegions;
```

`mergeAppData` 无需改（`{ ...global }` 展开已带 `docRegions`）。

- [ ] **Step 4: 验证**

Run: `npx vitest run packages/core/src/utils/__tests__/courseSplit.test.ts` → 全绿
Run: `npx vue-tsc --noEmit -p packages/core/tsconfig.json && npx vue-tsc --noEmit -p packages/siyuan/tsconfig.json` → 无错

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat: 新增 AppData.docRegions 思源知识点区写回状态字段（含 courseSplit 持久化）"
```

---

### Task 2: 抽 `parseKpLine`、导出 `effectiveNodeOf` 与 `MASTERY_LABEL`（纯重构 + 回归）

**Files:**
- Modify: `packages/core/src/utils/kpTreeImport.ts`
- Modify: `packages/core/src/utils/kpTreeExport.ts`
- Test: 无新增用例（现有 23 条回归必须全绿）

**Interfaces:**
- Produces: `parseKpLine(rest: string): { name: string; id: number | null }`（主解析器与 Task 3 的 `parseKpRegion` 共享）
- Produces: `effectiveNodeOf(kp: Pick<KnowledgePoint, "chapterId">, chapters: Chapter[]): number | null`（原私有；放宽为 Pick 签名，写回/读回管道计算 KP 归属节点）
- Produces: `MASTERY_LABEL: Record<Mastery, string>` 导出（区渲染复用，保证掌握度标签与 md 导出同词）

- [ ] **Step 1: kpTreeImport.ts 抽 parseKpLine + 放宽 effectiveNodeOf**

`parseKpName` 函数之后加：

```ts
/** 解析知识点 bullet 行主体：kp 标记 ID + 名称（剥离显示标签）；主解析器与思源区解析共享 */
export function parseKpLine(rest: string): { name: string; id: number | null } {
  let id: number | null = null;
  let s = rest;
  const m = s.match(KP_MARKER_RE);
  if (m) {
    id = Number(m[1]);
    s = s.slice(0, m.index);
  }
  return { name: parseKpName(s), id };
}
```

`function effectiveNodeOf(kp: KnowledgePoint, chapters: Chapter[])` 改为导出并放宽签名：

```ts
/** 现有 KP 的归属节点（顶章 id / 小节 id / null），与导出 nodeOf 一致 */
export function effectiveNodeOf(kp: Pick<KnowledgePoint, "chapterId">, chapters: Chapter[]): number | null {
```

主解析器 `- ` 分支内，把原「`let rest = line.slice(2); let id...; const m = rest.match(KP_MARKER_RE); ...` + `parseKpName(rest)`」整段替换为：

```ts
      const { name, id } = parseKpLine(line.slice(2));
```

（后续重复标记检查 / key / nodeKpIndex / currentKp 构造逻辑不变，仅 `name` 来自解构）

- [ ] **Step 2: kpTreeExport.ts 导出 MASTERY_LABEL**

```ts
export const MASTERY_LABEL: Record<Mastery, string> = {
  unlearn: "[未学习]",
  known: "[了解]",
  mastered: "[掌握]",
  proficient: "[精通]",
};
```

- [ ] **Step 3: 回归验证**

Run: `npx vitest run packages/core/src/utils/__tests__/kpTreeImport.test.ts` → 23 条全绿
Run: `npx vue-tsc --noEmit -p packages/core/tsconfig.json` → 无错

- [ ] **Step 4: 提交**

```bash
git add -A && git commit -m "refactor: 抽取 parseKpLine、导出 effectiveNodeOf/MASTERY_LABEL 供思源区同步复用"
```

---

### Task 3: `api/kpDocSync.ts` 区核心纯函数（TDD）

**Files:**
- Create: `packages/core/src/api/kpDocSync.ts`
- Test: `packages/core/src/api/__tests__/kpDocSync.test.ts`

**Interfaces:**
- Produces（本任务）：
  - `KP_REGION_BEGIN / KP_REGION_END: string`
  - `djb2Hex(str: string): string`
  - `RegionEntry = { id: number | null; name: string; content: string }`
  - `canonicalRegion(entries: RegionEntry[]): string`（条目按序 `id|name|content`，无标记=`new`；空白格式差异不改变它）
  - `renderKpRegion(kps: KnowledgePoint[]): string`（含锚点；sort 序）
  - `parseKpRegion(md: string): ParsedRegion`（`{ hasRegion, kps, hash }`；锚点未闭合=视为无区）
  - `extractRegionInfo(md: string): { hasRegion, before, after }`
  - `mergeKpRegion(oldMd: string, newRegion: string): string`（有区=替换、锚点外字节保留；无区=文末 `\n\n` 追加）
  - `decideRegionWrite(opts): RegionWriteDecision`（停写判定，见下）
- 后续任务 4/5/6 在同一文件追加

`decideRegionWrite` 判定表（停写检测核心；比对基准=最后写入态，应用领先不误报）：

| 文档区 | 存储态 | 判定 |
|---|---|---|
| 无区 | 无 | write（历史文档，追加） |
| 无区 | 有 | stop `region-deleted`（用户删了整个区） |
| 有区 | 无 | stop `state-missing`（异常保守） |
| 有区，hash ≠ 存储 h | 有 | stop `user-modified`（用户在思源改过） |
| 有区，hash == h，渲染 hash == h | 有 | skip（应用也没变，省内核调用） |
| 有区，hash == h，渲染 hash ≠ h | 有 | write（应用领先，正常写回） |

- [ ] **Step 1: 写失败测试**

`packages/core/src/api/__tests__/kpDocSync.test.ts`（本任务部分；Task 4/6 继续追加）：

```ts
import { describe, expect, it } from "vitest";
import type { KnowledgePoint } from "../../types/appData";
import {
  KP_REGION_BEGIN,
  KP_REGION_END,
  canonicalRegion,
  djb2Hex,
  decideRegionWrite,
  mergeKpRegion,
  parseKpRegion,
  renderKpRegion,
} from "../kpDocSync";

function makeKp(over: Partial<KnowledgePoint> & { id: number }): KnowledgePoint {
  return {
    courseId: 1,
    chapterId: null,
    blockId: null,
    name: `KP${over.id}`,
    content: "",
    mastery: "unlearn",
    sourceAssetIds: "",
    prevKpIds: "",
    chapterName: "",
    sort: over.id,
    createTime: "2026-11-01T00:00:00Z",
    ...over,
  };
}

describe("renderKpRegion ↔ parseKpRegion 往返", () => {
  it("多段落/空内容/掌握度标签：解析结果与原数据一致", () => {
    const kps = [
      makeKp({ id: 1, name: "甲", content: "第一段。\n\n第二段。", mastery: "mastered", sort: 2 }),
      makeKp({ id: 2, name: "无内容", sort: 1 }),
    ];
    const region = renderKpRegion(kps);
    expect(region.startsWith(KP_REGION_BEGIN)).toBe(true);
    expect(region.endsWith(KP_REGION_END)).toBe(true);
    expect(region).toContain(`- 无内容 [未学习] <!-- kp:2 -->`);
    expect(region).toContain(`- 甲 [掌握] <!-- kp:1 -->`);
    const parsed = parseKpRegion(region);
    expect(parsed.hasRegion).toBe(true);
    expect(parsed.kps).toEqual([
      { id: 2, name: "无内容", content: "" },
      { id: 1, name: "甲", content: "第一段。\n\n第二段。" },
    ]);
    expect(parsed.hash).toBe(djb2Hex(canonicalRegion(kps)));
  });

  it("空 KP 列表渲染空区，解析为 0 条目", () => {
    const parsed = parseKpRegion(renderKpRegion([]));
    expect(parsed.hasRegion).toBe(true);
    expect(parsed.kps).toEqual([]);
    expect(parsed.hash).toBe(djb2Hex(""));
  });
});

describe("mergeKpRegion", () => {
  const region = renderKpRegion([makeKp({ id: 1 })]);
  it("有区：仅替换区，锚点外字节保留", () => {
    const old = `# 章A\n\n用户手写内容。\n\n${renderKpRegion([makeKp({ id: 9, name: "旧", content: "旧内容" })])}\n\n区后内容。`;
    const merged = mergeKpRegion(old, region);
    expect(merged.startsWith("# 章A\n\n用户手写内容。\n\n")).toBe(true);
    expect(merged.endsWith("区后内容。")).toBe(true);
    expect(merged).toContain("<!-- kp:1 -->");
    expect(merged).not.toContain("<!-- kp:9 -->");
  });
  it("无区：文末空行分隔追加；空文档：仅区", () => {
    expect(mergeKpRegion("# 章A\n\n已有内容", region)).toBe(`# 章A\n\n已有内容\n\n${region}\n`);
    expect(mergeKpRegion("", region)).toBe(`${region}\n`);
  });
});

describe("规范哈希变更检测", () => {
  const base = [makeKp({ id: 1, content: "内容" }), makeKp({ id: 2 })];
  const h0 = djb2Hex(canonicalRegion(base));
  it("用户只加空行（条目间/区首尾）：哈希不变，不触发停写", () => {
    const region = renderKpRegion([makeKp({ id: 1, content: "第一段。\n\n第二段。" })]);
    const h = parseKpRegion(region).hash;
    const tampered = region
      .replace(`${KP_REGION_BEGIN}\n`, `${KP_REGION_BEGIN}\n\n`)
      .replace(KP_REGION_END, `\n\n${KP_REGION_END}`);
    expect(parseKpRegion(tampered).hash).toBe(h);
  });
  it("内容改/行序变/增删行（含无标记条目）：哈希都变", () => {
    expect(djb2Hex(canonicalRegion([makeKp({ id: 1, content: "内容改" }), makeKp({ id: 2 })]))).not.toBe(h0);
    expect(djb2Hex(canonicalRegion([makeKp({ id: 2 }), makeKp({ id: 1, content: "内容" })]))).not.toBe(h0);
    expect(djb2Hex(canonicalRegion([...base, { id: null, name: "用户加的", content: "" }]))).not.toBe(h0);
  });
});

describe("decideRegionWrite 写回分流", () => {
  const H = "abc123";
  it("区 hash == 存储 h + 应用已改 → write（应用领先不误报）", () => {
    expect(decideRegionWrite({ hasStored: true, storedHash: H, regionHash: H, renderedHash: "def" })).toEqual({ action: "write" });
  });
  it("区 hash == 存储 h + 应用未变 → skip", () => {
    expect(decideRegionWrite({ hasStored: true, storedHash: H, regionHash: H, renderedHash: H })).toEqual({ action: "skip" });
  });
  it("区 hash ≠ 存储 h → stop user-modified", () => {
    expect(decideRegionWrite({ hasStored: true, storedHash: H, regionHash: "other", renderedHash: H })).toEqual({
      action: "stop",
      reason: "user-modified",
    });
  });
  it("无区无状态 → write（历史文档追加）；无区有状态 → stop region-deleted；有区无状态 → stop state-missing", () => {
    expect(decideRegionWrite({ hasStored: false, storedHash: null, regionHash: "", renderedHash: H })).toEqual({ action: "write" });
    expect(decideRegionWrite({ hasStored: true, storedHash: H, regionHash: "", renderedHash: H })).toEqual({
      action: "stop",
      reason: "region-deleted",
    });
    expect(decideRegionWrite({ hasStored: false, storedHash: null, regionHash: H, renderedHash: H })).toEqual({
      action: "stop",
      reason: "state-missing",
    });
  });
});
```

Run: `npx vitest run packages/core/src/api/__tests__/kpDocSync.test.ts` → 预期失败（模块不存在）

- [ ] **Step 2: 实现区核心纯函数**

创建 `packages/core/src/api/kpDocSync.ts`（本任务部分；后续任务继续追加）：

```ts
// 知识点锚点区 ↔ 思源文档双向同步（核心纯函数 + 写回/读回管道）
//
// 文档格式：章/节文档、课程顶层文档末尾追加锚点区，区是应用数据镜像
// （仅本节点直属 KP、sort 序、与 md 往返 KP 行逐行一致）；锚点外内容永不触碰。
import type { AppData, Chapter, Course, DocRegionState, KnowledgePoint } from "../types/appData";
import { getData, saveData } from "./storage";
import { getSettings } from "./settings";
import { createDoc, docsEnabled, ensureFolder, removeDocIfExists } from "./docStore";
import {
  applyKpTreeDiff,
  computeKpTreeDiff,
  effectiveNodeOf,
  parseKpLine,
  type KpTreeDiff,
  type ParsedKp,
  type ParsedKpTree,
} from "../utils/kpTreeImport";
import { MASTERY_LABEL } from "../utils/kpTreeExport";
import { getBridge } from "@/bridge";

// ---------- 区常量与规范哈希 ----------

export const KP_REGION_BEGIN = "<!-- ai-study:kps:begin -->";
export const KP_REGION_END = "<!-- ai-study:kps:end -->";

/** djb2 哈希（32 位 hex）；用于区变更检测，非密码学用途 */
export function djb2Hex(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  }
  return h.toString(16);
}

/** 区内一个条目（带标记或无标记） */
export interface RegionEntry {
  id: number | null;
  name: string;
  content: string;
}

/** 区规范串：条目按序 `id|name|content` 拼接（无标记 = `new`）。
 *  空白/缩进/空行格式差异不改变规范串；内容、名称、行序、增删行（含无标记）都改变 */
export function canonicalRegion(entries: RegionEntry[]): string {
  return entries.map((e) => `${e.id ?? "new"}|${e.name}|${e.content}`).join("\n");
}

// ---------- 渲染与解析 ----------

/** 渲染 KP 列表为锚点区（含锚点）：sort 序，与 md 往返 KP 行逐行一致 */
export function renderKpRegion(kps: KnowledgePoint[]): string {
  const lines: string[] = [KP_REGION_BEGIN];
  for (const k of [...kps].sort((a, b) => a.sort - b.sort)) {
    lines.push(`- ${k.name} ${MASTERY_LABEL[k.mastery]} <!-- kp:${k.id} -->`);
    if (k.content) {
      for (const l of k.content.split("\n")) lines.push(l === "" ? "" : `  ${l}`);
    }
  }
  lines.push(KP_REGION_END);
  return lines.join("\n");
}

interface ParsedRegionKp {
  id: number | null;
  name: string;
  content: string;
}

export interface ParsedRegion {
  /** 存在闭合区（两锚点齐全且 begin 在 end 前）；锚点未闭合 = 视为无区 */
  hasRegion: boolean;
  /** 区内条目（带标记 + 无标记，按文档序）；区内的非 bullet 自由文本行不计入条目 */
  kps: ParsedRegionKp[];
  /** 区条目规范哈希；"" = 无区 */
  hash: string;
}

/** 解析文档中的知识点锚点区（内容行规则与 md 树解析一致：空行 / 2 空格缩进，尾部空行丢弃） */
export function parseKpRegion(md: string): ParsedRegion {
  const beginIdx = md.indexOf(KP_REGION_BEGIN);
  const endIdx = md.indexOf(KP_REGION_END);
  if (beginIdx < 0 || endIdx < 0 || endIdx <= beginIdx) {
    return { hasRegion: false, kps: [], hash: "" };
  }
  const body = md.slice(beginIdx + KP_REGION_BEGIN.length, endIdx).replace(/\r\n/g, "\n");
  const kps: ParsedRegionKp[] = [];
  let current: ParsedRegionKp | null = null;
  const buf: string[] = [];
  const finalize = (): void => {
    if (current) {
      while (buf.length > 0 && buf[buf.length - 1] === "") buf.pop();
      current.content = buf.join("\n");
      kps.push(current);
    }
    buf.length = 0;
    current = null;
  };
  for (const raw of body.split("\n")) {
    if (current !== null && (raw.trim() === "" || /^\s/.test(raw))) {
      buf.push(raw.trim() === "" ? "" : raw.replace(/^ {2}/, "").replace(/^\t/, ""));
      continue;
    }
    finalize();
    if (raw.trim() === "" || !raw.startsWith("- ")) continue;
    const { name, id } = parseKpLine(raw.slice(2));
    current = { id, name, content: "" };
  }
  finalize();
  return { hasRegion: true, kps, hash: djb2Hex(canonicalRegion(kps)) };
}

// ---------- 合并与写回判定 ----------

/** 定位文档锚点区：返回锚点外前缀/后缀（替换时锚点外字节级保留） */
export function extractRegionInfo(md: string): { hasRegion: boolean; before: string; after: string } {
  const beginIdx = md.indexOf(KP_REGION_BEGIN);
  const endIdx = md.indexOf(KP_REGION_END);
  if (beginIdx < 0 || endIdx < 0 || endIdx <= beginIdx) {
    return { hasRegion: false, before: md, after: "" };
  }
  return {
    hasRegion: true,
    before: md.slice(0, beginIdx),
    after: md.slice(endIdx + KP_REGION_END.length),
  };
}

/** 新区合并进旧文档：有区 → 替换区（锚点外保留）；无区 → 文末追加（\n\n 分隔） */
export function mergeKpRegion(oldMd: string, newRegion: string): string {
  const info = extractRegionInfo(oldMd);
  if (info.hasRegion) {
    return info.before + newRegion + info.after;
  }
  const base = oldMd.trimEnd();
  return `${base ? base + "\n\n" : ""}${newRegion}\n`;
}

export type RegionWriteDecision =
  | { action: "write" }
  | { action: "skip" }
  | { action: "stop"; reason: "user-modified" | "region-deleted" | "state-missing" };

/**
 * 依据「存储的最后写入态 + 文档当前区状态」判定写回策略（停写检测核心）：
 * 比对基准是「本应用最后写入的状态」而非「应用当前状态」——应用领先（改过还没写）不误报；
 * 用户只动空白/空行时规范哈希不变也不误报（写回时顺带规范化）。
 */
export function decideRegionWrite(opts: {
  hasStored: boolean;
  storedHash: string | null;
  /** "" = 文档无（闭合）区 */
  regionHash: string;
  renderedHash: string;
}): RegionWriteDecision {
  if (opts.regionHash === "") {
    if (opts.hasStored) return { action: "stop", reason: "region-deleted" };
    return { action: "write" };
  }
  if (!opts.hasStored) return { action: "stop", reason: "state-missing" };
  if (opts.regionHash !== (opts.storedHash ?? "")) return { action: "stop", reason: "user-modified" };
  if (opts.renderedHash === opts.storedHash) return { action: "skip" };
  return { action: "write" };
}
```

注意：文件顶部 import 里 `applyKpTreeDiff/computeKpTreeDiff/AppData/DocRegionState/removeDocIfExists/getData/saveData/getSettings/createDoc/ensureFolder/ParsedKp/ParsedKpTree/KpTreeDiff` 本任务暂用不到——**实现时先只写本任务用到的 import**（`AppData` 不需要；保留 `Chapter, Course, DocRegionState, KnowledgePoint` 中实际用到的），后续任务追加 import。TypeScript 对未使用的 import 会报 `noUnusedLocals`（若开启）——以 vue-tsc 结果为准，缺什么补什么。

- [ ] **Step 3: 验证**

Run: `npx vitest run packages/core/src/api/__tests__/kpDocSync.test.ts` → 本任务用例全绿
Run: `npx vue-tsc --noEmit -p packages/core/tsconfig.json && npx vue-tsc --noEmit -p packages/siyuan/tsconfig.json` → 无错
Run: `npx vitest run` → 全量不回归

- [ ] **Step 4: 提交**

```bash
git add -A && git commit -m "feat: 知识点锚点区核心纯函数（渲染/解析/合并/停写判定）"
```

---

### Task 4: `buildSiyuanParsedTree` 读回组树纯函数（TDD）

**Files:**
- Modify: `packages/core/src/api/kpDocSync.ts`（追加）
- Test: `packages/core/src/api/__tests__/kpDocSync.test.ts`（追加）

**Interfaces:**
- Produces:
  - `SiyuanSyncBuildInput = { course: Course; chapters: Chapter[]; kps: KnowledgePoint[]; docRegions: Record<string, DocRegionState>; docs: Map<string, string | null> }`（`docs`: docId → 文档 markdown，`null`=文档已删除；Map 里没有的 docId 不会出现，docId 为 null 的节点不查 Map）
  - `SiyuanSyncBuild = { tree: ParsedKpTree; deletedDocs: number; historicalDocs: number; retained: number }`
  - `buildSiyuanParsedTree(input: SiyuanSyncBuildInput): SiyuanSyncBuild`（纯函数）

**组树规则（spec §3 安全规则表）：**
- `chapters`：本课程现有章节全部带标记（`key = id:<id>`，unit 的 `parentKey = id:<parentId>`）→ 读回**不产生**章节结构变更
- 逐节点（各章按 sort 序 + 未归章 null 最后）按文档/区状态分流：
  - docId 为 null（从未落库）→ `historicalDocs++`，该节点应用 KP 原样注入（无 diff）
  - 文档不存在（md null）→ `deletedDocs++`，原样注入（不清空，下次写回自愈重建）
  - 无区 + 无存储态 → `historicalDocs++`，原样注入
  - 无区 + 有存储态 → 用户删了整个区 → **不注入**（全章 KP 进删除预览）
  - 有区 → 区是真相：带标记条目 → `ParsedKp{id:<id>}`；无标记条目 → `ParsedKp{new:<n>}`（新增）；应用有但区内无的 KP：**id ∈ 存储 ids 并集** → 不注入（用户删除进预览）；**id ∉ 并集** → 保留原样注入 + `retained++`（应用待写，确认后合并回区写回）
- 节点归属用 `effectiveNodeOf`（幽灵 chapterId → 未归章 → 课程文档）

- [ ] **Step 1: 写失败测试**

`kpDocSync.test.ts` 追加：

```ts
import type { Chapter, Course } from "../../types/appData";
import { computeKpTreeDiff } from "../../utils/kpTreeImport";
import { buildSiyuanParsedTree } from "../kpDocSync";

describe("buildSiyuanParsedTree 读回分流", () => {
  const course: Course = {
    id: 1, siyuanDocId: "doc-course", name: "测试课程", description: "", target: "",
    totalCycle: "", status: "active", createTime: "2026-11-01T00:00:00Z",
  };
  const chA: Chapter = { id: 10, courseId: 1, parentId: null, siyuanBlockId: "docA", name: "章A", level: "chapter", sort: 1 };
  const chB: Chapter = { id: 11, courseId: 1, parentId: 10, siyuanBlockId: "docB", name: "节B", level: "unit", sort: 1 };
  const chapters = [chA, chB];

  function kp(over: Partial<KnowledgePoint> & { id: number }): KnowledgePoint {
    return makeKp({ chapterId: 10, ...over });
  }
  const regionOf = (kps: KnowledgePoint[]): string => `# 章\n\n${renderKpRegion(kps)}`;

  it("未改动文档（区 == 应用现状）：diff 全空、无提示计数", () => {
    const kps = [kp({ id: 1, name: "P1", content: "C1" })];
    const docA = regionOf(kps);
    const built = buildSiyuanParsedTree({
      course,
      chapters,
      kps,
      docRegions: { docA: { h: parseKpRegion(docA).hash, ids: [1] } },
      docs: new Map([
        ["docA", docA],
        ["docB", "# 节B\n\n" + KP_REGION_BEGIN + "\n" + KP_REGION_END],
        ["doc-course", "# 测试课程\n\n用户手写"],
      ]),
    });
    expect(built.deletedDocs).toBe(0);
    expect(built.historicalDocs).toBe(1); // 课程文档无区无状态 = 历史
    expect(built.retained).toBe(0);
    const diff = computeKpTreeDiff(built.tree, chapters, kps);
    expect(diff.updated.length + diff.added.length + diff.removed.length).toBe(0);
    expect(diff.chaptersUpdated.length + diff.chaptersAdded.length + diff.chaptersRemoved.length).toBe(0);
  });

  it("无区无状态（历史文档）= 跳过：该章 KP 不删", () => {
    const kps = [kp({ id: 1 })];
    const built = buildSiyuanParsedTree({
      course, chapters, kps, docRegions: {},
      docs: new Map([["docA", "# 章A\n\n用户手写，没有区"], ["docB", "# 节B"], ["doc-course", "# 测试课程"]]),
    });
    expect(built.historicalDocs).toBe(3);
    const diff = computeKpTreeDiff(built.tree, chapters, kps);
    expect(diff.removed).toEqual([]);
    expect(diff.updated).toEqual([]);
  });

  it("无区有状态（用户删了整个区）= 该章全部 KP 进删除预览", () => {
    const kps = [kp({ id: 1 }), kp({ id: 2, chapterId: 10 })];
    const built = buildSiyuanParsedTree({
      course, chapters, kps,
      docRegions: { docA: { h: "x", ids: [1, 2] } },
      docs: new Map([["docA", "# 章A\n\n区被删了"], ["docB", "# 节B"], ["doc-course", "# 测试课程"]]),
    });
    const diff = computeKpTreeDiff(built.tree, chapters, kps);
    expect(diff.removed.map((r) => r.id).sort()).toEqual([1, 2]);
  });

  it("应用待写 KP（id ∉ 存储 ids 并集）= 保留不删 + retained 计数", () => {
    const kps = [kp({ id: 1 }), kp({ id: 2 })]; // 2 是应用刚加、还没写进区的
    const docA = regionOf([kp({ id: 1 })]);
    const built = buildSiyuanParsedTree({
      course, chapters, kps,
      docRegions: { docA: { h: parseKpRegion(docA).hash, ids: [1] } },
      docs: new Map([["docA", docA], ["docB", "# 节B"], ["doc-course", "# 测试课程"]]),
    });
    expect(built.retained).toBe(1);
    const diff = computeKpTreeDiff(built.tree, chapters, kps);
    expect(diff.removed).toEqual([]);
    expect(diff.updated).toEqual([]);
  });

  it("id ∈ 存储 ids 且区内缺失 = 用户删除，进预览", () => {
    const kps = [kp({ id: 1 }), kp({ id: 2 })];
    const docA = regionOf([kp({ id: 2 })]);
    const built = buildSiyuanParsedTree({
      course, chapters, kps,
      docRegions: { docA: { h: parseKpRegion(docA).hash, ids: [1, 2] } },
      docs: new Map([["docA", docA], ["docB", "# 节B"], ["doc-course", "# 测试课程"]]),
    });
    const diff = computeKpTreeDiff(built.tree, chapters, kps);
    expect(diff.removed.map((r) => r.id)).toEqual([1]);
  });

  it("跨文档移动（KP 出现在别章的区）= updated 带 chapterKey 变更", () => {
    const kps = [kp({ id: 1, chapterId: 10 })];
    const built = buildSiyuanParsedTree({
      course, chapters, kps,
      docRegions: {
        docA: { h: "x", ids: [1] },
        docB: { h: parseKpRegion(regionOf([kp({ id: 1 })])).hash, ids: [1] },
      },
      docs: new Map([
        ["docA", "# 章A\n\n" + KP_REGION_BEGIN + "\n" + KP_REGION_END],
        ["docB", regionOf([kp({ id: 1 })])],
        ["doc-course", "# 测试课程"],
      ]),
    });
    const diff = computeKpTreeDiff(built.tree, chapters, kps);
    expect(diff.updated).toHaveLength(1);
    expect(diff.updated[0].id).toBe(1);
    expect(diff.updated[0].chapterKey).toBe("id:11");
  });

  it("区内无标记条目 = added（归所在文档章节）", () => {
    const kps = [kp({ id: 1 })];
    const docA = regionOf([kp({ id: 1 })]).replace(
      KP_REGION_END,
      `- 用户新增 [未学习]\n  新内容\n${KP_REGION_END}`,
    );
    const built = buildSiyuanParsedTree({
      course, chapters, kps,
      docRegions: { docA: { h: "x", ids: [1] } },
      docs: new Map([["docA", docA], ["docB", "# 节B"], ["doc-course", "# 测试课程"]]),
    });
    const diff = computeKpTreeDiff(built.tree, chapters, kps);
    expect(diff.added).toHaveLength(1);
    expect(diff.added[0].name).toBe("用户新增");
    expect(diff.added[0].content).toBe("新内容");
    expect(diff.added[0].chapterKey).toBe("id:10");
  });

  it("多文档归章：章文档→顶章、节文档→unit、课程文档→未归章；文档不存在=跳过不清空", () => {
    const kps = [kp({ id: 1, chapterId: null })]; // 未归章
    const built = buildSiyuanParsedTree({
      course, chapters, kps,
      docRegions: { "doc-course": { h: "x", ids: [] } },
      docs: new Map([
        ["docA", null], // 章文档被用户删除
        ["docB", "# 节B"],
        ["doc-course", regionOf([]).replace("# 章", "# 测试课程")],
      ]),
    });
    expect(built.deletedDocs).toBe(1);
    expect(built.historicalDocs).toBe(1); // docB 无区无状态
    // 课程文档空区（有区）→ 未归章 KP 区内缺失；id ∉ 存储 ids([]) 并集 → 保留
    expect(built.retained).toBe(1);
    const diff = computeKpTreeDiff(built.tree, chapters, kps);
    expect(diff.removed).toEqual([]);
  });
});
```

Run: `npx vitest run packages/core/src/api/__tests__/kpDocSync.test.ts` → 新用例失败（`buildSiyuanParsedTree` 不存在）

- [ ] **Step 2: 实现 buildSiyuanParsedTree**

`kpDocSync.ts` 追加（import 需补 `type ParsedChapter`、`type ParsedKpTree` 等）：

```ts
// ---------- 读回组树（纯函数） ----------

export interface SiyuanSyncBuildInput {
  course: Course;
  /** 本课程全部章节（含 unit） */
  chapters: Chapter[];
  /** 本课程全部知识点 */
  kps: KnowledgePoint[];
  docRegions: Record<string, DocRegionState>;
  /** docId → 文档 markdown；null = 文档已删除（docId 为 null 的节点不在此 Map） */
  docs: Map<string, string | null>;
}

export interface SiyuanSyncBuild {
  tree: ParsedKpTree;
  /** 文档已不存在（用户删除）的文档数（计入提示，不清空该节点 KP） */
  deletedDocs: number;
  /** 文档未落库或尚无知识点的区（历史）的文档数 */
  historicalDocs: number;
  /** 应用侧待写 KP 保留数（id ∉ 存储 ids 并集，确认后合并回区写回） */
  retained: number;
}

/** 读回组装 ParsedKpTree：chapters 全部带标记（读回不产生章节结构变更）；
 *  kps 按文档/区状态分流（见 spec §3 安全规则表） */
export function buildSiyuanParsedTree(input: SiyuanSyncBuildInput): SiyuanSyncBuild {
  const { course, chapters, kps, docRegions, docs } = input;

  const treeChapters: ParsedChapter[] = [...chapters]
    .sort((a, b) => a.sort - b.sort)
    .map((c) => ({
      key: `id:${c.id}`,
      id: c.id,
      name: c.name,
      level: c.level,
      parentKey: c.level === "unit" && c.parentId !== null ? `id:${c.parentId}` : null,
      sort: c.sort,
    }));

  // 存储 ids 并集（跨全部文档）：区分「应用待写」与「用户删除」
  const unionStoredIds = new Set<number>();
  for (const s of Object.values(docRegions)) {
    for (const id of s.ids) unionStoredIds.add(id);
  }

  const nodeOrder: Array<{ node: number | null; key: string | null }> = [
    ...[...chapters]
      .sort((a, b) => a.sort - b.sort)
      .map((c) => ({ node: c.id as number | null, key: `id:${c.id}` as string | null })),
    { node: null, key: null },
  ];

  const treeKps: ParsedKp[] = [];
  const injectKept = (list: KnowledgePoint[], key: string | null): void => {
    for (const k of list) {
      treeKps.push({ key: `id:${k.id}`, id: k.id, name: k.name, content: k.content, chapterKey: key, sort: treeKps.length });
    }
  };

  let deletedDocs = 0;
  let historicalDocs = 0;
  let retained = 0;
  let newCounter = 0;

  for (const { node, key } of nodeOrder) {
    const docId = node === null ? course.siyuanDocId : chapters.find((c) => c.id === node)?.siyuanBlockId ?? null;
    const nodeKps = kps.filter((k) => effectiveNodeOf(k, chapters) === node).sort((a, b) => a.sort - b.sort);
    if (docId === null) {
      historicalDocs++;
      injectKept(nodeKps, key);
      continue;
    }
    const md = docs.get(docId) ?? null;
    if (md === null) {
      deletedDocs++;
      injectKept(nodeKps, key);
      continue;
    }
    const region = parseKpRegion(md);
    const stored = docRegions[docId];
    if (!region.hasRegion) {
      if (stored !== undefined) {
        // 用户删了整个区 → 不注入，全章 KP 进删除预览（确认才执行）
      } else {
        historicalDocs++;
        injectKept(nodeKps, key);
      }
      continue;
    }
    const markedIds = new Set<number>();
    for (const e of region.kps) {
      if (e.id !== null) {
        markedIds.add(e.id);
        treeKps.push({ key: `id:${e.id}`, id: e.id, name: e.name, content: e.content, chapterKey: key, sort: treeKps.length });
      } else {
        treeKps.push({ key: `new:${newCounter++}`, id: null, name: e.name, content: e.content, chapterKey: key, sort: treeKps.length });
      }
    }
    for (const k of nodeKps) {
      if (markedIds.has(k.id)) continue;
      if (unionStoredIds.has(k.id)) continue; // 上次写入时在区里、现被用户删 → 进删除预览
      retained++;
      treeKps.push({ key: `id:${k.id}`, id: k.id, name: k.name, content: k.content, chapterKey: key, sort: treeKps.length });
    }
  }

  return {
    tree: { importable: true, courseId: course.id, courseName: course.name, chapters: treeChapters, kps: treeKps },
    deletedDocs,
    historicalDocs,
    retained,
  };
}
```

- [ ] **Step 3: 验证**

Run: `npx vitest run packages/core/src/api/__tests__/kpDocSync.test.ts` → 全绿
Run: `npx vue-tsc --noEmit -p packages/core/tsconfig.json && npx vue-tsc --noEmit -p packages/siyuan/tsconfig.json` → 无错

- [ ] **Step 4: 提交**

```bash
git add -A && git commit -m "feat: 思源读回组树纯函数 buildSiyuanParsedTree（文档分流 + 删除消歧）"
```

---

### Task 5: 写回管道（`nodeDocTarget` + `scheduleKpRegionSync` + `doNodeSync`）

**Files:**
- Modify: `packages/core/src/api/kpDocSync.ts`（追加）
- Test: `packages/core/src/api/__tests__/kpDocSync.test.ts`（追加 api 段）

**Interfaces:**
- Produces:
  - `NodeDocTarget = { docId: string | null; path: string; parentID: string | null; titleLine: string; label: string }`
  - `nodeDocTarget(course, chapters, node: number | null): NodeDocTarget`（null=课程顶层文档；幽灵节点回退课程文档；unit path 含父章名、parentID=父章文档）
  - `kpRegionSyncEnabled(): boolean`（`docsEnabled()`；非思源端整体短路）
  - `scheduleKpRegionSync(courseId: number, node: number | null, delay?: number): void`（500ms 防抖合并 + 每文档串行队列，`siyuanSync.ts` 的 `convSyncChains` 同款）

**写回流程 `doNodeSync`（串行段内执行）：**
1. 重取 data/settings；`persistToSiyuan` 关或课程不存在 → 结束
2. `nodeDocTarget` 定位文档；`kps` = 本节点直属（`effectiveNodeOf === node`）
3. docId 为空 → **补建**（`createDoc` path+parentID，回填 `chapter.siyuanBlockId`/`course.siyuanDocId`，toast「曾缺失，已自动补建」）+ 存状态
4. `getDocMarkdown`：null 且 `docExists`=true → 读取失败跳过（toast）；null 且不存在 → **自愈重建**（同补建，toast「曾被删除，已自动重建」）
5. `decideRegionWrite`：stop → toast 停写提示（区分「删了区/有未同步编辑/状态缺失」三种文案）；skip → 结束
6. write → `updateDoc(mergeKpRegion(md, renderKpRegion(kps)))` + `docRegions[docId] = { h: 渲染规范哈希, ids }` + `saveData`
7. 全程 try/catch，失败 toast（fire-and-forget，不抛）

- [ ] **Step 1: 写失败测试**

`kpDocSync.test.ts` 末尾追加 api 段（参照 `siyuanSync.test.ts` 的 setBridge 模式；防抖用 fake timers）：

```ts
import { afterEach, beforeAll, beforeEach, vi } from "vitest";
import { createEmptyData, type AppData } from "../../types/appData";
import { scheduleKpRegionSync, parseKpRegion, renderKpRegion } from "../kpDocSync";
import { setBridge } from "../../bridge";
import type { StudyBridge } from "../../bridge/types";

describe("写回管道（bridge mock）", () => {
  const docs = new Map<string, string>();
  const calls: { update: Array<{ id: string; md: string }>; create: Array<{ md: string; path: string; parent: string | null }>; toast: string[] } = {
    update: [],
    create: [],
    toast: [],
  };
  let data: AppData;

  function setup(): void {
    data = createEmptyData();
    data.courses = [
      { id: 1, siyuanDocId: "doc-course", name: "测试课程", description: "", target: "", totalCycle: "", status: "active", createTime: "2026-11-01T00:00:00Z" },
    ];
    data.chapters = [
      { id: 10, courseId: 1, parentId: null, siyuanBlockId: "docA", name: "章A", level: "chapter", sort: 1 },
    ];
    data.knowledgePoints = [
      { id: 1, courseId: 1, chapterId: 10, blockId: null, name: "KP1", content: "c", mastery: "unlearn", sourceAssetIds: "", prevKpIds: "", chapterName: "章A", sort: 1, createTime: "2026-11-01T00:00:00Z" },
    ];
    data.settings = { chapterMode: "manual", persistToSiyuan: true, notebookName: "AI 研习" };
    docs.clear();
    docs.set("doc-course", "# 测试课程");
    docs.set("docA", "# 章A\n\n用户手写");
    calls.update.length = 0;
    calls.create.length = 0;
    calls.toast.length = 0;
  }

  beforeAll(() => {
    (globalThis as Record<string, unknown>).window = {
      addEventListener: () => {},
      dispatchEvent: () => true,
    };
  });

  beforeEach(() => {
    setup();
    vi.useFakeTimers();
    setBridge({
      capabilities: { docs: "siyuan" },
      getData: async () => data,
      saveData: async (next: AppData) => {
        data = next;
        return { code: 0, dirty: { global: true, courseIds: [] } };
      },
      ensureFolder: async () => "nb",
      createDoc: async (md: string, path: string, _nb: string, parent?: string | null) => {
        const id = `doc-new-${calls.create.length}`;
        calls.create.push({ md, path, parent: parent ?? null });
        docs.set(id, md);
        return { id };
      },
      updateDoc: async (id: string, md: string) => {
        calls.update.push({ id, md });
        docs.set(id, md);
      },
      getDocMarkdown: async (id: string) => (docs.has(id) ? (docs.get(id) as string) : null),
      docExists: async (id: string) => docs.has(id),
      showMessage: (msg: string) => {
        calls.toast.push(msg);
      },
      isValidDocRef: () => true,
      moveDoc: async () => {},
      renameDoc: async () => {},
      removeDoc: async (id: string) => {
        docs.delete(id);
      },
    } as unknown as StudyBridge);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const flush = () => vi.advanceTimersByTimeAsync(1000);

  it("历史文档（无区无状态）：追加区 + 存状态", async () => {
    await scheduleKpRegionSync(1, 10, 0);
    await flush();
    expect(calls.update).toHaveLength(1);
    expect(calls.update[0].id).toBe("docA");
    expect(calls.update[0].md).toContain("用户手写");
    expect(calls.update[0].md).toContain("<!-- kp:1 -->");
    expect(data.docRegions?.docA?.ids).toEqual([1]);
  });

  it("应用领先（区 == 存储态、应用已改）：正常写回，不误报停写", async () => {
    docs.set("docA", `# 章A\n\n用户手写\n\n${renderKpRegion(data.knowledgePoints)}`);
    data.docRegions = { docA: { h: parseKpRegion(docs.get("docA")!).hash, ids: [1] } };
    data.knowledgePoints[0] = { ...data.knowledgePoints[0], content: "c2" };
    await scheduleKpRegionSync(1, 10, 0);
    await flush();
    expect(calls.update).toHaveLength(1);
    expect(calls.update[0].md).toContain("c2");
    expect(calls.toast).toEqual([]);
  });

  it("用户在思源改过区：停写 + toast，文档不变", async () => {
    docs.set("docA", `# 章A\n\n${renderKpRegion(data.knowledgePoints)}`.replace("c", "c-用户改"));
    data.docRegions = { docA: { h: "old-hash", ids: [1] } };
    await scheduleKpRegionSync(1, 10, 0);
    await flush();
    expect(calls.update).toHaveLength(0);
    expect(calls.toast.some((t) => t.includes("未同步编辑"))).toBe(true);
  });

  it("用户删了整个区：停写 region-deleted", async () => {
    docs.set("docA", "# 章A\n\n区没了");
    data.docRegions = { docA: { h: "x", ids: [1] } };
    await scheduleKpRegionSync(1, 10, 0);
    await flush();
    expect(calls.update).toHaveLength(0);
    expect(calls.toast.some((t) => t.includes("删除"))).toBe(true);
  });

  it("文档被删：自愈重建（新 docId 回填 + toast）", async () => {
    docs.delete("docA");
    await scheduleKpRegionSync(1, 10, 0);
    await flush();
    expect(calls.create).toHaveLength(1);
    expect(calls.create[0].path).toBe("/测试课程/章A");
    expect(calls.create[0].parent).toBe("doc-course");
    expect(data.chapters[0].siyuanBlockId).not.toBe("docA");
    expect(calls.toast.some((t) => t.includes("重建"))).toBe(true);
  });

  it("siyuanBlockId 为 null：补建文档 + 回填 id", async () => {
    data.chapters[0].siyuanBlockId = null;
    await scheduleKpRegionSync(1, 10, 0);
    await flush();
    expect(calls.create).toHaveLength(1);
    expect(data.chapters[0].siyuanBlockId).toBe("doc-new-0");
  });

  it("未归章（node=null）：写课程顶层文档", async () => {
    data.knowledgePoints[0].chapterId = null;
    await scheduleKpRegionSync(1, null, 0);
    await flush();
    expect(calls.update[0].id).toBe("doc-course");
    expect(calls.update[0].md).toContain("<!-- kp:1 -->");
  });

  it("persistToSiyuan 关闭：不写不提示", async () => {
    data.settings.persistToSiyuan = false;
    await scheduleKpRegionSync(1, 10, 0);
    await flush();
    expect(calls.update).toHaveLength(0);
    expect(calls.toast).toEqual([]);
  });

  it("同文档连续两次变更：防抖合并为一次写入", async () => {
    data.knowledgePoints[0] = { ...data.knowledgePoints[0], content: "c2" };
    await scheduleKpRegionSync(1, 10, 100);
    data.knowledgePoints[0] = { ...data.knowledgePoints[0], content: "c3" };
    await scheduleKpRegionSync(1, 10, 100);
    await flush();
    expect(calls.update).toHaveLength(1);
    expect(calls.update[0].md).toContain("c3");
  });
});
```

（`beforeAll` 需从 vitest import；`saveData` 的 `dirty` 载荷形状以 `storage.ts` 的 `DataSavedPayload` 为准——mock 里简化为 `{ global: true, courseIds: [] }`，storage 测试同款。）

Run: `npx vitest run packages/core/src/api/__tests__/kpDocSync.test.ts` → 新段失败（函数不存在）

- [ ] **Step 2: 实现写回管道**

`kpDocSync.ts` 追加：

```ts
// ---------- 写回管道（应用 → 思源） ----------

export interface NodeDocTarget {
  docId: string | null;
  /** 补建/自愈重建用的文档路径 */
  path: string;
  parentID: string | null;
  /** 文档首行标题（# 名称） */
  titleLine: string;
  /** 展示名（toast 用） */
  label: string;
}

/** 节点区域目标文档：null = 课程顶层文档；章/节 = siyuanBlockId 文档；幽灵节点回退课程文档 */
export function nodeDocTarget(course: Course, chapters: Chapter[], node: number | null): NodeDocTarget {
  if (node === null) {
    return { docId: course.siyuanDocId, path: `/${course.name}`, parentID: null, titleLine: `# ${course.name}`, label: course.name };
  }
  const ch = chapters.find((c) => c.id === node);
  if (!ch) return nodeDocTarget(course, chapters, null);
  if (ch.level === "chapter" || ch.parentId === null) {
    return {
      docId: ch.siyuanBlockId,
      path: `/${course.name}/${ch.name}`,
      parentID: course.siyuanDocId,
      titleLine: `# ${ch.name}`,
      label: ch.name,
    };
  }
  const parent = ch.parentId !== null ? chapters.find((c) => c.id === ch.parentId) : null;
  return {
    docId: ch.siyuanBlockId,
    path: parent ? `/${course.name}/${parent.name}/${ch.name}` : `/${course.name}/${ch.name}`,
    parentID: parent?.siyuanBlockId ?? course.siyuanDocId,
    titleLine: `# ${ch.name}`,
    label: parent ? `${parent.name} · ${ch.name}` : ch.name,
  };
}

/** 写回管道是否可用（非思源宿主短路；persistToSiyuan 在执行段内按最新设置检查） */
export function kpRegionSyncEnabled(): boolean {
  return docsEnabled();
}

// 每文档防抖合并 + 串行队列（storage.ts saveChain / siyuanSync.ts convSyncChains 同款）：
// 同章连续多次操作只写一次；同文档串行避免并发读旧文→各自合并→后写覆盖先写
const kpSyncTimers = new Map<string, ReturnType<typeof setTimeout>>();
const kpSyncChains = new Map<string, Promise<unknown>>();

function nodeKeyOf(courseId: number, node: number | null): string {
  return `${courseId}:${node === null ? "course" : node}`;
}

/** 调度单节点区域写回（node=null → 课程文档）。fire-and-forget：失败仅 toast，不阻塞 */
export function scheduleKpRegionSync(courseId: number, node: number | null, delay = 500): void {
  if (!kpRegionSyncEnabled()) return;
  const key = nodeKeyOf(courseId, node);
  const prev = kpSyncTimers.get(key);
  if (prev) clearTimeout(prev);
  kpSyncTimers.set(
    key,
    setTimeout(() => {
      kpSyncTimers.delete(key);
      const run = (kpSyncChains.get(key) ?? Promise.resolve()).then(() => doNodeSync(courseId, node));
      kpSyncChains.set(key, run.catch(() => undefined));
    }, delay),
  );
}

async function doNodeSync(courseId: number, node: number | null): Promise<void> {
  try {
    const data = await getData();
    const settings = await getSettings();
    if (!settings.persistToSiyuan) return;
    const course = data.courses.find((c) => c.id === courseId);
    if (!course) return;
    const chapters = data.chapters.filter((c) => c.courseId === courseId);
    const target = nodeDocTarget(course, chapters, node);
    const kps = data.knowledgePoints.filter(
      (k) => k.courseId === courseId && effectiveNodeOf(k, chapters) === node,
    );
    const label = node === null ? `课程「${course.name}」` : `章节「${target.label}」`;
    const region = renderKpRegion(kps);
    // 渲染态哈希必须与「实际写入区的解析哈希」同源（renderKpRegion 内部按 sort 排序，
    // 直接对未排序 kps 算 canonicalRegion 会因顺序不同永不匹配 → 恒停写误报）
    const renderedHash = parseKpRegion(region).hash;
    const bridge = getBridge();

    let docId = target.docId;
    const assignDocId = (id: string): void => {
      if (node === null) course.siyuanDocId = id;
      else {
        const ch = chapters.find((c) => c.id === node);
        if (ch) ch.siyuanBlockId = id;
      }
    };
    const createFresh = async (): Promise<void> => {
      const notebook = await ensureFolder(settings.notebookName);
      const { id } = await createDoc(`${target.titleLine}\n\n${region}`, target.path, notebook, target.parentID);
      assignDocId(id);
      docId = id;
    };

    if (!docId) {
      await createFresh();
      if (!data.docRegions) data.docRegions = {};
      data.docRegions[docId] = { h: renderedHash, ids: kps.map((k) => k.id) };
      await saveData(data);
      bridge.showMessage(`思源文档曾缺失，已自动补建：${label}`, 3000);
      return;
    }

    const md = await bridge.getDocMarkdown(docId);
    if (md === null) {
      if (await bridge.docExists(docId)) {
        bridge.showMessage(`思源文档读取失败，本次写回跳过：${label}`, 4000, "error");
        return;
      }
      await createFresh();
      if (!data.docRegions) data.docRegions = {};
      data.docRegions[docId] = { h: renderedHash, ids: kps.map((k) => k.id) };
      await saveData(data);
      bridge.showMessage(`思源文档曾被删除，已自动重建：${label}`, 3000);
      return;
    }

    const parsed = parseKpRegion(md);
    const stored = data.docRegions?.[docId];
    const decision = decideRegionWrite({
      hasStored: stored !== undefined,
      storedHash: stored?.h ?? null,
      regionHash: parsed.hash,
      renderedHash,
    });
    if (decision.action === "stop") {
      const msg =
        decision.reason === "region-deleted"
          ? `思源「${label}」的知识点区已被删除，本次应用侧变更未写入思源。请先用「从思源同步」确认变更`
          : decision.reason === "state-missing"
            ? `思源「${label}」知识点区写入状态缺失，为避免覆盖你的编辑已跳过写回。请用「从思源同步」恢复`
            : `思源「${label}」有未同步编辑，本次应用侧变更未写入思源。请先点「从思源同步」合并`;
      bridge.showMessage(msg, 5000, "error");
      return;
    }
    if (decision.action === "skip") return;

    await bridge.updateDoc(docId, mergeKpRegion(md, region));
    if (!data.docRegions) data.docRegions = {};
    data.docRegions[docId] = { h: renderedHash, ids: kps.map((k) => k.id) };
    await saveData(data);
  } catch (e) {
    console.error("知识点区写回失败:", e);
    getBridge().showMessage(`思源知识点区写回失败：${e instanceof Error ? e.message : "未知错误"}`, 4000, "error");
  }
}
```

import 需补：`createDoc, docsEnabled, ensureFolder`（docStore）、`getData, saveData`（storage）、`getSettings`（settings）、`getBridge`（@/bridge）、`Course` 类型。

- [ ] **Step 3: 验证**

Run: `npx vitest run packages/core/src/api/__tests__/kpDocSync.test.ts` → 全绿（纯函数段 + 管道段）
Run: `npx vue-tsc --noEmit -p packages/core/tsconfig.json && npx vue-tsc --noEmit -p packages/siyuan/tsconfig.json` → 无错
Run: `npx vitest run` → 全量不回归

- [ ] **Step 4: 提交**

```bash
git add -A && git commit -m "feat: 知识点区写回管道（防抖+串行队列+停写检测+补建/自愈重建）"
```

---

### Task 6: 读回 API（`readSiyuanKpSync` / `applySiyuanKpSync`）+ barrel 导出

**Files:**
- Modify: `packages/core/src/api/kpDocSync.ts`（追加）
- Modify: `packages/core/src/api/index.ts`（加 `export * from "./kpDocSync";`）
- Test: `packages/core/src/api/__tests__/kpDocSync.test.ts`（追加 api 段）

**Interfaces:**
- Produces:
  - `SiyuanReadCtxNode = { node: number | null; docId: string | null; hadRegion: boolean; regionHash: string; markedIds: number[]; storedExisted: boolean; storedIds: number[] }`
  - `SiyuanReadCtx = { course: Course; chapters: Chapter[]; nodes: SiyuanReadCtxNode[] }`
  - `SiyuanKpSyncPreview = { tree: ParsedKpTree; diff: KpTreeDiff; deletedDocs: number; historicalDocs: number; retained: number; readCtx: SiyuanReadCtx }`
  - `readSiyuanKpSync(courseId: number): Promise<SiyuanKpSyncPreview>`（读全部文档 → 组树 → diff，不落盘）
  - `applySiyuanKpSync(courseId: number, preview: SiyuanKpSyncPreview): Promise<void>`（确认后落数据 + 状态刷新/合并写回）

**`applySiyuanKpSync` 状态刷新规则（确认制，spec §3 细化 2/3）：**
- 计算 `changedNodes`：updated 的旧+新节点、removed 的旧节点、added 的目标节点、以及**存在保留待写 KP 的有区节点**（从 readCtx 重算：节点应用 KP 中 `id ∉ 存储 ids 并集` 且读时区有标记/无该 KP）
- 对每个 changedNode 的文档：
  - 读时**无区 + 有存储态**（用户删了整个区、确认了全删）→ **删除 `docRegions[docId]` 条目**（此后按历史文档，避免停写死循环）
  - 读时无区/文档缺失 → 不动状态
  - 读时有区 且 持久化开启 → 重取最新文档 markdown；若区哈希与读时不同（期间又有新编辑）→ 跳过该文档（保留读时状态，下次写回自然停写提示）；否则 `updateDoc(mergeKpRegion(最新md, 当前渲染区))` + `docRegions[docId] = { h: 渲染哈希, ids }`
- `saveData`；写回失败的文档聚合 toast「数据已保存，以下区写回失败：…」

- [ ] **Step 1: 写失败测试**

`kpDocSync.test.ts` 追加（复用 Task 5 的 bridge mock 设施——把 Task 5 的 `setup()`/`calls` 抽成文件级共享，或本段自建独立 describe；以代码可编译为准）：

```ts
describe("读回管道（bridge mock）", () => {
  // mock 设施同 Task 5（setBridge + docs Map + calls），此处省略重复代码，
  // 实现时直接复用 Task 5 describe 外的共享 setup（把 setup/calls/data 提升到文件级）

  it("readSiyuanKpSync：读全部文档 → diff + 计数 + readCtx", async () => {
    setup();
    const { readSiyuanKpSync } = await import("../kpDocSync");
    const preview = await readSiyuanKpSync(1);
    expect(preview.tree.courseId).toBe(1);
    expect(preview.tree.chapters.map((c) => c.id).sort()).toEqual([10]); // 现有章节全部带标记
    expect(preview.readCtx.nodes).toHaveLength(2); // 章A + 课程文档
    expect(preview.diff.removed).toEqual([]);
  });

  it("applySiyuanKpSync：区内改动落数据（掌握度不变）+ 刷新存储态", async () => {
    setup();
    const kpDocSync = await import("../kpDocSync");
    const region = kpDocSync.renderKpRegion([
      { ...data.knowledgePoints[0], name: "KP1改", content: "c改" },
    ]);
    docs.set("docA", `# 章A\n\n${region}`);
    const preview = await kpDocSync.readSiyuanKpSync(1);
    expect(preview.diff.updated).toHaveLength(1);
    await kpDocSync.applySiyuanKpSync(1, preview);
    expect(data.knowledgePoints[0].name).toBe("KP1改");
    expect(data.knowledgePoints[0].content).toBe("c改");
    expect(data.knowledgePoints[0].mastery).toBe("unlearn"); // 学习状态不动
    expect(data.docRegions?.docA).toBeDefined();
    expect(data.docRegions?.docA!.ids).toEqual([1]);
  });

  it("applySiyuanKpSync：用户删了整个区（无区有状态）→ 确认后删 KP + 删 docRegions 条目", async () => {
    setup();
    data.docRegions = { docA: { h: "x", ids: [1] } };
    docs.set("docA", "# 章A\n\n区被删了");
    const kpDocSync = await import("../kpDocSync");
    const preview = await kpDocSync.readSiyuanKpSync(1);
    expect(preview.diff.removed).toHaveLength(1);
    await kpDocSync.applySiyuanKpSync(1, preview);
    expect(data.knowledgePoints).toHaveLength(0);
    expect(data.docRegions?.docA).toBeUndefined(); // 删除状态条目（不再停写死循环）
  });

  it("applySiyuanKpSync：保留待写 KP → 合并回区写回 + 状态刷新", async () => {
    setup();
    // 区里只有「KP1」的旧写入态；应用又新增了 KP2（待写，∉ 存储 ids）
    const rendered = (await import("../kpDocSync")).renderKpRegion([data.knowledgePoints[0]]);
    docs.set("docA", `# 章A\n\n${rendered}`);
    data.docRegions = { docA: { h: "old", ids: [1] } };
    data.knowledgePoints.push({ ...data.knowledgePoints[0], id: 2, name: "KP2", content: "", chapterName: "章A", sort: 2 });
    const kpDocSync = await import("../kpDocSync");
    const preview = await kpDocSync.readSiyuanKpSync(1);
    expect(preview.retained).toBe(1);
    expect(preview.diff.removed).toEqual([]);
    await kpDocSync.applySiyuanKpSync(1, preview);
    const mdA = docs.get("docA")!;
    expect(mdA).toContain("<!-- kp:2 -->"); // 待写 KP 已合并回区
    expect(data.docRegions?.docA!.ids.sort()).toEqual([1, 2]);
  });

  it("applySiyuanKpSync：区在期间又被改 → 跳过该文档写回，不覆盖新编辑", async () => {
    setup();
    const kpDocSync = await import("../kpDocSync");
    // 读回时：用户已把内容从「c」改成「内容a」（产生 updated diff）
    docs.set("docA", kpDocSync.renderKpRegion([{ ...data.knowledgePoints[0], content: "内容a" }]));
    data.docRegions = { docA: { h: kpDocSync.parseKpRegion(docs.get("docA")!).hash, ids: [1] } };
    const preview = await kpDocSync.readSiyuanKpSync(1);
    expect(preview.diff.updated).toHaveLength(1);
    // 读回后、确认前，用户又改成「内容b」
    docs.set("docA", docs.get("docA")!.replace("内容a", "内容b"));
    await kpDocSync.applySiyuanKpSync(1, preview);
    expect(data.knowledgePoints[0].content).toBe("内容a"); // 读回态落盘
    expect(docs.get("docA")!).toContain("内容b"); // 期间新编辑未被覆盖
  });
});
```

（断言按实现细节微调，语义必须覆盖：落数据不改掌握度、删区确认删状态、待写 KP 合并回区、期间新编辑不被覆盖。）

Run: `npx vitest run packages/core/src/api/__tests__/kpDocSync.test.ts` → 新段失败

- [ ] **Step 2: 实现读回 API**

`kpDocSync.ts` 追加：

```ts
// ---------- 读回管道（思源 → 应用） ----------

export interface SiyuanReadCtxNode {
  node: number | null;
  docId: string | null;
  hadRegion: boolean;
  /** 读时区规范哈希（"" = 无区） */
  regionHash: string;
  /** 读时区带标记条目 id */
  markedIds: number[];
  storedExisted: boolean;
  /** 存储态的 ids（读时快照） */
  storedIds: number[];
}

export interface SiyuanReadCtx {
  course: Course;
  chapters: Chapter[];
  nodes: SiyuanReadCtxNode[];
}

export interface SiyuanKpSyncPreview {
  tree: ParsedKpTree;
  diff: KpTreeDiff;
  deletedDocs: number;
  historicalDocs: number;
  retained: number;
  readCtx: SiyuanReadCtx;
}

/** 读回：读本课程全部文档（课程文档 + 章/节文档）→ 组树 → 计算 diff（不落盘） */
export async function readSiyuanKpSync(courseId: number): Promise<SiyuanKpSyncPreview> {
  const data = await getData();
  const course = data.courses.find((c) => c.id === courseId);
  if (!course) throw new Error("课程不存在，请刷新后重试");
  const chapters = data.chapters.filter((c) => c.courseId === courseId);
  const kps = data.knowledgePoints.filter((k) => k.courseId === courseId);
  const docRegions = data.docRegions ?? {};
  const bridge = getBridge();

  const docTargets: Array<{ node: number | null; docId: string | null }> = [
    ...[...chapters].sort((a, b) => a.sort - b.sort).map((c) => ({ node: c.id as number | null, docId: c.siyuanBlockId })),
    { node: null, docId: course.siyuanDocId },
  ];
  const docs = new Map<string, string | null>();
  for (const t of docTargets) {
    if (t.docId === null || docs.has(t.docId)) continue;
    const md = await bridge.getDocMarkdown(t.docId).catch(() => null);
    docs.set(t.docId, md);
  }

  const built = buildSiyuanParsedTree({ course, chapters, kps, docRegions, docs });
  const diff = computeKpTreeDiff(built.tree, chapters, kps);
  const readCtx: SiyuanReadCtx = {
    course,
    chapters,
    nodes: docTargets.map((t) => {
      const md = t.docId === null ? null : docs.get(t.docId) ?? null;
      const region = t.docId !== null && md !== null ? parseKpRegion(md) : { hasRegion: false, kps: [], hash: "" };
      const stored = t.docId !== null ? docRegions[t.docId] : undefined;
      return {
        node: t.node,
        docId: t.docId,
        hadRegion: region.hasRegion,
        regionHash: region.hash,
        markedIds: region.kps.filter((k) => k.id !== null).map((k) => k.id!),
        storedExisted: stored !== undefined,
        storedIds: stored?.ids ?? [],
      };
    }),
  };
  return {
    tree: built.tree,
    diff,
    deletedDocs: built.deletedDocs,
    historicalDocs: built.historicalDocs,
    retained: built.retained,
    readCtx,
  };
}

/** 确认读回：应用变更落盘 + 刷新/合并各区写入状态 */
export async function applySiyuanKpSync(courseId: number, preview: SiyuanKpSyncPreview): Promise<void> {
  const data = await getData();
  const nextData = applyKpTreeDiff(data, courseId, preview.tree, preview.diff);
  if (!nextData.docRegions) nextData.docRegions = {};

  const oldChapters = data.chapters.filter((c) => c.courseId === courseId);
  const chapters = nextData.chapters.filter((c) => c.courseId === courseId);
  const kpsNow = nextData.knowledgePoints.filter((k) => k.courseId === courseId);

  // 产生 diff 的节点集合（含保留待写 KP 的节点）
  const changedNodes = new Set<string>();
  const mark = (node: number | null): void => changedNodes.add(node === null ? "course" : String(node));
  for (const u of preview.diff.updated) {
    const oldKp = data.knowledgePoints.find((k) => k.id === u.id);
    if (oldKp) mark(effectiveNodeOf(oldKp, oldChapters));
    const newKp = nextData.knowledgePoints.find((k) => k.id === u.id);
    if (newKp) mark(effectiveNodeOf(newKp, chapters));
  }
  for (const r of preview.diff.removed) {
    const oldKp = data.knowledgePoints.find((k) => k.id === r.id);
    if (oldKp) mark(effectiveNodeOf(oldKp, oldChapters));
  }
  for (const a of preview.diff.added) {
    mark(a.chapterKey === null ? null : Number(a.chapterKey.slice(3)));
  }
  // 存在保留待写 KP 的有区节点（这些 KP 没产生 diff，但需合并回区写回）
  const unionStored = new Set(preview.readCtx.nodes.flatMap((n) => n.storedIds));
  const oldKpById = new Map(data.knowledgePoints.map((k) => [k.id, k]));
  for (const n of preview.readCtx.nodes) {
    if (!n.hadRegion || n.docId === null) continue;
    const hasRetained = [...oldKpById.values()].some(
      (k) =>
        k.courseId === courseId &&
        effectiveNodeOf(k, oldChapters) === n.node &&
        !n.markedIds.includes(k.id) &&
        !unionStored.has(k.id),
    );
    if (hasRetained) mark(n.node);
  }

  const settings = await getSettings();
  const canWrite = settings.persistToSiyuan && docsEnabled();
  const bridge = getBridge();
  const writeErrors: string[] = [];

  for (const n of preview.readCtx.nodes) {
    if (!changedNodes.has(n.node === null ? "course" : String(n.node))) continue;
    if (n.docId === null) continue;
    const label = nodeDocTarget(preview.readCtx.course, preview.readCtx.chapters, n.node).label;
    if (!n.hadRegion && n.storedExisted) {
      // 用户删了整个区并确认全章删除 → 删除状态条目（此后按历史文档处理，避免停写死循环）
      delete nextData.docRegions![n.docId];
      continue;
    }
    if (!n.hadRegion || !canWrite) continue;

    // 用应用当前渲染重写该节点区（合并写回：用户编辑/新增/保留待写 KP 一次性落定）
    const nodeKps = kpsNow.filter((k) => effectiveNodeOf(k, chapters) === n.node);
    const region = renderKpRegion(nodeKps);
    const freshMd = await bridge.getDocMarkdown(n.docId).catch(() => null);
    if (freshMd === null) continue; // 期间文档被删：跳过写回，下次写回自愈重建
    const freshRegion = parseKpRegion(freshMd);
    if (freshRegion.hasRegion && freshRegion.hash !== n.regionHash) {
      continue; // 期间区又有新编辑：不覆盖，保留读时状态（下次写回停写提示）
    }
    try {
      await bridge.updateDoc(n.docId, mergeKpRegion(freshMd, region));
      // 与写回管道同口径：用渲染区解析哈希（renderKpRegion 内部按 sort 排序）
      nextData.docRegions![n.docId] = { h: parseKpRegion(region).hash, ids: nodeKps.map((k) => k.id) };
    } catch (e) {
      console.error("知识点区合并写回失败:", e);
      writeErrors.push(label);
    }
  }

  await saveData(nextData);
  if (writeErrors.length) {
    bridge.showMessage(
      `思源同步数据已保存，但以下知识点区写回失败：${writeErrors.join("、")}`,
      5000,
      "error",
    );
  }
}
```

- [ ] **Step 3: barrel 导出**

`packages/core/src/api/index.ts`——`export * from "./kpTreeImport";` 之后加：

```ts
export * from "./kpDocSync";
```

（若与既有导出撞名，以 vue-tsc 报错为准调整；预期无撞名。）

- [ ] **Step 4: 验证**

Run: `npx vitest run packages/core/src/api/__tests__/kpDocSync.test.ts` → 全绿
Run: `npx vue-tsc --noEmit -p packages/core/tsconfig.json && npx vue-tsc --noEmit -p packages/siyuan/tsconfig.json` → 无错
Run: `npx vitest run` → 全量不回归

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat: 从思源同步读回管道（readSiyuanKpSync/applySiyuanKpSync）+ barrel 导出"
```

---

### Task 7: md 导入接线（`syncChapterStructure` + `confirmKpTreeImport`）

**Files:**
- Modify: `packages/core/src/api/kpDocSync.ts`（追加 `syncChapterStructure`）
- Modify: `packages/core/src/api/kpTreeImport.ts`（`confirmKpTreeImport` 落盘后接同步）
- Test: `packages/core/src/api/__tests__/kpDocSync.test.ts`（追加 syncChapterStructure 用例）

**Interfaces:**
- Produces: `syncChapterStructure(courseId: number, diff: KpTreeDiff, addedChapters: Chapter[]): Promise<void>`
  - `addedChapters`：本次导入新建的章节（文件序，顶章在前 → unit 的 parentID 可解析）
  - 流程：① `chaptersRemoved` → `removeDocIfExists` 级联 + 删 `docRegions[docId]` 条目；② `course.siyuanDocId` 为 null → 惰性补建课程顶层文档；③ `addedChapters` 逐个 `createDoc`（章挂课程文档、节挂父章文档，path 含名称，parentID 消歧）+ 回填 `siyuanBlockId`；④ `chaptersUpdated` 改名 → `renameDoc`、`parentKey` 变更 → `moveDoc`（目标父文档 id：`null`=课程文档、`id:X`=既有章、`new:X`=addedChapters 按 diff 序取）；⑤ `saveData` + 聚合失败 toast（不抛）
  - 前置短路：`!kpRegionSyncEnabled() || !settings.persistToSiyuan` 直接返回
- `confirmKpTreeImport` 扩展：落盘前记录受影响节点（updated/removed 的**旧**节点），落盘后补记（updated 的新节点、新增 KP 的节点、新建章节 id），调 `syncChapterStructure`（有章节变更时），最后对全部受影响节点 `void scheduleKpRegionSync`

- [ ] **Step 1: 写失败测试**

```ts
describe("syncChapterStructure（bridge mock）", () => {
  it("新建章（章+节）→ createDoc 挂对父 + 回填 siyuanBlockId；删章 → removeDoc + 清 docRegions", async () => {
    setup();
    data.docRegions = { docDel: { h: "x", ids: [] } };
    data.chapters.push({ id: 90, courseId: 1, parentId: null, siyuanBlockId: "docDel", name: "待删章", level: "chapter", sort: 5 });
    const addedTop: Chapter = { id: 20, courseId: 1, parentId: null, siyuanBlockId: null, name: "新章", level: "chapter", sort: 2 };
    const addedUnit: Chapter = { id: 21, courseId: 1, parentId: 20, siyuanBlockId: null, name: "新节", level: "unit", sort: 1 };
    const { syncChapterStructure } = await import("../kpDocSync");
    const diff = {
      updated: [], added: [], removed: [], unchangedKps: 0,
      chaptersUpdated: [],
      chaptersAdded: [
        { key: "new:0", name: "新章", level: "chapter", parentKey: null, sort: 2 },
        { key: "new:1", name: "新节", level: "unit", parentKey: "new:0", sort: 1 },
      ],
      chaptersRemoved: [{ id: 90, name: "待删章" }],
    };
    await syncChapterStructure(1, diff, [addedTop, addedUnit]);
    expect(calls.create).toHaveLength(2);
    expect(calls.create[0].path).toBe("/测试课程/新章");
    expect(calls.create[0].parent).toBe("doc-course");
    expect(calls.create[1].path).toBe("/测试课程/新章/新节");
    expect(calls.create[1].parent).toBe(addedTop.siyuanBlockId); // 新章刚回填的 docId
    expect(addedTop.siyuanBlockId).toBe("doc-new-0");
    expect(addedUnit.siyuanBlockId).toBe("doc-new-1");
    expect(docs.has("docDel")).toBe(false);
    expect(data.docRegions?.docDel).toBeUndefined();
  });

  it("课程顶层文档为 null：先补建课程文档再挂章", async () => {
    setup();
    data.courses[0].siyuanDocId = null;
    const addedTop: Chapter = { id: 20, courseId: 1, parentId: null, siyuanBlockId: null, name: "新章", level: "chapter", sort: 1 };
    const { syncChapterStructure } = await import("../kpDocSync");
    await syncChapterStructure(1, {
      updated: [], added: [], removed: [], unchangedKps: 0,
      chaptersUpdated: [],
      chaptersAdded: [{ key: "new:0", name: "新章", level: "chapter", parentKey: null, sort: 1 }],
      chaptersRemoved: [],
    }, [addedTop]);
    expect(calls.create.length).toBe(2); // 课程文档 + 章
    expect(calls.create[0].path).toBe("/测试课程");
    expect(data.courses[0].siyuanDocId).toBe("doc-new-0");
    expect(calls.create[1].parent).toBe("doc-new-0");
  });
});
```

（`calls.create` 的 `parent` 断言按实际 createDoc mock 记录修正。）

Run: `npx vitest run packages/core/src/api/__tests__/kpDocSync.test.ts` → 新段失败

- [ ] **Step 2: 实现 syncChapterStructure**

`kpDocSync.ts` 追加：

```ts
// ---------- md 导入的章文档操作 ----------

/**
 * md 导入确认后同步思源章文档：删（removeDoc 级联 + 清 docRegions）→ 补建课程文档 →
 * 新建（createDoc + 回填 siyuanBlockId）→ 改名/换父（renameDoc/moveDoc）。
 * fire-and-forget 语义的「聚合版」：await 完成 + 聚合 toast，不抛异常。
 */
export async function syncChapterStructure(courseId: number, diff: KpTreeDiff, addedChapters: Chapter[]): Promise<void> {
  if (!kpRegionSyncEnabled()) return;
  const data = await getData();
  const settings = await getSettings();
  if (!settings.persistToSiyuan) return;
  const course = data.courses.find((c) => c.id === courseId);
  if (!course) return;
  const errors: string[] = [];
  const bridge = getBridge();
  const notebook = await ensureFolder(settings.notebookName).catch((e: unknown) => {
    console.error("笔记本初始化失败:", e);
    return null;
  });
  if (!notebook) return;

  // 1. 删除（级联幂等）+ 清 docRegions 状态
  for (const r of diff.chaptersRemoved) {
    const ch = data.chapters.find((c) => c.id === r.id);
    if (ch?.siyuanBlockId) {
      await removeDocIfExists(ch.siyuanBlockId).catch((e) => {
        console.error("删除思源章节文档失败:", e);
        errors.push(`章节「${ch.name}」文档删除失败`);
      });
      if (data.docRegions) delete data.docRegions[ch.siyuanBlockId];
    }
  }

  // 2. 惰性补建课程顶层文档（课程包导入/开持久化前创建的课程）
  if (!course.siyuanDocId) {
    try {
      const { id } = await createDoc(`# ${course.name}`, `/${course.name}`, notebook, null);
      course.siyuanDocId = id;
    } catch (e) {
      console.error("创建课程顶层文档失败:", e);
      errors.push(`课程「${course.name}」顶层文档创建失败`);
    }
  }

  // 3. 新建章节（文件序：顶章先于节 → 节的 parentID 可解析）
  for (const ch of addedChapters) {
    const parent = ch.parentId !== null ? data.chapters.find((c) => c.id === ch.parentId) : null;
    const path = parent ? `/${course.name}/${parent.name}/${ch.name}` : `/${course.name}/${ch.name}`;
    const parentID = parent?.siyuanBlockId ?? course.siyuanDocId;
    try {
      const { id } = await createDoc(`# ${ch.name}`, path, notebook, parentID);
      ch.siyuanBlockId = id;
    } catch (e) {
      console.error("创建思源章节文档失败:", e);
      errors.push(`章节「${ch.name}」文档创建失败`);
    }
  }

  // 4. 改名 / 换父
  for (const u of diff.chaptersUpdated) {
    const ch = data.chapters.find((c) => c.id === u.id);
    if (!ch?.siyuanBlockId) continue;
    if (u.name !== undefined && u.name !== ch.name) {
      await bridge.renameDoc(ch.siyuanBlockId, u.name).catch((e) => {
        console.error("同步章节改名失败:", e);
        errors.push(`章节「${u.name}」改名失败`);
      });
    }
    if (u.parentKey !== undefined) {
      let targetDocId: string | null = null;
      if (u.parentKey === null) targetDocId = course.siyuanDocId;
      else if (u.parentKey.startsWith("id:")) {
        targetDocId = data.chapters.find((c) => c.id === Number(u.parentKey.slice(3)))?.siyuanBlockId ?? null;
      } else {
        const i = diff.chaptersAdded.findIndex((a) => a.key === u.parentKey);
        targetDocId = addedChapters[i]?.siyuanBlockId ?? null;
      }
      if (targetDocId && targetDocId !== ch.siyuanBlockId) {
        await bridge.moveDoc(ch.siyuanBlockId, targetDocId).catch((e) => {
          console.error("同步章节移动失败:", e);
          errors.push(`章节「${ch.name}」移动失败`);
        });
      }
    }
  }

  await saveData(data);
  if (errors.length) {
    bridge.showMessage(`知识点树导入成功，但思源文档树未完全同步：${errors.join("；")}`, 5000, "error");
  }
}
```

- [ ] **Step 3: 改造 confirmKpTreeImport**

`packages/core/src/api/kpTreeImport.ts` 整体替换为：

```ts
import { getData, saveData } from "./storage";
import {
  applyKpTreeDiff,
  computeKpTreeDiff,
  effectiveNodeOf,
  parseKpTreeMarkdown,
  type KpTreeDiff,
  type ParsedKpTree,
} from "../utils/kpTreeImport";
import { scheduleKpRegionSync, syncChapterStructure } from "./kpDocSync";

export interface KpTreeImportPreview {
  tree: ParsedKpTree;
  diff: KpTreeDiff;
  /** false = 说明头与一级标题均缺失、课程身份无法校验，UI 需警示用户 */
  courseVerified: boolean;
  fileName: string;
}

/** 解析并校验导入文件，计算变更清单（不落盘） */
export async function previewKpTreeImport(file: File, courseId: number): Promise<KpTreeImportPreview> {
  const text = await file.text();
  const res = parseKpTreeMarkdown(text);
  if (!res.ok) throw new Error(`解析失败（第 ${res.line} 行）：${res.error}`);
  const tree = res.tree;
  if (!tree.importable) {
    throw new Error("该文件是「仅导出未掌握知识点」的过滤导出，不可用于导入。请取消过滤重新导出完整知识点树后再导入。");
  }

  const data = await getData();
  const course = data.courses.find((c) => c.id === courseId);
  if (!course) throw new Error("课程不存在，请刷新后重试");

  // 课程身份校验：优先说明头 course:ID；说明头被删时按一级标题课程名兜底
  if (tree.courseId !== null) {
    if (tree.courseId !== courseId) {
      const other = data.courses.find((c) => c.id === tree.courseId);
      throw new Error(`课程不匹配：文件属于「${other?.name ?? `课程 ${tree.courseId}`}」，当前为「${course.name}」`);
    }
  } else if (tree.courseName && !tree.courseName.includes(course.name) && !course.name.includes(tree.courseName)) {
    throw new Error(`课程不匹配：文件标题为「${tree.courseName}」，当前课程为「${course.name}」`);
  }

  const chapters = data.chapters.filter((c) => c.courseId === courseId);
  const kps = data.knowledgePoints.filter((k) => k.courseId === courseId);
  const diff = computeKpTreeDiff(tree, chapters, kps);
  return { tree, diff, courseVerified: tree.courseId !== null || tree.courseName !== null, fileName: file.name };
}

/** 确认导入：应用变更并落盘；思源端顺带同步章文档（建/删/改名/移动）与知识点区 */
export async function confirmKpTreeImport(courseId: number, preview: KpTreeImportPreview): Promise<void> {
  const data = await getData();
  const chapters = data.chapters.filter((c) => c.courseId === courseId);
  const oldMaxKp = data.knowledgePoints.reduce((m, k) => Math.max(m, k.id), 0);
  const oldMaxCh = data.chapters.reduce((m, c) => Math.max(m, c.id), 0);
  const affected = new Set<string>();
  const mark = (node: number | null): void => affected.add(node === null ? "course" : String(node));
  // 旧节点（落盘前口径）
  for (const u of preview.diff.updated) {
    const k = data.knowledgePoints.find((x) => x.id === u.id);
    if (k) mark(effectiveNodeOf(k, chapters));
  }
  for (const r of preview.diff.removed) {
    const k = data.knowledgePoints.find((x) => x.id === r.id);
    if (k) mark(effectiveNodeOf(k, chapters));
  }

  const nextData = applyKpTreeDiff(data, courseId, preview.tree, preview.diff);
  await saveData(nextData);

  // 新节点（落盘后口径）：updated 新归属 + 新增 KP + 新建章节
  const newChapters = nextData.chapters.filter((c) => c.courseId === courseId);
  const addedChapters = nextData.chapters.filter((c) => c.courseId === courseId && c.id > oldMaxCh);
  for (const u of preview.diff.updated) {
    const k = nextData.knowledgePoints.find((x) => x.id === u.id);
    if (k) mark(effectiveNodeOf(k, newChapters));
  }
  for (const k of nextData.knowledgePoints) {
    if (k.courseId === courseId && k.id > oldMaxKp) mark(effectiveNodeOf(k, newChapters));
  }
  for (const c of addedChapters) mark(c.id);

  // 章节结构变更 → 思源章文档操作（await，聚合提示）；再调度知识点区写回
  if (
    addedChapters.length > 0 ||
    preview.diff.chaptersRemoved.length > 0 ||
    preview.diff.chaptersUpdated.length > 0
  ) {
    await syncChapterStructure(courseId, preview.diff, addedChapters);
  }
  for (const key of affected) {
    void scheduleKpRegionSync(courseId, key === "course" ? null : Number(key));
  }
}
```

- [ ] **Step 4: 验证**

Run: `npx vitest run packages/core/src/api/__tests__/kpDocSync.test.ts` → 全绿
Run: `npx vitest run packages/core/src/api/__tests__/` → 既有 api 测试不回归（`previewKpTreeImport` 行为不变）
Run: `npx vue-tsc --noEmit -p packages/core/tsconfig.json && npx vue-tsc --noEmit -p packages/siyuan/tsconfig.json` → 无错

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat: md 导入确认后同步思源章文档与知识点区"
```

---

### Task 8: `kp.ts` 触发点（KP 增/改/移/删/排序、新章、relink、删章清理）

**Files:**
- Modify: `packages/core/src/api/kp.ts`

**Interfaces:**
- `RelinkResult` 加 `linkedIds: number[]`（被成功绑定的 KP id，供调度旧/新节点写回）
- 触发点一览（全部 `void scheduleKpRegionSync(...)`，fire-and-forget）：

| 函数 | 调度节点 |
|---|---|
| `updateKnowledgePoint` | 旧 KP 与新 KP 的 `effectiveNodeOf`（去重） |
| `deleteKnowledgePoints` | 每个被删 KP 的原节点 |
| `applyKnowledgePointSort` | 受影响 KP 的节点（按 courseId 分组） |
| `createChapter` | 新章 id（写空区 / 补建） |
| `importChapterTree` | 新建章 id + relink 的 KP 旧节点(null)与新节点 |
| `relinkUnassignedKps` | 同上（linkedIds>0 时） |
| `deleteChapters` | 孤儿 KP 所属课程的 `null`（课程文档）+ 删 `docRegions[docId]` 条目 |

- [ ] **Step 1: 加 import 与 RelinkResult.linkedIds**

`kp.ts` 顶部 import 追加：

```ts
import { effectiveNodeOf } from "../utils/kpTreeImport";
import { scheduleKpRegionSync } from "./kpDocSync";
```

`RelinkResult`：

```ts
export interface RelinkResult {
  linked: number;
  /** 标题与名称都匹配不上、无法自动挂钩的数量（含无标题信息的知识点） */
  stuck: number;
  /** 被成功绑定的知识点 id（供落库后调度旧/新节点文档写回） */
  linkedIds: number[];
}
```

`relinkCourseKps` 内：`linkedIds: number[] = []`，绑定成功处 `linkedIds.push(kp.id)`，返回 `{ linked, stuck, linkedIds }`。

- [ ] **Step 2: 各触发点**

`updateKnowledgePoint`：

```ts
export async function updateKnowledgePoint(kp: KnowledgePoint): Promise<void> {
  const data = await getData();
  const idx = data.knowledgePoints.findIndex((k) => k.id === kp.id);
  if (idx >= 0) {
    const old = data.knowledgePoints[idx];
    data.knowledgePoints[idx] = kp;
    await saveData(data);
    // 思源知识点区写回：换章时新旧两节点都需刷新
    const nodes = new Set([effectiveNodeOf(old, data.chapters), effectiveNodeOf(kp, data.chapters)]);
    for (const n of nodes) void scheduleKpRegionSync(kp.courseId, n);
  }
}
```

`deleteKnowledgePoints`：`data.knowledgePoints = ...filter...` 之前先 `const removedKps = data.knowledgePoints.filter((k) => removed.has(k.id));`，`await saveData(data);` 之后：

```ts
  for (const kp of removedKps) {
    void scheduleKpRegionSync(kp.courseId, effectiveNodeOf(kp, data.chapters));
  }
```

`applyKnowledgePointSort`：

```ts
export async function applyKnowledgePointSort(items: Array<{ id: number; sort: number }>): Promise<void> {
  const data = await getData();
  const map = new Map(items.map((it) => [it.id, it.sort]));
  const byCourse = new Map<number, Set<number | null>>();
  for (const kp of data.knowledgePoints) {
    const s = map.get(kp.id);
    if (s === undefined) continue;
    kp.sort = s;
    if (!byCourse.has(kp.courseId)) byCourse.set(kp.courseId, new Set());
    byCourse.get(kp.courseId)!.add(effectiveNodeOf(kp, data.chapters));
  }
  await saveData(data);
  for (const [courseId, nodes] of byCourse) {
    for (const n of nodes) void scheduleKpRegionSync(courseId, n);
  }
}
```

`createChapter`：`await saveData(data);` 之后、`return chapter;` 之前：

```ts
  // 思源知识点区写回：新章文档写入空区（siyuanBlockId 为 null 时顺带补建）
  void scheduleKpRegionSync(input.courseId, chapter.id);
```

`importChapterTree`：循环内新建章时收集 `const createdChapters: Chapter[] = [];` 并 `createdChapters.push(chapter);`；`await saveData(data);` 之后、`return` 之前：

```ts
  // 思源知识点区写回：新建章文档写空区 + 被重新绑定的 KP 的旧/新节点
  for (const ch of createdChapters) void scheduleKpRegionSync(courseId, ch.id);
  for (const id of relink.linkedIds) {
    void scheduleKpRegionSync(courseId, null); // 原未归章 → 课程文档
    const kp = data.knowledgePoints.find((k) => k.id === id);
    if (kp) void scheduleKpRegionSync(courseId, effectiveNodeOf(kp, data.chapters));
  }
```

`relinkUnassignedKps`：

```ts
export async function relinkUnassignedKps(courseId: number): Promise<RelinkResult> {
  const data = await getData();
  const result = relinkCourseKps(data, courseId);
  if (result.linked > 0) {
    await saveData(data);
    for (const id of result.linkedIds) {
      void scheduleKpRegionSync(courseId, null);
      const kp = data.knowledgePoints.find((k) => k.id === id);
      if (kp) void scheduleKpRegionSync(courseId, effectiveNodeOf(kp, data.chapters));
    }
  }
  return result;
}
```

`deleteChapters`：
1. 级联文档删除循环内（`removeDocIfExists` 处）追加：

```ts
    if (c.siyuanBlockId && data.docRegions) {
      delete data.docRegions[c.siyuanBlockId];
    }
```

2. 文档删除循环之前捕获孤儿课程：

```ts
  // 归属被删章节的 KP 将变为未归章 → 其课程顶层文档需要写回
  const orphanedCourses = new Set<number>();
  for (const kp of data.knowledgePoints) {
    if (kp.chapterId !== null && removed.has(kp.chapterId)) orphanedCourses.add(kp.courseId);
  }
```

3. `await saveData(data);` 之后：

```ts
  for (const cid of orphanedCourses) void scheduleKpRegionSync(cid, null);
```

- [ ] **Step 3: 验证**

Run: `npx vitest run` → 全量不回归（`chapterTree.test.ts`、`planPause.test.ts` 等涉及 relink/sort 的既有测试保持绿；`linkedIds` 为新增字段，旧测试断言 `linked`/`stuck` 不受影响）
Run: `npx vue-tsc --noEmit -p packages/core/tsconfig.json && npx vue-tsc --noEmit -p packages/siyuan/tsconfig.json` → 无错

- [ ] **Step 4: 提交**

```bash
git add -A && git commit -m "feat: kp.ts 各操作挂思源知识点区写回触发点（RelinkResult 增 linkedIds）"
```

---

### Task 9: `extract.ts` + `sampleCourse.ts` 触发点

**Files:**
- Modify: `packages/core/src/api/extract.ts`
- Modify: `packages/core/src/api/sampleCourse.ts`

**Interfaces:** 无新接口；仅挂 `scheduleKpRegionSync`

- [ ] **Step 1: extract.ts 批量抽取完成后调度**

`extractKnowledgePointsInner` 内：
- `let newCount = 0;` 旁加：`const newKpNodes = new Map<number, number | null>(); // 新 KP id → 归属节点（落盘后区域写回）`
- 新建 KP 分支 `newCount++;` 之后加：`newKpNodes.set(newKp.id, effectiveNodeOf(newKp, data.chapters));`
- `await saveData(data);` 之后、`return {...}` 之前加：

```ts
  // 思源知识点区写回：新增 KP 所在节点的章文档
  if (newKpNodes.size > 0) {
    for (const node of new Set(newKpNodes.values())) void scheduleKpRegionSync(material.courseId, node);
  }
```

import 追加：`import { effectiveNodeOf } from "../utils/kpTreeImport";` 与 `import { scheduleKpRegionSync } from "./kpDocSync";`

- [ ] **Step 2: sampleCourse.ts 示例课落盘后调度**

`createSampleCourse` 内 `await saveData(applyImportToData(existing, remapped));` 改为：

```ts
  const merged = applyImportToData(existing, remapped);
  await saveData(merged);
  // 思源知识点区写回（惰性补建：示例课的课程/章文档首次创建）
  for (const ch of merged.chapters.filter((c) => c.courseId === remapped.courseId)) {
    void scheduleKpRegionSync(remapped.courseId, ch.id);
  }
  void scheduleKpRegionSync(remapped.courseId, null);
```

import 追加 `import { scheduleKpRegionSync } from "./kpDocSync";`

- [ ] **Step 3: 验证**

Run: `npx vitest run` → 全量不回归
Run: `npx vue-tsc --noEmit -p packages/core/tsconfig.json && npx vue-tsc --noEmit -p packages/siyuan/tsconfig.json` → 无错

- [ ] **Step 4: 提交**

```bash
git add -A && git commit -m "feat: 批量抽取与示例课落盘后调度思源知识点区写回"
```

---

### Task 10: `KpTreeChangePreview` 共享预览组件 + `KpTreeImportModal` 重构

**Files:**
- Create: `packages/core/src/components/KpTreeChangePreview.vue`
- Modify: `packages/core/src/components/KpTreeImportModal.vue`

**Interfaces:**
- Produces: `KpTreeChangePreview`（纯展示，操作按钮留在各父弹窗）
  - props: `diff: KpTreeDiff | null`、`kpOldName: Map<number, string>`、`chOldName: Map<number, string>`、`chKeyNames: Map<string, string>`（ParsedChapter key → 名称，用于「移至 X」）、`notices?: string[]`（只读提示项，读回弹窗用）、`emptyText?: string`（无变更文案，默认「无变更，数据与当前一致。」）
  - 渲染：`notices` 列表 → 更新/新增/删除知识点 → 章节变更（li 标记结构从 KpTreeImportModal 原样迁移，class 沿用 `.import-diff/.dn/.diff-badge`，style.css 无需改动）
  - 无 diff（`null`）时不渲染任何内容；`diff` 存在但全空时渲染 `emptyText`
- `KpTreeImportModal` 行为不变：预览区整体替换为 `<KpTreeChangePreview>`，删除组件内迁移走的 `chName/chAddBadge/kpLabel/chLabel` 辅助函数与对应模板段；保留文件选择、`analyze`、`confirm`、action 按钮（「重选文件/确认导入」逻辑不变）

- [ ] **Step 1: 创建 KpTreeChangePreview.vue**

```vue
<template>
  <div class="import-diff">
    <p v-for="(n, i) in notices" :key="i" class="s t-faint" style="margin:0 0 6px">{{ n }}</p>
    <template v-if="diff && !noChanges">
      <section v-if="diff.updated.length > 0">
        <h4>更新知识点（{{ diff.updated.length }}）</h4>
        <ul>
          <li v-for="u in diff.updated" :key="u.id">
            <span class="dn">{{ kpLabel(u.id) }}</span>
            <span v-if="u.name !== undefined" class="t-faint">→ {{ u.name }}</span>
            <span v-if="u.content !== undefined" class="diff-badge">内容</span>
            <span v-if="u.chapterKey !== undefined" class="diff-badge">移至 {{ chName(u.chapterKey) }}</span>
          </li>
        </ul>
      </section>
      <section v-if="diff.added.length > 0">
        <h4>新增知识点（{{ diff.added.length }}，默认「未学习」）</h4>
        <ul>
          <li v-for="(a, i) in diff.added" :key="i">
            <span class="dn">{{ a.name }}</span>
            <span class="diff-badge">{{ chName(a.chapterKey) }}</span>
          </li>
        </ul>
      </section>
      <section v-if="diff.removed.length > 0">
        <h4>删除知识点（{{ diff.removed.length }}）</h4>
        <ul>
          <li v-for="r in diff.removed" :key="r.id" class="t-danger">{{ r.name }}</li>
        </ul>
      </section>
      <section v-if="chCount > 0">
        <h4>章节变更（{{ chCount }}）</h4>
        <ul>
          <li v-for="c in diff.chaptersUpdated" :key="c.id">
            <span class="dn">{{ chLabel(c.id) }}</span>
            <span v-if="c.name !== undefined" class="t-faint">→ {{ c.name }}</span>
            <span v-if="c.parentKey !== undefined" class="diff-badge">移至 {{ chName(c.parentKey) }}</span>
          </li>
          <li v-for="a in diff.chaptersAdded" :key="a.key">
            <span class="dn">{{ a.name }}</span>
            <span class="diff-badge">{{ chAddBadge(a) }}</span>
          </li>
          <li v-for="r in diff.chaptersRemoved" :key="r.id" class="t-danger">{{ r.name }}（删除章节）</li>
        </ul>
      </section>
    </template>
    <p v-else-if="diff" class="s t-faint">{{ emptyText }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { KpTreeDiff } from "../utils/kpTreeImport";

const props = withDefaults(
  defineProps<{
    diff: KpTreeDiff | null;
    kpOldName: Map<number, string>;
    chOldName: Map<number, string>;
    /** ParsedChapter key → 章节名（「移至 X」展示用） */
    chKeyNames: Map<string, string>;
    /** 只读提示项（文档已删除/尚无区/待写 KP 保留等，读回弹窗用） */
    notices?: string[];
    /** 无变更时的文案 */
    emptyText?: string;
  }>(),
  { notices: () => [], emptyText: "无变更，数据与当前一致。" },
);

const noChanges = computed(
  () =>
    !!props.diff &&
    props.diff.updated.length === 0 &&
    props.diff.added.length === 0 &&
    props.diff.removed.length === 0 &&
    props.diff.chaptersUpdated.length === 0 &&
    props.diff.chaptersAdded.length === 0 &&
    props.diff.chaptersRemoved.length === 0,
);

const chCount = computed(
  () =>
    (props.diff?.chaptersUpdated.length ?? 0) +
    (props.diff?.chaptersAdded.length ?? 0) +
    (props.diff?.chaptersRemoved.length ?? 0),
);

function chName(key: string | null): string {
  if (key === null) return "未归章";
  return props.chKeyNames.get(key) ?? "未知章节";
}

function chAddBadge(a: { level: "chapter" | "unit"; parentKey: string | null }): string {
  return a.level === "chapter" ? "新增顶章" : `新增小节（${chName(a.parentKey)}）`;
}

function kpLabel(id: number): string {
  return props.kpOldName.get(id) ?? `#${id}`;
}

function chLabel(id: number): string {
  return props.chOldName.get(id) ?? `#${id}`;
}
</script>
```

- [ ] **Step 2: 重构 KpTreeImportModal.vue**

- 模板：`<div v-if="stage === 'preview' && preview" class="import-diff">…</div>` 整块（原 18–67 行的预览区，含「文件：…」行**保留在外**）替换为：

```html
      <div v-if="stage === 'preview' && preview">
        <p class="s t-faint" style="margin:0 0 8px">
          文件：{{ preview.fileName }}
          <template v-if="!preview.courseVerified">（⚠ 缺少课程标识，请确认本文件属于「{{ courseName }}」）</template>
        </p>
        <KpTreeChangePreview
          :diff="d"
          :kp-old-name="kpOldName"
          :ch-old-name="chOldName"
          :ch-key-names="keyName"
          empty-text="文件与当前课程知识点树一致，导入不会产生任何变更。"
        />
      </div>
```

- script：`import KpTreeChangePreview from "./KpTreeChangePreview.vue";`；删除 `chName/chAddBadge/kpLabel/chLabel` 四个函数（已迁入组件）；`noChanges/confirmLabel/changeCount/chCount` 保留（按钮仍用）——其中 `chCount` 若仅 `changeCount` 使用可保留内联计算，以 vue-tsc 无未使用告警为准。
- 行为不变：`analyze/confirm/resetToPick` 逻辑、action 按钮、watch(open) 重置全部保留。

- [ ] **Step 3: 验证**

Run: `npx vue-tsc --noEmit -p packages/core/tsconfig.json && npx vue-tsc --noEmit -p packages/siyuan/tsconfig.json` → 无错
Run: `npx vitest run` → 全量不回归（组件无独立单测，靠 vue-tsc + Task 12 冒烟覆盖 md 导入路径）

- [ ] **Step 4: 提交**

```bash
git add -A && git commit -m "refactor: 抽 KpTreeChangePreview 共享预览组件（导入弹窗行为不变）"
```

---

### Task 11: `SiyuanKpSyncModal` + `CourseContentView` 接线

**Files:**
- Create: `packages/core/src/components/SiyuanKpSyncModal.vue`
- Modify: `packages/core/src/views/CourseContentView.vue`

**Interfaces:**
- `SiyuanKpSyncModal` props: `open: boolean; courseId: number; courseName: string`；emits: `close` / `saved`
  - `open` 变 true → 自动执行 `readSiyuanKpSync`（busy「正在读取思源文档…」）→ 渲染头部说明 + notices + `KpTreeChangePreview`
  - 确认 → `applySiyuanKpSync` → toast「已同步思源知识点：N 处变更」→ `emit("saved")` + `emit("close")`
  - 按钮：关闭 / 确认同步（`noChanges || busy || !preview` 时禁用）
- `CourseContentView`：
  - 「从思源同步」按钮，显示条件 `!archived && docsEnabled() && siyuanPersistOn && currentCourseId()`，置于「导入知识点树」按钮之后（图标 `refresh`）
  - `siyuanPersistOn` 本地 ref：`onMounted` 时 `getSettings()` 取一次 + `useDataSavedRefresh` 回调里刷新（设置页改动会触发 global 保存事件）
  - 弹窗挂载（`@saved="onKpTreeImported"` 复用既有刷新）+ `onDeactivated` 关闭

- [ ] **Step 1: 创建 SiyuanKpSyncModal.vue**

```vue
<template>
  <div class="modal-mask" :class="{ open }" @click.self="$emit('close')">
    <div class="modal modal--lg">
      <h2>从思源同步</h2>
      <p class="s t-faint" style="margin-top:0">
        读取思源课程树文档中的知识点区，更新应用的知识点树。
        确认后更新应用数据，<b>掌握度、题目、闪卡、复习排期等学习记录不会被改动</b>。
      </p>

      <p v-if="error" class="s t-danger" style="word-break:break-all">{{ error }}</p>
      <p v-else-if="busy" class="s t-faint">正在读取思源文档…</p>
      <KpTreeChangePreview
        v-else-if="preview"
        :diff="preview.diff"
        :kp-old-name="kpOldName"
        :ch-old-name="chOldName"
        :ch-key-names="keyName"
        :notices="notices"
        empty-text="无变更，应用数据与思源知识点区一致。"
      />

      <div class="modal-actions">
        <button class="btn ghost" :disabled="busy" @click="$emit('close')">关闭</button>
        <button class="btn primary" :disabled="!preview || noChanges || busy" @click="confirm">
          {{ busy ? "同步中…" : `确认同步（${changeCount} 处变更）` }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import KpTreeChangePreview from "./KpTreeChangePreview.vue";
import { applySiyuanKpSync, getData, readSiyuanKpSync, type SiyuanKpSyncPreview } from "../api";
import { getBridge } from "@/bridge";

const props = defineProps<{ open: boolean; courseId: number; courseName: string }>();
const emit = defineEmits<{ (e: "close"): void; (e: "saved"): void }>();

const busy = ref(false);
const error = ref("");
const preview = ref<SiyuanKpSyncPreview | null>(null);
const kpOldName = ref(new Map<number, string>());
const chOldName = ref(new Map<number, string>());

const keyName = computed(() => new Map((preview.value?.tree.chapters ?? []).map((c) => [c.key, c.name])));
const chCount = computed(
  () =>
    (preview.value?.diff.chaptersUpdated.length ?? 0) +
    (preview.value?.diff.chaptersAdded.length ?? 0) +
    (preview.value?.diff.chaptersRemoved.length ?? 0),
);
const changeCount = computed(
  () =>
    (preview.value?.diff.updated.length ?? 0) +
    (preview.value?.diff.added.length ?? 0) +
    (preview.value?.diff.removed.length ?? 0) +
    chCount.value,
);
const noChanges = computed(() => preview.value !== null && changeCount.value === 0);

const notices = computed(() => {
  const p = preview.value;
  if (!p) return [];
  const out: string[] = [];
  if (p.deletedDocs > 0) out.push(`${p.deletedDocs} 个课程/章节文档已在思源中删除，对应知识点本次未同步`);
  if (p.historicalDocs > 0) out.push(`${p.historicalDocs} 个课程/章节文档尚无知识点区，本次未同步`);
  if (p.retained > 0) out.push(`${p.retained} 个应用侧新增知识点尚未写入思源，已保留并将写回对应区`);
  return out;
});

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    error.value = "";
    preview.value = null;
    busy.value = true;
    void load();
  },
);

async function load() {
  try {
    const data = await getData();
    kpOldName.value = new Map(data.knowledgePoints.map((k) => [k.id, k.name]));
    chOldName.value = new Map(data.chapters.map((c) => [c.id, c.name]));
    preview.value = await readSiyuanKpSync(props.courseId);
  } catch (e) {
    console.error("从思源同步读取失败:", e);
    error.value = e instanceof Error ? e.message : "读取思源文档失败";
  } finally {
    busy.value = false;
  }
}

async function confirm() {
  if (!preview.value || busy.value || noChanges.value) return;
  busy.value = true;
  try {
    await applySiyuanKpSync(props.courseId, preview.value);
    getBridge().showMessage(`已同步思源知识点：${changeCount.value} 处变更`);
    emit("saved");
    emit("close");
  } catch (e) {
    console.error("从思源同步失败:", e);
    getBridge().showMessage(e instanceof Error ? e.message : "从思源同步失败", 4000, "error");
  } finally {
    busy.value = false;
  }
}
</script>
```

- [ ] **Step 2: CourseContentView 接线**

模板——「导入知识点树」按钮（约 line 27）之后加：

```html
          <button v-if="siyuanKpSyncVisible" class="btn sm ghost" title="读取在思源章文档中编辑的知识点（预览确认后更新）" @click="siyuanKpSyncOpen = true"><AppIcon name="refresh" :size="14" /> 从思源同步</button>
```

模板——`<KpTreeImportModal …/>` 之后加：

```html
    <SiyuanKpSyncModal
      :open="siyuanKpSyncOpen"
      :course-id="currentCourseId() ?? 0"
      :course-name="courseStore.currentCourse?.name ?? ''"
      @close="siyuanKpSyncOpen = false"
      @saved="onKpTreeImported"
    />
```

script：
- import：`import SiyuanKpSyncModal from "../components/SiyuanKpSyncModal.vue";`；`import { docsEnabled, getSettings } from "../api";`（`../api` 已导出两者，确认 import 列表合并）
- 状态：

```ts
const siyuanKpSyncOpen = ref(false);
const siyuanPersistOn = ref(false);
const siyuanKpSyncVisible = computed(
  () => !archived.value && docsEnabled() && siyuanPersistOn.value && !!currentCourseId(),
);
async function refreshSiyuanPersist() {
  siyuanPersistOn.value = (await getSettings()).persistToSiyuan;
}
```

- 既有 `useDataSavedRefresh(() => { loadMaterials(); loadKnowledgePoints(); });` 回调内追加 `void refreshSiyuanPersist();`
- `onMounted` 内追加 `void refreshSiyuanPersist();`
- `onDeactivated` 内追加 `siyuanKpSyncOpen.value = false;`

- [ ] **Step 3: 验证**

Run: `npx vue-tsc --noEmit -p packages/core/tsconfig.json && npx vue-tsc --noEmit -p packages/siyuan/tsconfig.json` → 无错
Run: `npx vitest run` → 全量不回归
Run: `npm run build:web && npm run build:plugin`（**不 clean**）→ 构建成功

- [ ] **Step 4: 提交**

```bash
git add -A && git commit -m "feat: 课程内容页「从思源同步」按钮 + SiyuanKpSyncModal 读回弹窗"
```

---

### Task 12: 全链路验证 + 真机冒烟 + 文档

**Files:**
- Modify: `docs/功能深化设计.md`（补「思源知识点区双向同步」节）

- [ ] **Step 1: 全量静态验证**

```bash
npx vue-tsc --noEmit -p packages/siyuan/tsconfig.json
npx vue-tsc --noEmit -p packages/core/tsconfig.json
npx vitest run
npm run build:web && npm run build:plugin
```

四项全部通过（不 clean 构建，避免思源把插件当卸载）。

- [ ] **Step 2: 真机冒烟（示例课，AGENTS.md 冒烟协议：整页刷新 → `div[aria-label="AI 智能学习"]` 开页签 → `.ai-study-app`）**

前置：首页「试一试示例课」导入示例课（12 章 186 KP + 14 天计划）；`settings.persistToSiyuan` 开启。

1. **应用内写回**：应用内改一个 KP 内容 + 章内新增一个 KP → 500ms 后查思源对应章文档（`getDocMarkdown` 或思源界面）：出现 `<!-- ai-study:kps:begin/end -->` 区、内容正确、锚点外已有内容保留
2. **读回三类变更**：思源章文档区内手改一行内容、删一个 KP 行、加一个无标记条目 → 点「从思源同步」→ 预览显示 更新/删除/新增 三类 → 确认 → 应用数据更新、`mastery` 不变
3. **冲突停写**：思源改区后（未同步）应用内再改该章 KP → toast 停写提示、文档内容不变（用户编辑未被冲掉）→ 点「从思源同步」确认 → 再改 → 正常写回
4. **应用领先不误报**：连续应用内改两次同一 KP（期间无思源编辑）→ 第二次写回不弹停写、文档区最终为最新
5. **md 导入联动**：导出知识点树 → 编辑 md（新增一章、改一个章名、删一个章）→ 导入确认 → 思源课程树：新章文档挂对父级、改名同步、删章文档级联删除；受影响章文档区更新；`docRegions` 被删章条目清理（读 pinia/state 验证）
6. **非思源端不受影响**：类型层面——fnos bridge `capabilities.docs !== "siyuan"`，`kpRegionSyncEnabled()=false` 管道短路（无真机环境，以 vue-tsc + 单测覆盖 `docsEnabled` 短路分支为准）

清理：示例课按 AGENTS.md 清理（课程主页 → 编辑课程信息 → 删除课程）；确认思源文档树中示例课目录已删、测试 KP 区无残留。

- [ ] **Step 3: 更新文档**

`docs/功能深化设计.md`：在知识点树可编辑往返节之后补一节「思源知识点区双向同步」——锚点区格式、写回触发点表、停写检测口径、读回安全规则（含删除消歧）、非思源端短路。与 spec 一致，引用 `docs/superpowers/specs/2026-11-03-siyuan-kp-doc-sync-design.md`。

- [ ] **Step 4: 提交**

```bash
git add -A && git commit -m "docs: 功能深化设计补充思源知识点区双向同步章节"
```

（功能迭代：本地提交，不 push、不发版、不 bump 版本。）

