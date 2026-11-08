# outline-first 全链路结构识别与抽取 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「清理→结构识别→跨资料语义合并→知识点抽取」全链路重构为 outline-first 架构：N 级章节树（AI 语义合并）、显式映射挂接（废除字符串模糊匹配）、每节点精确圈定原文抽取。

**Architecture:** 四阶段流水线，每阶段独立后台任务（bgTask 铃铛基建），产物落库可单阶段重跑：①`organize_doc` 清理（去标题职责）→ ②`recognize_outline` 每资料 N 级扁平 outline（代码侧对齐 span）→ ③`merge_toc` 逐资料顺序语义合并→规范树+映射（人工确认门保留）→ ④`extract_kp` 每规范节点抽取（映射挂接）。数据模型：`Chapter.level` 变 number（深度 1..N）、新增 `AppData.tocMappings`、`Material.outline`。深度 ≥3 节点不建思源文档。

**Tech Stack:** Vue 3 + TypeScript + Pinia（monorepo `packages/core` 三端共享）；vitest（jsdom + `@vue/test-utils`，测试用 `setBridge` 假桥模式，不用 vi.mock）；AI 调用走 `callAi` + `PROMPT_TASKS` 任务模型分配。

**Spec:** `docs/superpowers/specs/2026-11-08-outline-first-extraction-design.md`（执行者必须同时读 spec 与本计划）

## Global Constraints

- 2 空格缩进；变量 camelCase；函数名动词开头；注释用中文
- 禁止 `any` 类型、禁止 `eslint-disable`/`@ts-ignore`、不保留废弃代码（删除而非注释）
- 前端样式只写 `packages/core/src/style.css`（组件 `<style scoped>` 不生效）
- 每个任务完成后跑：`npx vue-tsc --noEmit -p packages/siyuan/tsconfig.json && npx vue-tsc --noEmit -p packages/core/tsconfig.json` 与 `npx vitest run`（纯函数/组件测试），全绿才提交
- 功能迭代：只本地 commit，**不 push、不 bump 版本、不打包发版**（发版时机由用户指定）
- AI 任务模型经 `findTaskBinding(data, taskKey, courseId)` 查找；未配置时抛中文错误提示到「模型配置 → 任务模型」
- `callAi` 取消经 `AiCanceledError`（`api/ai.ts`）；bgTask 取消经 flag 对象 + `cancelAiCall(taskKey, scope)`
- 阈值常量：outline 识别切段 40000 字（尾重叠 500）；节点抽取单段 60000 字；单资料 outline 超 150 节点拆半合并

## 文件结构

新建（`packages/core/src/` 下）：
- `utils/dataMigrate.ts` — 读时数据升级（幂等）
- `utils/outline.ts` — N 级纯函数：outline 建树 / span 对齐 / 章节树 / 文档祖先 / 路径
- `api/outlineExtract.ts` — 阶段②：outline 识别（AI 分段调用 + 解析 + 对齐 + 落库 + 后台任务）
- `api/tocMerge.ts` — 阶段③：跨资料语义合并（种子树 / 逐资料合并 / 解析校验 / 拆分 / 后台任务）
- `api/nodeExtract.ts` — 阶段④：按规范节点抽取（节点解析 / 节点文本圈定 / 节点抽取 / 资料→节点集合换算）
- `components/PreviewTreeNode.vue` — 目录预览递归节点组件（任务 8）
- `components/ChapterTreeRow.vue` — 主界面章节树递归行组件（任务 9）
- `utils/__tests__/outline.test.ts`、`utils/__tests__/dataMigrate.test.ts`、`api/__tests__/outlineExtract.test.ts`、`api/__tests__/tocMerge.test.ts`、`api/__tests__/nodeExtract.test.ts`、`components/__tests__/PreviewTreeNode.test.ts`

修改：
- `types/appData.ts` — `Chapter.level: number`；`TocMapping`；`Material.outline/outlineStatus`；`AppData.tocMappings`；`createEmptyData`
- `api/storage.ts` — `getData()` 内调 `normalizeAppDataShape`
- `api/promptTemplates.ts` — `organize_doc` 去标题职责；删 `recognize_toc`；增 `recognize_outline`/`merge_toc`；重写 `extract_kp`；大上下文任务 desc 提示
- `api/material.ts` — 梳理完成后自动链改走 `startTocMergeTask`；资料删除级联 `tocMappings`
- `api/kp.ts` — `createChapter`/`importChapterTree` N 级 + 文档策略（depth≤2）+ `tocMappings` 写入/级联删；`matchChapterForKp` N 级；删 `aggregateCourseToc`/`correctTocWithAi`
- `api/extract.ts` — 执行单位改规范节点（内部改调 nodeExtract）
- `utils/chapterMove.ts`、`utils/chapterScope.ts`、`utils/kpTreeImport.ts` — N 级泛化
- `utils/textChunker.ts` — 删抽取链路不再使用的 `chunkByChapters`/`chunkByMarkdownHeadings`（任务 10 确认无引用后删）
- `views/CourseContentView.vue`、`components/ChapterTreePreviewModal.vue`、`components/Topbar.vue`、`components/UploadMaterialModal.vue`、`stores/modal.ts`、`api/kpDocSync.ts`、`constants/sampleCourse.ts`、`components/ModelConfigView.vue`（如含任务说明文案）

依赖顺序：Task 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11。任务 4/5 可在 3 之后并行起步（同文件冲突除外），但提交顺序仍按编号。

---

### Task 1: 数据模型 + 读时迁移

**Files:**
- Modify: `packages/core/src/types/appData.ts`
- Modify: `packages/core/src/api/storage.ts`
- Create: `packages/core/src/utils/dataMigrate.ts`
- Modify: `packages/core/src/constants/sampleCourse.ts`（`level: "chapter"/"unit"` → `1/2`）
- Modify: `packages/core/src/utils/kpTreeImport.ts:27,75,245,271`（`ParsedChapter.level` → number；`"unit"→2`、`"chapter"→1`）
- Test: `packages/core/src/utils/__tests__/dataMigrate.test.ts`、`packages/core/src/api/__tests__/storage.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `Chapter.level: number`（深度，1=章根）——**所有读写字段处随之改**
  - `interface TocMapping { id: number; materialId: number; courseId: number; materialPath: string; chapterId: number }`
  - `AppData.tocMappings: TocMapping[]`（非可选，`createEmptyData` 含 `tocMappings: []`）
  - `Material.outline?: string`（JSON：`{text: string; level: number}[]` 扁平文档序）
  - `Material.outlineStatus?: "none" | "done" | "partial"`
  - `normalizeAppDataShape(data: AppData): void`（idempotent，供 `getData()` 调用）

- [ ] **Step 1: 写失败测试**

`utils/__tests__/dataMigrate.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import type { AppData } from "../../types/appData";
import { createEmptyData } from "../../types/appData";
import { normalizeAppDataShape } from "../dataMigrate";

function seed(): AppData {
  const d = createEmptyData();
  d.chapters = [
    { id: 1, courseId: 1, parentId: null, siyuanBlockId: null, name: "第一章", level: "chapter" as unknown as number, sort: 1 },
    { id: 2, courseId: 1, parentId: 1, siyuanBlockId: null, name: "1.1 节", level: "unit" as unknown as number, sort: 1 },
  ];
  return d;
}

describe("normalizeAppDataShape", () => {
  it("旧版 level 字符串升为数字", () => {
    const d = seed();
    normalizeAppDataShape(d);
    expect(d.chapters[0].level).toBe(1);
    expect(d.chapters[1].level).toBe(2);
  });
  it("幂等：数字 level 与已有 tocMappings 不被破坏", () => {
    const d = seed();
    d.tocMappings = [{ id: 9, materialId: 5, courseId: 1, materialPath: "第一章", chapterId: 1 }];
    normalizeAppDataShape(d);
    normalizeAppDataShape(d);
    expect(d.chapters[0].level).toBe(1);
    expect(d.tocMappings).toHaveLength(1);
    expect(d.tocMappings[0].id).toBe(9);
  });
  it("缺失 tocMappings 时补空数组", () => {
    const d = createEmptyData();
    delete (d as { tocMappings?: unknown }).tocMappings;
    normalizeAppDataShape(d);
    expect(d.tocMappings).toEqual([]);
  });
});
```

`api/__tests__/storage.test.ts` 追加（该文件已有 setBridge 模式，沿用其假桥）：

```ts
it("getData 返回前完成数据升级", async () => {
  const raw: AppData = { ...createEmptyData(), chapters: [{ id: 1, courseId: 1, parentId: null, siyuanBlockId: null, name: "c", level: "chapter" as unknown as number, sort: 1 }] };
  setBridge(makeFakeBridge({ getData: () => raw }));
  const d = await getData();
  expect(d.chapters[0].level).toBe(1);
  expect(d.tocMappings).toEqual([]);
});
```

（若 `storage.test.ts` 现有假桥构造方式不同，沿用文件内既有 helper 传 `getData` 返回值。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/core/src/utils/__tests__/dataMigrate.test.ts packages/core/src/api/__tests__/storage.test.ts`
Expected: FAIL（`dataMigrate` 模块不存在 / `level` 仍为字符串）

- [ ] **Step 3: 实现**

`utils/dataMigrate.ts`：

```ts
import type { AppData } from "../types/appData";

/** 读时数据升级（幂等）：旧版 chapter.level "chapter"|"unit" → number（1/2）；补 tocMappings 默认值 */
export function normalizeAppDataShape(data: AppData): void {
  for (const ch of data.chapters) {
    const lv = ch.level as unknown;
    if (lv === "chapter") ch.level = 1;
    else if (lv === "unit") ch.level = 2;
  }
  if (!Array.isArray(data.tocMappings)) data.tocMappings = [];
}
```

`types/appData.ts`：
- `Chapter.level` 类型 `"chapter" | "unit"` → `number`，注释改「深度：1=章根，2=节，3+=小节（可变深度）」
- 新增 `export interface TocMapping { id: number; materialId: number; courseId: number; /** 资料 outline 节点路径，如「第1章>1.1 概述」 */ materialPath: string; chapterId: number }`
- `AppData` 增 `tocMappings: TocMapping[];`（非可选，紧跟 `materialChapters` 后）
- `Material` 增 `outline?: string; outlineStatus?: "none" | "done" | "partial";`
- `createEmptyData()` 增 `tocMappings: []`

`api/storage.ts`：

```ts
import { normalizeAppDataShape } from "../utils/dataMigrate";

export async function getData(): Promise<AppData> {
  const data = await getBridge().getData();
  normalizeAppDataShape(data);
  return data;
}
```

- [ ] **Step 4: 修全部编译错误（level 字面量）**

`npx vue-tsc --noEmit -p packages/core/tsconfig.json` 逐个修：
- `constants/sampleCourse.ts` 数据行：`level: "chapter"` → `level: 1`，`level: "unit"` → `level: 2`
- `utils/kpTreeImport.ts:27,75`：`ParsedChapter.level` 类型 → `number`；`:245` `level: "unit"` → `2`；`:271` `level: "chapter"` → `1`
- 其余报错点（`kp.ts`/`chapterScope.ts`/`chapterMove.ts`/`CourseContentView.vue`/`chapterModal`/既有测试断言）：**本任务只做最小类型适配**（如 `level === "chapter"` 的比较暂时改 `level === 1`、`level === "unit"` 改 `level === 2`，测试断言同步改），不做 N 级泛化（任务 2/9 处理）
- 测试目录同理修断言

- [ ] **Step 5: 跑类型检查 + 全量测试确认通过**

Run: `npx vue-tsc --noEmit -p packages/siyuan/tsconfig.json && npx vue-tsc --noEmit -p packages/core/tsconfig.json && npx vitest run`
Expected: 全绿（683+ 测试）

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/types/appData.ts packages/core/src/api/storage.ts packages/core/src/utils/dataMigrate.ts packages/core/src/utils/__tests__/dataMigrate.test.ts packages/core/src/api/__tests__/storage.test.ts packages/core/src/constants/sampleCourse.ts packages/core/src/utils/kpTreeImport.ts
git add -u packages/core/src   # 其余最小类型适配改动
git commit -m "refactor: 章节模型 N 级化——Chapter.level 改数字深度 + 新增 tocMappings/Material.outline 与读时迁移"
```

---

### Task 2: N 级纯函数 utils/outline.ts

**Files:**
- Create: `packages/core/src/utils/outline.ts`
- Test: `packages/core/src/utils/__tests__/outline.test.ts`

**Interfaces:**
- Consumes: `Chapter`（Task 1 后 `level: number`）
- Produces（后续任务全部依赖这些签名）：
  - `interface OutlineNode { text: string; level: number }`
  - `interface OutlineSpan { seq: number; start: number; end: number }`（`start=-1` 表示未定位；`end` = 下一个已定位标题起点或文本结尾）
  - `alignOutlineSpans(text: string, nodes: OutlineNode[]): { spans: OutlineSpan[]; unlocated: number[] }`
  - `interface OutlineTreeNode { seq: number; text: string; level: number; children: OutlineTreeNode[] }`
  - `buildOutlineTree(nodes: OutlineNode[]): OutlineTreeNode[]`
  - `nodePathOf(nodes: OutlineNode[], seq: number): string`（祖先文本以 `>` 连接）
  - `interface NestedChapter { chapter: Chapter; children: NestedChapter[] }`
  - `buildChapterTree(chapters: Chapter[], courseId: number): NestedChapter[]`（按 sort 递归；孤儿节点提升到顶层防丢失）
  - `nearestDocAncestorId(chapters: Chapter[], nodeId: number): number`（自身或最近的 level≤2 祖先 id）
  - `isDescendant(chapters: Chapter[], ancestorId: number, nodeId: number): boolean`
  - `chapterPathText(chapters: Chapter[], nodeId: number): string`（章节名以 `>` 连接，自根到自身）

- [ ] **Step 1: 写失败测试**

`utils/__tests__/outline.test.ts`（核心用例，全部要写）：

```ts
import { describe, expect, it } from "vitest";
import type { Chapter } from "../../api";
import {
  alignOutlineSpans, buildChapterTree, buildOutlineTree,
  chapterPathText, isDescendant, nearestDocAncestorId, nodePathOf,
} from "../outline";

const text = [
  "前言若干字",
  "",
  "第1章 极限与连续",
  "",
  "1.1 函数的极限",
  "正文甲",
  "",
  "1.2 极限的运算",
  "正文乙",
  "",
  "第2章 导数",
  "正文丙",
].join("\n");

const nodes = [
  { text: "第1章 极限与连续", level: 1 },
  { text: "1.1 函数的极限", level: 2 },
  { text: "1.2 极限的运算", level: 2 },
  { text: "第2章 导数", level: 1 },
  { text: "不存在的标题", level: 2 },
];

describe("alignOutlineSpans", () => {
  it("按序定位标题行并切出各自范围", () => {
    const { spans, unlocated } = alignOutlineSpans(text, nodes);
    expect(unlocated).toEqual([4]);
    const s = (seq: number) => spans[seq];
    expect(s(0).start).toBe(text.indexOf("第1章 极限与连续"));
    expect(s(1).start).toBe(text.indexOf("1.1 函数的极限"));
    expect(s(1).end).toBe(s(2).start);
    expect(s(3).end).toBe(text.length);
    // 范围文本正确
    expect(text.slice(s(1).start, s(1).end)).toContain("正文甲");
    expect(text.slice(s(1).start, s(1).end)).not.toContain("正文乙");
  });
  it("容忍 markdown 井号与加粗包裹", () => {
    const t2 = "# 第1章 极限与连续\n正文\n**1.1 函数的极限**\n正文2";
    const { unlocated } = alignOutlineSpans(t2, nodes.slice(0, 2));
    expect(unlocated).toEqual([]);
  });
  it("单调约束：后一个同名标题必须在前一个标题之后找（不回溯）", () => {
    const t3 = "第1章\n甲内容\n第2章\n乙内容\n第1章\n丙内容";
    const { spans, unlocated } = alignOutlineSpans(t3, [
      { text: "第1章", level: 1 },
      { text: "第2章", level: 1 },
      { text: "第1章", level: 1 },
    ]);
    expect(unlocated).toEqual([]);
    // 第三个「第1章」取最后一处出现（cursor 已越过前两个标题）
    expect(t3.slice(spans[2].start, spans[2].end)).toContain("丙内容");
    expect(spans[0].start).toBe(0);
  });
});

describe("buildOutlineTree", () => {
  it("按 level 嵌套（level 回跳弹栈）", () => {
    const tree = buildOutlineTree([
      { text: "A", level: 1 }, { text: "B", level: 2 }, { text: "C", level: 3 },
      { text: "D", level: 2 }, { text: "E", level: 1 },
    ]);
    expect(tree.map((n) => n.text)).toEqual(["A", "E"]);
    expect(tree[0].children.map((n) => n.text)).toEqual(["B", "D"]);
    expect(tree[0].children[0].children.map((n) => n.text)).toEqual(["C"]);
  });
  it("首个节点 level>1 也作根", () => {
    const tree = buildOutlineTree([{ text: "X", level: 3 }]);
    expect(tree).toHaveLength(1);
    expect(tree[0].level).toBe(3);
  });
});

describe("nodePathOf", () => {
  it("祖先路径用 > 连接", () => {
    const ns = [{ text: "A", level: 1 }, { text: "B", level: 2 }, { text: "C", level: 3 }];
    expect(nodePathOf(ns, 2)).toBe("A>B>C");
    expect(nodePathOf(ns, 0)).toBe("A");
  });
});

function ch(id: number, parentId: number | null, level: number, sort: number, name = `n${id}`): Chapter {
  return { id, courseId: 1, parentId, siyuanBlockId: null, name, level, sort };
}

describe("buildChapterTree", () => {
  it("按 sort 递归，孤儿提升顶层", () => {
    const tree = buildChapterTree([
      ch(1, null, 1, 2), ch(2, null, 1, 1), ch(3, 2, 2, 2), ch(4, 2, 2, 1), ch(9, 99, 3, 1),
    ], 1);
    expect(tree.map((n) => n.chapter.id)).toEqual([2, 1, 9]);
    expect(tree[0].children.map((n) => n.chapter.id)).toEqual([4, 3]);
  });
});

describe("nearestDocAncestorId / chapterPathText / isDescendant", () => {
  const chapters = [ch(1, null, 1, 1), ch(2, 1, 2, 1), ch(3, 2, 3, 1), ch(4, 3, 4, 1)];
  it("level<=2 返回自身，更深取最近有文档祖先", () => {
    expect(nearestDocAncestorId(chapters, 1)).toBe(1);
    expect(nearestDocAncestorId(chapters, 2)).toBe(2);
    expect(nearestDocAncestorId(chapters, 3)).toBe(2);
    expect(nearestDocAncestorId(chapters, 4)).toBe(2);
  });
  it("chapterPathText 自根到自身", () => {
    expect(chapterPathText(chapters, 3)).toBe("n1>n2>n3");
  });
  it("isDescendant 链上判定", () => {
    expect(isDescendant(chapters, 1, 4)).toBe(true);
    expect(isDescendant(chapters, 4, 1)).toBe(false);
    expect(isDescendant(chapters, 2, 2)).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/core/src/utils/__tests__/outline.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `utils/outline.ts`**

```ts
import type { Chapter } from "../api";

/** outline 扁平节点（文档序） */
export interface OutlineNode {
  text: string;
  level: number;
}

/** outline 节点在干净文本中的定位范围（start=-1 未定位） */
export interface OutlineSpan {
  seq: number;
  start: number;
  end: number;
}

const norm = (s: string): string => s.replace(/\s+/g, "");

/** 去掉 markdown 井号/加粗包裹，得到标题行纯文本 */
function plainLine(line: string): string {
  return line.trim().replace(/^#{1,6}\s+/, "").replace(/^\*\*(.+?)\*\*$/, "$1").trim();
}

/**
 * 顺序对齐：每个标题从上一标题行之后向后查找（单调，防目录页误匹配）。
 * 两遍匹配：归一化精确 → 包含匹配（标题与文档行略有差异，短行 ≤ 2×标题长）。
 */
export function alignOutlineSpans(text: string, nodes: OutlineNode[]): { spans: OutlineSpan[]; unlocated: number[] } {
  const lines = text.split("\n");
  const lineStarts: number[] = [];
  let off = 0;
  for (const line of lines) {
    lineStarts.push(off);
    off += line.length + 1;
  }
  const spans: OutlineSpan[] = [];
  const unlocated: number[] = [];
  let cursor = 0;
  for (let seq = 0; seq < nodes.length; seq++) {
    const target = norm(nodes[seq].text);
    let foundLine = -1;
    if (target.length > 0) {
      for (let i = cursor; i < lines.length; i++) {
        if (norm(plainLine(lines[i])) === target) { foundLine = i; break; }
      }
      if (foundLine < 0 && target.length >= 4) {
        for (let i = cursor; i < lines.length; i++) {
          const p = norm(plainLine(lines[i]));
          if (p.length < 4 || p.length > target.length * 2 + 6) continue;
          if (p.includes(target) || target.includes(p)) { foundLine = i; break; }
        }
      }
    }
    if (foundLine < 0) {
      spans.push({ seq, start: -1, end: -1 });
      unlocated.push(seq);
      continue;
    }
    cursor = foundLine + 1;
    spans.push({ seq, start: lineStarts[foundLine], end: -1 });
  }
  // 回填 end：到下一个「已定位」标题起点（未定位节点不切段）
  let nextStart = text.length;
  for (let i = spans.length - 1; i >= 0; i--) {
    spans[i].end = nextStart;
    if (spans[i].start >= 0) nextStart = spans[i].start;
  }
  return { spans, unlocated };
}

export interface OutlineTreeNode {
  seq: number;
  text: string;
  level: number;
  children: OutlineTreeNode[];
}

/** 扁平 outline → 嵌套树（level 回跳弹栈；首个节点无论 level 都作根） */
export function buildOutlineTree(nodes: OutlineNode[]): OutlineTreeNode[] {
  const roots: OutlineTreeNode[] = [];
  const stack: OutlineTreeNode[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node: OutlineTreeNode = { seq: i, text: nodes[i].text, level: nodes[i].level, children: [] };
    while (stack.length > 0 && stack[stack.length - 1].level >= node.level) stack.pop();
    if (stack.length === 0) roots.push(node);
    else stack[stack.length - 1].children.push(node);
    stack.push(node);
  }
  return roots;
}

/** 第 seq 个 outline 节点的路径文本（祖先 > 自身） */
export function nodePathOf(nodes: OutlineNode[], seq: number): string {
  const tree = buildOutlineTree(nodes);
  let found: string[] = [];
  const walk = (list: OutlineTreeNode[], trail: string[]): boolean => {
    for (const n of list) {
      const next = [...trail, n.text];
      if (n.seq === seq) { found = next; return true; }
      if (walk(n.children, next)) return true;
    }
    return false;
  };
  walk(tree, []);
  return found.join(">");
}

export interface NestedChapter {
  chapter: Chapter;
  children: NestedChapter[];
}

/** 课程章节 flat → 嵌套树（同级按 sort；孤儿 parentId 指向已删节点时提升顶层防丢失） */
export function buildChapterTree(chapters: Chapter[], courseId: number): NestedChapter[] {
  type Item = { chapter: Chapter; children: NestedChapter[] };
  const items: Item[] = chapters
    .filter((c) => c.courseId === courseId)
    .map((c) => ({ chapter: c, children: [] }));
  const byId = new Map(items.map((it) => [it.chapter.id, it]));
  const roots: NestedChapter[] = [];
  for (const it of items) {
    const parent = it.chapter.parentId === null ? undefined : byId.get(it.chapter.parentId);
    if (parent) parent.children.push(it);
    else roots.push(it);
  }
  const sortRec = (list: NestedChapter[]): void => {
    list.sort((a, b) => a.chapter.sort - b.chapter.sort);
    for (const n of list) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}

/** 自身或最近的 level≤2 祖先 id（KP 区域/文档同步落点）；level>2 节点本身不建文档 */
export function nearestDocAncestorId(chapters: Chapter[], nodeId: number): number {
  const byId = new Map(chapters.map((c) => [c.id, c]));
  let cur: Chapter | undefined = byId.get(nodeId);
  let guard = 0;
  while (cur && cur.level > 2 && guard++ < 16) {
    cur = cur.parentId === null ? undefined : byId.get(cur.parentId);
  }
  return cur?.id ?? nodeId;
}

/** nodeId 是否 ancestorId 的严格后代 */
export function isDescendant(chapters: Chapter[], ancestorId: number, nodeId: number): boolean {
  const byId = new Map(chapters.map((c) => [c.id, c]));
  let cur: Chapter | undefined = byId.get(nodeId);
  let guard = 0;
  while (cur && guard++ < 16) {
    if (cur.id === ancestorId) return true;
    cur = cur.parentId === null ? undefined : byId.get(cur.parentId);
  }
  return false;
}

/** 节点完整路径文本（根 > ... > 自身） */
export function chapterPathText(chapters: Chapter[], nodeId: number): string {
  const byId = new Map(chapters.map((c) => [c.id, c]));
  const parts: string[] = [];
  let cur: Chapter | undefined = byId.get(nodeId);
  let guard = 0;
  while (cur && guard++ < 16) {
    parts.unshift(cur.name);
    cur = cur.parentId === null ? undefined : byId.get(cur.parentId);
  }
  return parts.join(">");
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run packages/core/src/utils/__tests__/outline.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/utils/outline.ts packages/core/src/utils/__tests__/outline.test.ts
git commit -m "feat: N 级结构纯函数——outline 建树/span 对齐/章节树/文档祖先/路径"
```

---

### Task 3: PROMPT_TASKS 模板更新

**Files:**
- Modify: `packages/core/src/api/promptTemplates.ts`
- Test: `packages/core/src/api/__tests__/prompt.test.ts`（新建）

**Interfaces:**
- Consumes: 无
- Produces: 任务 key 集合变更——删 `recognize_toc`，增 `recognize_outline`（变量 `{{context}}`/`{{chunk}}`）、`merge_toc`（变量 `{{tree}}`/`{{materialName}}`/`{{outline}}`）；`organize_doc` 去掉标题标注职责；`extract_kp` 输出结构变 `[{name, description}]`（删 `section`），user 模板新增变量 `{{siblings}}`

- [ ] **Step 1: 写失败测试**

`api/__tests__/prompt.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { PROMPT_TASKS, renderPrompt } from "../promptTemplates";

const keys = Object.keys(PROMPT_TASKS);

describe("PROMPT_TASKS 任务集合", () => {
  it("新增 recognize_outline 与 merge_toc", () => {
    expect(keys).toContain("recognize_outline");
    expect(keys).toContain("merge_toc");
  });
  it("删除 recognize_toc（旧两级矫正任务）", () => {
    expect(keys).not.toContain("recognize_toc");
  });
  it("organize_doc 不再要求标注标题", () => {
    const tpl = PROMPT_TASKS.organize_doc;
    expect(tpl.system).not.toMatch(/标注|添加.*标题|markdown 标题/);
    expect(tpl.system).toMatch(/已有.*标题.*保留|保留.*标题.*原样/);
  });
  it("extract_kp 输出不再有 section 字段，且要求兄弟节点边界", () => {
    const tpl = PROMPT_TASKS.extract_kp;
    expect(tpl.system).not.toMatch(/section/);
    expect(tpl.system).toMatch(/兄弟/);
    expect(tpl.user).toContain("{{siblings}}");
  });
  it("所有模板变量可渲染（无未替换 {{}} 残留于占位符替换后）", () => {
    for (const [key, tpl] of Object.entries(PROMPT_TASKS)) {
      const vars = [...new Set((tpl.system + tpl.user).match(/\{\{(\w+)\}\}/g) ?? [])]
        .map((v) => v.replace(/[{}]/g, ""));
      const rendered = renderPrompt(tpl.user, Object.fromEntries(vars.map((v) => [v, "X"])));
      expect(rendered).not.toMatch(/\{\{\w+\}\}/);
      // system 无变量时也验证可渲染
      renderPrompt(tpl.system, {});
    }
  });
  it("三个大块任务 desc 带大上下文提示", () => {
    for (const key of ["recognize_outline", "merge_toc", "extract_kp"]) {
      expect(PROMPT_TASKS[key].desc).toMatch(/上下文|长文/);
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/core/src/api/__tests__/prompt.test.ts`
Expected: FAIL（`recognize_outline` 不存在等）

- [ ] **Step 3: 改模板**

`promptTemplates.ts` 改动（保留其余 9 个任务不动；`renderPrompt` 签名不变）：

1. `organize_doc`：`system` 删「标注章/节」相关条目（原 5/6 条），新增一条：「原文中已有的 markdown 标题行（# 开头）保留原样，不添加、不删除任何标题标记，不判断标题层级」。`desc` 保持「AI 文档结构梳理：清洗+可读化」。
2. 删除 `recognize_toc` 整条。
3. 新增（插在 `organize_doc` 之后）：

```ts
recognize_outline: {
  name: "结构识别（outline）",
  desc: "识别资料文档的 N 级标题结构（大块输入，建议 128K 以上上下文的模型）",
  system: `你是文档结构识别助手。用户给你一段教材/资料文档（可能是长文档的续段），以及前面已发现的标题大纲。你的任务：只输出本段中出现的结构性标题，按文档顺序。

严格要求：
1. 只输出文本中真实出现的标题，不得概括、不得补造、不得扩写。
2. 正文语句、列表项、题干、答案不算标题。
3. 文档开头的目录页（通常带点线或页码）不是标题，不要输出。
4. level 是绝对层级：1=顶级章，2=其直接下级，依此类推；依据文档编号体系（第X章 / X.X / （X） 等）与版面判断，markdown # 标记是最强依据。
5. 若提供了前面已发现的大纲，本段层级必须与它一致（前面「第1章」是 L1，本段「第2章」也必须是 L1）。
6. 本段没有结构性标题时输出空数组。

输出格式：只输出 JSON 对象，不要输出任何其他内容：
{"headings": [{"text": "第1章 极限与连续", "level": 1}]}
text 用标题原文（不增删编号、标点与 markdown 标记）。`,
  user: `前面已发现的标题大纲（空表示首段）：
{{context}}

本段文本：
{{chunk}}`,
},
merge_toc: {
  name: "目录语义合并",
  desc: "把资料 outline 语义合并进课程规范章节树并产出映射（建议 128K 以上上下文的模型）",
  system: `你是课程目录合并助手。用户给你课程的当前规范章节树，以及某一份资料的结构大纲。你的任务：把该资料大纲合并进规范树，输出更新后的完整规范树，以及每个大纲节点归属哪个规范节点。

判定规则：
1. 语义判定「同一章/节」：编号体系差异（第1章/第一章/Chapter 1）、措辞变体（极限与连续/极限）、缩写都算同一节点；取更完整规范的写法为规范名，其余写法放入 variants。
2. 不得臆造输入中不存在的节点；保持文档顺序；同一节点在不同资料的层级必须一致。
3. 资料中不对应任何现有规范节点的部分（附录、补充材料等）新建节点，放在合理位置。
4. 大纲节点归属语义上不小于它的规范节点：章标题归属章节点，节标题归属节节点，小节标题归属小节节点。

输出格式：只输出 JSON 对象，不要输出任何其他内容：
{
  "nodes": [
    {"id": 0, "parent": null, "name": "第1章 极限与连续", "variants": ["第一章 极限"]},
    {"id": 1, "parent": 0, "name": "1.1 函数的极限", "variants": []}
  ],
  "mappings": [
    {"seq": 0, "node": 0},
    {"seq": 1, "node": 1}
  ]
}
- nodes 是更新后的完整规范树（扁平列表，parent=父节点 id，顶层为 null）。输入树已有节点必须全部保留且 id 不变；新增节点 id 从输入节点总数起连续编号。
- variants 是该节点的其他写法数组（不含规范名本身），保留输入中已有 variants 并合并本次新见写法。
- mappings 把大纲每个节点（seq=大纲节点序号，0 起）映射到归属规范节点（node=nodes 中的 id）。无法归属的 seq 可以省略。`,
  user: `当前规范章节树（L 前缀=层级，文档序）：
{{tree}}

这份资料名称：{{materialName}}
这份资料的大纲（方括号内是节点序号）：
{{outline}}`,
},
```

4. `extract_kp`：`system` 重写为：

```
你是知识点抽取助手。用户给你课程中某个章节/小节节点的完整正文（可能由多份资料拼成），以及兄弟节点名单与已有知识点，要求只从该节点范围内抽取知识点。

严格要求：
1. 输入正文就是该节点自身的全部内容，严格在此范围内抽取；发现属于兄弟节点（名单已给）的内容，不要抽取。
2. name 尽量使用教材原词，2-20 字，不用「…的概念」「…的说明」这类词。
3. 正文中的公式、数值、定义、专有名词必须逐字保留，不得改写符号或数字。
4. 同一标题下的多个编号子点（1. 2. 3.）合并为一个知识点；真正独立的概念必须拆开。
5. description 2-4 句，保留核心定义与关键数值，不得掺入该节点范围外内容。
6. 已存在的知识点（名单已给）不要重复抽取。

输出格式：只输出 JSON 数组，不要输出任何其他内容：
[{"name": "极限的精确定义", "description": "…"}]
```

`user` 改为（`{{section}}` 删除，新增 `{{siblings}}`）：

```
课程：{{courseName}}
当前节点：{{chapter}}
兄弟节点（不得抽取其内容）：{{siblings}}
该节点已有知识点：{{existingKps}}
课程已有知识点（不要重复）：{{courseKps}}

节点正文：
{{text}}
```

`desc` 改「按章节节点抽取知识点（大块输入，建议 128K 以上上下文的模型）」。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run packages/core/src/api/__tests__/prompt.test.ts`
Expected: PASS。再跑 `npx vitest run` 全量——若有引用 `recognize_toc` 的既有测试/代码（`kp.ts` 的 `correctTocWithAi` 在本任务暂保留，任务 6 删除），先确认仅模板 key 删除不破坏编译（`findTaskBinding(data, "recognize_toc", ...)` 是运行时查找，编译无感；`resolvePromptTemplate` 同理）。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/api/promptTemplates.ts packages/core/src/api/__tests__/prompt.test.ts
git commit -m "feat: 提示词模板切换 outline-first——删 recognize_toc，增 recognize_outline/merge_toc，extract_kp 去 section 加兄弟边界"
```

---

### Task 4: 阶段② api/outlineExtract.ts（结构识别）

**Files:**
- Create: `packages/core/src/api/outlineExtract.ts`
- Test: `packages/core/src/api/__tests__/outlineExtract.test.ts`

**Interfaces:**
- Consumes: Task 2 `OutlineNode`/`alignOutlineSpans`；`getData/saveData`、`findTaskBinding`、`resolvePromptTemplate`、`renderPrompt`、`callAi`、`AiCanceledError`、`cancelAiCall`、`startBgTask`、`stripThinkBlocks`（`utils/aiError.ts`，若无则从 `ai.ts` 导出——实现时确认现有 `organizeDocWithAi` 从哪里导入 `stripThinkBlocks`，保持一致）
- Produces:
  - `parseOutlineResponse(content: string): OutlineNode[]`
  - `interface OutlineChunk { index: number; total: number; text: string; bodyStart: number; overlap: boolean }`
  - `buildOutlineChunks(text: string, size?: number, tail?: number): OutlineChunk[]`（默认 size=40000, tail=500）
  - `mergeOutlineNodes(acc: OutlineNode[], next: OutlineNode[]): OutlineNode[]`（去重叠区重复）
  - `runOutlineRecognition(materialId: number, courseId: number, onProgress?: (done: number, total: number) => void, isAborted?: () => boolean): Promise<{ nodes: OutlineNode[]; unlocated: number[] }>`
  - `startOutlineTask(materialId: number, courseId: number): void` / `cancelOutlineTask(materialId: number): void`（bgTask taskType `"outline"`，taskId `material-<id>-outline`；与 `startOrganizeTask` 同模式：模块级 `Set` 防重入 + flag Map + `cancelAiCall("recognize_outline", "material-"+id)`）

- [ ] **Step 1: 写失败测试（纯函数部分）**

`api/__tests__/outlineExtract.test.ts`：

```ts
import { describe, expect, it } from "vitest";
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
    const content = '{"headings": [
      {"text": "第1章 …… 3", "level": 1},
      {"text": "", "level": 1},
      {"text": "第2章", "level": 0},
      {"text": "第3章", "level": 9},
      {"text": "第4章", "level": 1}
    ]}';
    expect(parseOutlineResponse(content)).toEqual([{ text: "第4章", level: 1 }]);
  });
  it("无 JSON 抛错", () => {
    expect(() => parseOutlineResponse("抱歉，我无法处理")).toThrow(/JSON/);
  });
  it("缺 headings 数组抛错", () => {
    expect(() => parseOutlineResponse('{"foo": 1}')).toThrow(/headings/);
  });
  it("节点数上限 400", () => {
    const items = Array.from({ length: 500 }, (_, i) => `{"text": "t${i}", "level": 1}`).join(",");
    expect(parseOutlineResponse(`{"headings": [${items}]}`)).toHaveLength(400);
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
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/core/src/api/__tests__/outlineExtract.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`api/outlineExtract.ts`：

```ts
import { getData, saveData } from "./storage";
import { callAi, AiCanceledError } from "./ai";
import { cancelAiCall } from "./ai";
import { findTaskBinding } from "./taskModel";
import { resolvePromptTemplate, renderPrompt } from "./promptTemplates";
import { startBgTask, type BgTaskHandle } from "./bgTask";
import { alignOutlineSpans, type OutlineNode } from "../utils/outline";
import { stripThinkBlocks } from "../utils/aiError";

const OUTLINE_CHUNK_SIZE = 40000;
const OUTLINE_TAIL_OVERLAP = 500;
const MAX_OUTLINE_NODES = 400;

function asOutlineNode(item: unknown): OutlineNode | null {
  if (typeof item !== "object" || item === null) return null;
  const o = item as Record<string, unknown>;
  const text = typeof o.text === "string" ? o.text.trim() : "";
  const level = Number(o.level);
  if (!text || !Number.isInteger(level) || level < 1 || level > 8) return null;
  if (text.includes("…")) return null; // 目录页点线
  return { text, level };
}

export function parseOutlineResponse(content: string): OutlineNode[] {
  let s = content.trim();
  const fence = s.match(/^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/);
  if (fence) s = fence[1].trim();
  s = stripThinkBlocks(s);
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI 返回的 outline 不是合法 JSON");
  let obj: unknown;
  try {
    obj = JSON.parse(s.slice(start, end + 1));
  } catch {
    throw new Error("AI 返回的 outline 不是合法 JSON");
  }
  const o = obj as { headings?: unknown };
  if (!Array.isArray(o.headings)) throw new Error("AI 返回缺少 headings 数组");
  return o.headings.map(asOutlineNode).filter((n): n is OutlineNode => n !== null).slice(0, MAX_OUTLINE_NODES);
}

export interface OutlineChunk {
  index: number;
  total: number;
  /** 发给 AI 的文本（续段含前段尾部重叠） */
  text: string;
  overlap: boolean;
}

/** 按段落边界切段（段长 ≤ size）；续段文本 = 前段尾 tail 字 + 本段 */
export function buildOutlineChunks(text: string, size = OUTLINE_CHUNK_SIZE, tail = OUTLINE_TAIL_OVERLAP): OutlineChunk[] {
  const paras = text.split(/\n{2,}/);
  const raw: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (cur.length > 0 && cur.length + p.length + 2 > size) {
      raw.push(cur);
      cur = p;
    } else {
      cur = cur ? cur + "\n\n" + p : p;
    }
    while (cur.length > size) {
      raw.push(cur.slice(0, size));
      cur = cur.slice(size);
    }
  }
  if (cur.trim()) raw.push(cur);
  return raw.map((c, i) => {
    if (i === 0) return { index: 0, total: raw.length, text: c, overlap: false };
    return { index: i, total: raw.length, text: raw[i - 1].slice(-tail) + "\n\n" + c, overlap: true };
  });
}

/** 累积合并：丢弃 next 开头与 acc 尾部重复的节点（重叠区双识别） */
export function mergeOutlineNodes(acc: OutlineNode[], next: OutlineNode[]): OutlineNode[] {
  let drop = 0;
  const tail3 = acc.slice(-3);
  while (drop < next.length && tail3.length > 0) {
    const cand = next[drop];
    const last = tail3[tail3.length - 1];
    if (cand.text === last.text && cand.level === last.level) drop++;
    else break;
  }
  return [...acc, ...next.slice(drop)];
}

/** 识别一份资料的 N 级 outline：分段调用 AI → 合并 → 对齐定位 → 落库 Material.outline */
export async function runOutlineRecognition(
  materialId: number,
  courseId: number,
  onProgress?: (done: number, total: number) => void,
  isAborted?: () => boolean,
): Promise<{ nodes: OutlineNode[]; unlocated: number[] }> {
  const data = await getData();
  const binding = findTaskBinding(data, "recognize_outline", courseId);
  if (!binding) throw new Error("未配置「结构识别」模型：请到「模型配置 → 任务模型」为该任务指定模型");
  const tpl = resolvePromptTemplate(data, "recognize_outline");
  const mat = data.materials.find((m) => m.id === materialId);
  if (!mat || !mat.contentText.trim()) throw new Error("资料没有可识别的正文");
  const chunks = buildOutlineChunks(mat.contentText);
  let acc: OutlineNode[] = [];
  for (const chunk of chunks) {
    if (isAborted?.()) throw new AiCanceledError();
    onProgress?.(chunk.index, chunk.total);
    const context = acc.length ? acc.map((h) => `L${h.level} ${h.text}`).join("\n") : "（空，本段是首段）";
    const res = await callAi({
      providerId: binding.providerId,
      modelId: binding.modelId,
      taskKey: "recognize_outline",
      scope: "material-" + materialId,
      messages: [
        { role: "system", content: renderPrompt(tpl.system, {}) },
        { role: "user", content: renderPrompt(tpl.user, { context, chunk: chunk.text }) },
      ],
    });
    acc = mergeOutlineNodes(acc, parseOutlineResponse(res.content));
  }
  const { unlocated } = alignOutlineSpans(mat.contentText, acc);
  const latest = await getData();
  const m2 = latest.materials.find((m) => m.id === materialId);
  if (!m2) throw new Error("资料已在任务期间被删除");
  m2.outline = JSON.stringify(acc);
  m2.outlineStatus = unlocated.length > 0 ? "partial" : "done";
  await saveData(latest);
  onProgress?.(chunks.length, chunks.length);
  return { nodes: acc, unlocated };
}

// 后台任务（与 startOrganizeTask 同模式）
const outliningMaterialIds = new Set<number>();
const outlineAbortFlags = new Map<number, { aborted: boolean }>();

export function startOutlineTask(materialId: number, courseId: number): void {
  if (outliningMaterialIds.has(materialId)) return;
  outliningMaterialIds.add(materialId);
  const flag = { aborted: false };
  outlineAbortFlags.set(materialId, flag);
  const task: BgTaskHandle = startBgTask({
    taskId: `material-${materialId}-outline`,
    taskType: "outline",
    label: "结构识别",
    materialId,
    courseId,
    message: "准备中…",
  });
  void (async () => {
    try {
      const r = await runOutlineRecognition(
        materialId, courseId,
        (done, total) => task.progress({ done, total, message: `识别中：第 ${Math.min(done + 1, total)}/${total} 段…` }),
        () => flag.aborted,
      );
      if (flag.aborted) { task.canceled(); return; }
      const msg = r.unlocated.length > 0
        ? `识别完成：${r.nodes.length} 个标题，${r.unlocated.length} 个未能定位（不影响抽取，预览可查看）`
        : `识别完成：${r.nodes.length} 个标题`;
      task.done(msg);
    } catch (e) {
      if (e instanceof AiCanceledError || flag.aborted) task.canceled();
      else task.fail(e, "结构识别失败");
    } finally {
      outliningMaterialIds.delete(materialId);
      outlineAbortFlags.delete(materialId);
    }
  })();
}

export function cancelOutlineTask(materialId: number): void {
  const flag = outlineAbortFlags.get(materialId);
  if (flag) flag.aborted = true;
  cancelAiCall("recognize_outline", "material-" + materialId);
}
```

实现前核对两处：`bgTask.ts` 的 `startBgTask` 返回类型名（`BgTaskHandle` 或别的）与 `task.progress/done/fail/canceled` 方法名、`stripThinkBlocks` 的实际导出位置——以 `material.ts` 中 `runOrganizeTask`/`organizeDocWithAi` 的现有 import 为准，若 `stripThinkBlocks` 未从 `utils/aiError.ts` 导出则改从 `ai.ts` 导入（两处 import 合并）。

- [ ] **Step 4: 跑测试确认通过 + 类型检查**

Run: `npx vitest run packages/core/src/api/__tests__/outlineExtract.test.ts && npx vue-tsc --noEmit -p packages/core/tsconfig.json`
Expected: PASS / 无错误

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/api/outlineExtract.ts packages/core/src/api/__tests__/outlineExtract.test.ts
git commit -m "feat: 阶段② 结构识别——recognize_outline 分段识别 N 级 outline + span 对齐 + 后台任务"
```

---

### Task 5: 阶段③ api/tocMerge.ts（跨资料语义合并）

**Files:**
- Create: `packages/core/src/api/tocMerge.ts`
- Test: `packages/core/src/api/__tests__/tocMerge.test.ts`

**Interfaces:**
- Consumes: Task 4 `runOutlineRecognition`；Task 2 `OutlineNode`/`buildOutlineTree`；Task 1 `Chapter`/`Material`/`TocMapping`；`getData`、`callAi` 等基建同 Task 4
- Produces:
  - `interface MergeNode { id: number; parent: number | null; name: string; variants: string[]; chapterId: number | null }`（id=数组下标；`chapterId`=对应既有章节 id，新节点为 null）
  - `interface RawMapping { materialIdx: number; materialSeq: number; nodeId: number }`
  - `interface MergeResult { nodes: MergeNode[]; mappings: RawMapping[]; failed: { materialName: string; reason: string; outline: OutlineNode[] }[] }`
  - `seedNodesFromChapters(chapters: Chapter[], courseId: number): MergeNode[]`
  - `parseMergeResponse(content: string, inputCount: number, outlineCount: number): { nodes: { id: number; parent: number | null; name: string; variants: string[] }[]; mapping: { seq: number; node: number }[] }`
  - `mergeCourseToc(courseId: number, materialIds?: number[], onProgress?: (done: number, total: number) => void, isAborted?: () => boolean): Promise<MergeResult>`
  - `startTocMergeTask(courseId: number, materialIds?: number[]): void` / `cancelTocMergeTask(courseId: number): void`（bgTask taskType `"toc"`，taskId `course-<id>-toc`；完成后 `useModalStore().openChapterPreview(courseId, result, null, 资料数)`——签名 Task 8 改，本任务先按现有 `openChapterPreview(courseId, headings, source, count)` 的**占位调用**写：`void result` + `task.done(msg)`，Task 8 替换为真正弹窗）

- [ ] **Step 1: 写失败测试（纯函数部分）**

`api/__tests__/tocMerge.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import type { Chapter } from "../../api";
import { parseMergeResponse, seedNodesFromChapters, splitOutlineForMerge } from "../tocMerge";
import type { OutlineNode } from "../../utils/outline";

function ch(id: number, parentId: number | null, level: number, sort: number, name = `n${id}`): Chapter {
  return { id, courseId: 1, parentId, siyuanBlockId: null, name, level, sort };
}

describe("seedNodesFromChapters", () => {
  it("既有章节树 → MergeNode（id 重排为下标，chapterId 保留原 id）", () => {
    const nodes = seedNodesFromChapters([ch(11, null, 1, 1, "第一章"), ch(12, 11, 2, 1, "1.1")], 1);
    expect(nodes).toEqual([
      { id: 0, parent: null, name: "第一章", variants: [], chapterId: 11 },
      { id: 1, parent: 0, name: "1.1", variants: [], chapterId: 12 },
    ]);
  });
  it("空课程返回空数组", () => {
    expect(seedNodesFromChapters([], 1)).toEqual([]);
  });
});

const input3 = '{"nodes": [
  {"id": 0, "parent": null, "name": "第一章", "variants": []},
  {"id": 1, "parent": 0, "name": "1.1", "variants": []},
  {"id": 2, "parent": 0, "name": "1.2", "variants": ["1.2 运算"]}
], "mappings": [{"seq": 0, "node": 0}, {"seq": 1, "node": 1}, {"seq": 2, "node": 2}]}';

describe("parseMergeResponse", () => {
  it("合法输出原样解析", () => {
    const r = parseMergeResponse(input3, 2, 3);
    expect(r.nodes).toHaveLength(3);
    expect(r.nodes[2].variants).toEqual(["1.2 运算"]);
    expect(r.mapping).toHaveLength(3);
  });
  it("丢失输入节点 → 抛错", () => {
    const bad = '{"nodes": [{"id": 0, "parent": null, "name": "第一章", "variants": []}], "mappings": []}';
    expect(() => parseMergeResponse(bad, 2, 3)).toThrow(/节点/);
  });
  it("新增节点 id 必须 ≥ 输入数且连续", () => {
    const ok = '{"nodes": [
      {"id": 0, "parent": null, "name": "a", "variants": []},
      {"id": 1, "parent": 0, "name": "b", "variants": []},
      {"id": 2, "parent": null, "name": "新章", "variants": []}
    ], "mappings": []}';
    expect(parseMergeResponse(ok, 2, 1).nodes).toHaveLength(3);
    const gap = '{"nodes": [
      {"id": 0, "parent": null, "name": "a", "variants": []},
      {"id": 1, "parent": 0, "name": "b", "variants": []},
      {"id": 5, "parent": null, "name": "新章", "variants": []}
    ], "mappings": []}';
    expect(() => parseMergeResponse(gap, 2, 1)).toThrow(/id/);
  });
  it("parent 悬空 / 成环 / 空名 → 抛错", () => {
    const dangling = '{"nodes": [
      {"id": 0, "parent": null, "name": "a", "variants": []},
      {"id": 1, "parent": 9, "name": "b", "variants": []}
    ], "mappings": []}';
    expect(() => parseMergeResponse(dangling, 2, 1)).toThrow(/parent/);
    const cycle = '{"nodes": [
      {"id": 0, "parent": 1, "name": "a", "variants": []},
      {"id": 1, "parent": 0, "name": "b", "variants": []}
    ], "mappings": []}';
    expect(() => parseMergeResponse(cycle, 2, 1)).toThrow(/环/);
    const emptyName = '{"nodes": [
      {"id": 0, "parent": null, "name": "  ", "variants": []}
    ], "mappings": []}';
    expect(() => parseMergeResponse(emptyName, 1, 1)).toThrow(/name/);
  });
  it("mappings 越界 → 抛错；合法省略（无法归属）允许", () => {
    const out = '{"nodes": [
      {"id": 0, "parent": null, "name": "a", "variants": []}
    ], "mappings": [{"seq": 5, "node": 0}]}';
    expect(() => parseMergeResponse(out, 1, 3)).toThrow(/seq/);
    const omit = '{"nodes": [
      {"id": 0, "parent": null, "name": "a", "variants": []}
    ], "mappings": []}';
    expect(parseMergeResponse(omit, 1, 3).mapping).toEqual([]);
  });
});

describe("splitOutlineForMerge", () => {
  it("≤150 节点单片", () => {
    const outline: OutlineNode[] = Array.from({ length: 150 }, (_, i) => ({ text: `t${i}`, level: (i % 3) + 1 }));
    expect(splitOutlineForMerge(outline)).toEqual([{ start: 0, nodes: outline }]);
  });
  it(">150 按顶层边界拆成 ≤150 的连续片", () => {
    const outline: OutlineNode[] = [];
    for (let c = 0; c < 3; c++) {
      outline.push({ text: `章${c}`, level: 1 });
      for (let s = 0; s < 80; s++) outline.push({ text: `${c}.${s}`, level: 2 });
    }
    const parts = splitOutlineForMerge(outline);
    expect(parts.length).toBeGreaterThanOrEqual(2);
    for (const p of parts) expect(p.nodes.length).toBeLessThanOrEqual(150);
    // 连续性：片间无缝无交
    let cursor = 0;
    for (const p of parts) {
      expect(p.start).toBe(cursor);
      cursor += p.nodes.length;
    }
    expect(cursor).toBe(outline.length);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/core/src/api/__tests__/tocMerge.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`api/tocMerge.ts`：

```ts
import { getData } from "./storage";
import { callAi, AiCanceledError } from "./ai";
import { cancelAiCall } from "./ai";
import { findTaskBinding } from "./taskModel";
import { resolvePromptTemplate, renderPrompt } from "./promptTemplates";
import { startBgTask, type BgTaskHandle } from "./bgTask";
import { queryMaterials } from "./material";
import { runOutlineRecognition } from "./outlineExtract";
import type { OutlineNode } from "../utils/outline";
import type { Chapter, Material } from "../types/appData";

const MAX_OUTLINE_PER_CALL = 150;

export interface MergeNode {
  /** 数组下标 */
  id: number;
  parent: number | null;
  name: string;
  variants: string[];
  /** 对应既有章节 id；新节点为 null */
  chapterId: number | null;
}

export interface RawMapping {
  materialIdx: number;
  /** 资料 outline 内节点序号（全局，非分片局部） */
  materialSeq: number;
  nodeId: number;
}

export interface MergeResult {
  nodes: MergeNode[];
  mappings: RawMapping[];
  failed: { materialName: string; reason: string; outline: OutlineNode[] }[];
}

/** 既有课程章节树 → 合并种子（id 重排为下标，保持 sort 序与父子关系） */
export function seedNodesFromChapters(chapters: Chapter[], courseId: number): MergeNode[] {
  const ofCourse = chapters
    .filter((c) => c.courseId === courseId)
    .sort((a, b) => a.sort - b.sort);
  const byId = new Map(ofCourse.map((c) => [c.id, c]));
  const out: MergeNode[] = [];
  const indexByChapter = new Map<number, number>();
  // 按深度递增处理，保证父先于子入列
  const sorted = [...ofCourse].sort((a, b) => depth(byId, a) - depth(byId, b));
  for (const ch of sorted) {
    const parentIdx = ch.parentId === null ? null : indexByChapter.get(ch.parentId) ?? null;
    indexByChapter.set(ch.id, out.length);
    out.push({ id: out.length, parent: parentIdx, name: ch.name, variants: [], chapterId: ch.id });
  }
  // 孤儿（parentId 指向已删节点）按 sort 排到同级末尾已由上面处理；重排 id 为下标
  return out;
}

function depth(byId: Map<number, Chapter>, ch: Chapter): number {
  let d = 1;
  let p = ch.parentId;
  let guard = 0;
  while (p !== null && byId.has(p) && guard++ < 16) {
    d++;
    p = byId.get(p)!.parentId;
  }
  return d;
}

export interface ParsedMerge {
  nodes: { id: number; parent: number | null; name: string; variants: string[] }[];
  mapping: { seq: number; node: number }[];
}

export function parseMergeResponse(content: string, inputCount: number, outlineCount: number): ParsedMerge {
  let s = content.trim();
  const fence = s.match(/^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI 返回的合并结果不是合法 JSON");
  let obj: unknown;
  try {
    obj = JSON.parse(s.slice(start, end + 1));
  } catch {
    throw new Error("AI 返回的合并结果不是合法 JSON");
  }
  const o = obj as { nodes?: unknown; mappings?: unknown };
  if (!Array.isArray(o.nodes)) throw new Error("AI 返回缺少 nodes 数组");
  const nodes: ParsedMerge["nodes"] = [];
  const seen = new Set<number>();
  for (const item of o.nodes) {
    if (typeof item !== "object" || item === null) throw new Error("AI 返回 nodes 含非法项");
    const n = item as Record<string, unknown>;
    const id = Number(n.id);
    const name = typeof n.name === "string" ? n.name.trim() : "";
    if (!Number.isInteger(id) || seen.has(id)) throw new Error(`AI 返回节点 id 非法或重复：${id}`);
    if (!name) throw new Error("AI 返回节点存在空 name");
    seen.add(id);
    const variants = Array.isArray(n.variants)
      ? (n.variants as unknown[]).filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim())
      : [];
    nodes.push({ id, parent: n.parent === null ? null : Number(n.parent), name, variants });
  }
  // 输入节点全部保留；新节点 id 从 inputCount 起连续
  for (let i = 0; i < inputCount; i++) {
    if (!seen.has(i)) throw new Error(`AI 返回丢失输入节点 id=${i}`);
  }
  const newIds = [...seen].filter((id) => id >= inputCount).sort((a, b) => a - b);
  for (let k = 0; k < newIds.length; k++) {
    if (newIds[k] !== inputCount + k) throw new Error("AI 返回新增节点 id 必须从输入总数起连续");
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // parent 合法性 + 无环（沿 parent 链 ≤8 步必须到顶层）
  for (const n of nodes) {
    if (n.parent !== null && (!Number.isInteger(n.parent) || !byId.has(n.parent))) {
      throw new Error(`AI 返回节点 parent 悬空：id=${n.id} parent=${n.parent}`);
    }
    let cur: ParsedMerge["nodes"][number] | undefined = n;
    let guard = 0;
    while (cur && cur.parent !== null && guard++ < 8) cur = byId.get(cur.parent);
    if (cur && cur.parent !== null) throw new Error(`AI 返回节点 parent 成环：id=${n.id}`);
  }
  // mappings
  const mapping: ParsedMerge["mapping"] = [];
  if (o.mappings !== undefined) {
    if (!Array.isArray(o.mappings)) throw new Error("AI 返回 mappings 不是数组");
    const seenSeq = new Set<number>();
    for (const item of o.mappings as unknown[]) {
      if (typeof item !== "object" || item === null) throw new Error("AI 返回 mappings 含非法项");
      const m = item as Record<string, unknown>;
      const seq = Number(m.seq);
      const node = Number(m.node);
      if (!Number.isInteger(seq) || seq < 0 || seq >= outlineCount) throw new Error(`AI 返回 mapping seq 越界：${seq}`);
      if (!Number.isInteger(node) || !seen.has(node)) throw new Error(`AI 返回 mapping node 不存在：${node}`);
      if (seenSeq.has(seq)) throw new Error(`AI 返回 mapping seq 重复：${seq}`);
      seenSeq.add(seq);
      mapping.push({ seq, node });
    }
  }
  return { nodes, mapping };
}

/** 大 outline 按顶层（level 1）边界拆成 ≤MAX_OUTLINE_PER_CALL 的连续片 */
export function splitOutlineForMerge(outline: OutlineNode[]): { start: number; nodes: OutlineNode[] }[] {
  if (outline.length <= MAX_OUTLINE_PER_CALL) return [{ start: 0, nodes: outline }];
  const parts: { start: number; nodes: OutlineNode[] }[] = [];
  let start = 0;
  for (let i = MAX_OUTLINE_PER_CALL; i < outline.length; i++) {
    if (outline[i].level === 1) {
      parts.push({ start, nodes: outline.slice(start, i) });
      start = i;
    }
  }
  parts.push({ start, nodes: outline.slice(start) });
  return parts;
}

function outlineToJson(material: Material): OutlineNode[] {
  if (!material.outline) return [];
  try {
    const v: unknown = JSON.parse(material.outline);
    return Array.isArray(v)
      ? v.filter((x): x is OutlineNode => typeof x === "object" && x !== null && typeof (x as OutlineNode).text === "string")
      : [];
  } catch {
    return [];
  }
}

/**
 * 逐资料顺序语义合并。种子=现有课程树（幂等/增量）；
 * 资料无 outline 时先跑阶段②；>150 节点拆片顺序合；单资料失败不阻塞其他。
 */
export async function mergeCourseToc(
  courseId: number,
  materialIds?: number[],
  onProgress?: (done: number, total: number) => void,
  isAborted?: () => boolean,
): Promise<MergeResult> {
  const data = await getData();
  const binding = findTaskBinding(data, "merge_toc", courseId);
  if (!binding) throw new Error("未配置「目录合并」模型：请到「模型配置 → 任务模型」为该任务指定模型");
  const tpl = resolvePromptTemplate(data, "merge_toc");
  const course = data.courses.find((c) => c.id === courseId);
  if (!course) throw new Error("课程不存在或已删除");
  let mats = queryMaterials(courseId);
  if (materialIds) mats = mats.filter((m) => materialIds.includes(m.id));
  if (mats.length === 0) throw new Error("课程还没有资料，无法合并目录");

  let nodes = seedNodesFromChapters(data.chapters, courseId);
  const mappings: RawMapping[] = [];
  const failed: MergeResult["failed"] = [];

  for (let i = 0; i < mats.length; i++) {
    if (isAborted?.()) throw new AiCanceledError();
    onProgress?.(i, mats.length);
    const mat = mats[i];
    try {
      let outline = outlineToJson(mat);
      if (outline.length === 0) {
        const r = await runOutlineRecognition(mat.id, courseId, undefined, isAborted);
        if (isAborted?.()) throw new AiCanceledError();
        outline = r.nodes;
      }
      for (const part of splitOutlineForMerge(outline)) {
        const treeText = nodes.length
          ? nodes.map((n) => `L${levelOf(nodes, n.id)} ${n.name}`).join("\n")
          : "（空，课程还没有章节树）";
        const outlineText = part.nodes.map((h, j) => `[${part.start + j}] L${h.level} ${h.text}`).join("\n");
        const res = await callAi({
          providerId: binding.providerId,
          modelId: binding.modelId,
          taskKey: "merge_toc",
          scope: `course-${courseId}`,
          messages: [
            { role: "system", content: renderPrompt(tpl.system, {}) },
            { role: "user", content: renderPrompt(tpl.user, { tree: treeText, materialName: mat.name, outline: outlineText }) },
          ],
        });
        const parsed = parseMergeResponse(res.content, nodes.length, part.nodes.length);
        // chapterId 侧信道：旧 id 继承，新 id 为 null
        const oldById = new Map(nodes.map((n) => [n.id, n.chapterId]));
        nodes = parsed.nodes.map((n) => ({ ...n, chapterId: oldById.has(n.id) ? (oldById.get(n.id) ?? null) : null }));
        for (const mp of parsed.mapping) {
          mappings.push({ materialIdx: i, materialSeq: part.start + mp.seq, nodeId: mp.node });
        }
      }
    } catch (e) {
      if (e instanceof AiCanceledError) throw e;
      failed.push({ materialName: mat.name, reason: e instanceof Error ? e.message : String(e), outline: outlineToJson(mat) });
    }
  }
  onProgress?.(mats.length, mats.length);
  return { nodes, mappings, failed };
}

function levelOf(nodes: MergeNode[], id: number): number {
  let d = 1;
  let cur: MergeNode | undefined = nodes[id];
  let guard = 0;
  while (cur && cur.parent !== null && guard++ < 8) {
    d++;
    cur = nodes[cur.parent];
  }
  return d;
}

// 后台任务
let tocMerging = false;
const tocAbortFlag: { aborted: boolean } = { aborted: false };

export function startTocMergeTask(courseId: number, materialIds?: number[]): void {
  if (tocMerging) return;
  tocMerging = true;
  tocAbortFlag.aborted = false;
  const task: BgTaskHandle = startBgTask({
    taskId: `course-${courseId}-toc`,
    taskType: "toc",
    courseId,
    message: "准备中…",
  });
  void (async () => {
    try {
      const result = await mergeCourseToc(
        courseId, materialIds,
        (done, total) => task.progress({ done, total, message: `合并目录：资料 ${Math.min(done + 1, total)}/${total}…` }),
        () => tocAbortFlag.aborted,
      );
      if (tocAbortFlag.aborted) { task.canceled(); return; }
      // 预览弹窗在 Task 8 接入 openChapterPreview；本任务先只完成合并落库前预览由调用方处理
      const latest = await getData();
      const count = latest.materials.filter((m) => m.courseId === courseId).length;
      void result; void count;
      const msg = result.failed.length > 0
        ? `目录合并完成，${result.failed.length} 份资料失败：${result.failed.map((f) => f.materialName).join("、")}`
        : "目录合并完成";
      task.done(msg);
      window.dispatchEvent(new CustomEvent("siyuan-ai-study:toc-merged", { detail: { courseId, result } }));
    } catch (e) {
      if (e instanceof AiCanceledError || tocAbortFlag.aborted) task.canceled();
      else task.fail(e, "目录合并失败");
    } finally {
      tocMerging = false;
    }
  })();
}

export function cancelTocMergeTask(courseId: number): void {
  tocAbortFlag.aborted = true;
  cancelAiCall("merge_toc", `course-${courseId}`);
}
```

说明：`startTocMergeTask` 完成时派发 `siyuan-ai-study:toc-merged` 自定义事件（detail 带 `courseId` 与 `MergeResult`），Task 8 在弹窗组件里监听该事件打开预览——避免 tocMerge 反向 import stores/modal（保持 api 层不依赖组件层，与现有 `DATA_SAVED_EVENT` 模式一致）。

- [ ] **Step 4: 跑测试确认通过 + 类型检查**

Run: `npx vitest run packages/core/src/api/__tests__/tocMerge.test.ts && npx vue-tsc --noEmit -p packages/core/tsconfig.json`
Expected: PASS / 无错误

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/api/tocMerge.ts packages/core/src/api/__tests__/tocMerge.test.ts
git commit -m "feat: 阶段③ 目录语义合并——逐资料合并规范树+映射，拆片/失败隔离/种子幂等"
```

---

### Task 6: 落库 importChapterTree N 级 + tocMappings + 删旧 toc 流

**Files:**
- Modify: `packages/core/src/api/kp.ts`（`importChapterTree`/`createChapter`/`matchChapterForKp`/`relinkCourseKps`/`deleteChapters`；删 `aggregateCourseToc`/`correctTocWithAi`）
- Modify: `packages/core/src/api/material.ts`（`deleteMaterial` 级联 tocMappings；`runOrganizeTask` 自动链改走 `startTocMergeTask`）
- Modify: `packages/core/src/api/course.ts`（`deleteCourse` 级联 tocMappings——实现时确认课程删除级联处，与 materialChapters 同处加）
- Test: `packages/core/src/api/__tests__/kp.test.ts`（追加 N 级用例）

**Interfaces:**
- Consumes: Task 1 类型；Task 5 `MergeResult`/`RawMapping`/`MergeNode`；Task 2 `buildOutlineTree`/`nodePathOf`
- Produces:
  - `importChapterTree(courseId: number, nodes: ChapterTreeNode[], toc?: { result: MergeResult; materials: Material[] }): Promise<{ created: number; moved: number; linked: number; stuck: number }>`（`ChapterTreeNode.level` 已是 number；`toc` 省略=仅章节树，不写映射）
  - 映射落库规则：`materialPath = nodePathOf(material.outline 节点, materialSeq)`；同 (materialId, materialPath) 幂等去重；课程级替换（先删该课程旧映射再写新）
  - `createChapter`：level≥3 不调 `persistDocIfEnabled`（`siyuanBlockId=null`）
  - `matchChapterForKp`：N 级匹配（chapterName/sectionName 对任意深度节点，取最深匹配）

- [ ] **Step 1: 写失败测试**

`api/__tests__/kp.test.ts` 追加（沿用文件内既有假桥 + `createEmptyData` 模式）：

```ts
it("importChapterTree：N 级幂等导入（重复导入不建重）", async () => {
  // 准备课程 1；两次导入相同三节点树（1 章 1 节 1 小节）
  const nodes1 = [
    { name: "第一章", level: 1, parentName: null },
    { name: "1.1 节", level: 2, parentName: "第一章" },
    { name: "1.1.1 小节", level: 3, parentName: "1.1 节" },
  ];
  const r1 = await importChapterTree(1, nodes1);
  const r2 = await importChapterTree(1, nodes1);
  expect(r1.created).toBe(3);
  expect(r2.created).toBe(0);
  const d = await getData();
  const chs = d.chapters.filter((c) => c.courseId === 1);
  expect(chs).toHaveLength(3);
  const top = chs.find((c) => c.name === "第一章")!;
  const unit = chs.find((c) => c.name === "1.1 节")!;
  const sub = chs.find((c) => c.name === "1.1.1 小节")!;
  expect(unit.parentId).toBe(top.id);
  expect(sub.parentId).toBe(unit.id);
  expect(sub.level).toBe(3);
});

it("importChapterTree：深度≥3 不建思源文档，≤2 建", async () => {
  const persistIds: string[] = [];
  setBridge(makeFakeBridgeWithDocs(persistIds)); // 假桥记录 createDoc 调用
  await importChapterTree(1, [
    { name: "第一章", level: 1, parentName: null },
    { name: "1.1 节", level: 2, parentName: "第一章" },
    { name: "1.1.1 小节", level: 3, parentName: "1.1 节" },
  ]);
  expect(persistIds).toHaveLength(2); // 仅章与节
});

it("importChapterTree：写 tocMappings（替换式，materialPath 用 outline 路径）", async () => {
  // 资料 10 outline：[第1章 L1, 1.1 L2]；MergeResult 映射 seq0→节点0, seq1→节点1
  await importChapterTree(1, [
    { name: "第一章", level: 1, parentName: null },
    { name: "1.1", level: 2, parentName: "第一章" },
  ], { result: mergeFixture(), materials: [matFixture()] });
  const d = await getData();
  expect(d.tocMappings).toHaveLength(2);
  expect(d.tocMappings[0].materialPath).toBe("第一章");
  expect(d.tocMappings[1].materialPath).toBe("第一章>1.1");
  // 重复导入不翻倍
  await importChapterTree(1, [
    { name: "第一章", level: 1, parentName: null },
    { name: "1.1", level: 2, parentName: "第一章" },
  ], { result: mergeFixture(), materials: [matFixture()] });
  const d2 = await getData();
  expect(d2.tocMappings).toHaveLength(2);
});

it("deleteChapters 级联删 tocMappings", async () => {
  // 建章+写映射后删章，映射清空
});
```

fixture 构造（同文件内）：

```ts
function matFixture(): Material {
  return {
    id: 10, courseId: 1, name: "教材A", fileType: "txt", assetPath: null,
    contentText: "第一章\n正文\n1.1\n正文2",
    headings: "[]", siyuanDocId: null, createTime: "2026-01-01T00:00:00Z",
    outline: JSON.stringify([{ text: "第一章", level: 1 }, { text: "1.1", level: 2 }]),
    outlineStatus: "done",
  };
}
function mergeFixture(): MergeResult {
  return {
    nodes: [
      { id: 0, parent: null, name: "第一章", variants: [], chapterId: null },
      { id: 1, parent: 0, name: "1.1", variants: [], chapterId: null },
    ],
    mappings: [
      { materialIdx: 0, materialSeq: 0, nodeId: 0 },
      { materialIdx: 0, materialSeq: 1, nodeId: 1 },
    ],
    failed: [],
  };
}
```

（`Material` 必填字段以 `types/appData.ts` 实际定义为准补全；`makeFakeBridgeWithDocs` 若无则在测试内新建：`createDoc` 记录调用并返回假 id。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/core/src/api/__tests__/kp.test.ts`
Expected: 新用例 FAIL（level 3 仍建文档 / 无 tocMappings 写入）

- [ ] **Step 3: 实现**

`kp.ts` 改动：

1. `ChapterTreeNode.level`：已是 `number`（Task 1 类型联动）。`importChapterTree` 主体逻辑不变（幂等 create/relink/remap + `relinkCourseKps`），新增可选参数：

```ts
export async function importChapterTree(
  courseId: number,
  nodes: ChapterTreeNode[],
  toc?: { result: MergeResult; materials: Material[] },
): Promise<{ created: number; moved: number; linked: number; stuck: number }> {
```

落库前（现有 `saveData` 之前）追加映射写入：

```ts
if (toc) {
  const pathOf = (material: Material, seq: number): string => nodePathOf(outlineOf(material), seq);
  const nextMappings = data.tocMappings.filter((m) => m.courseId !== courseId);
  const seen = new Set<string>();
  let mid = data.tocMappings.reduce((mx, m) => Math.max(mx, m.id), 0) + 1;
  for (const rm of toc.result.mappings) {
    const material = toc.materials[rm.materialIdx];
    if (!material) continue;
    const path = pathOf(material, rm.materialSeq);
    const key = `${material.id}:${path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    nextMappings.push({ id: mid++, materialId: material.id, courseId, materialPath: path, chapterId: nodeIdToChapter.get(rm.nodeId)! });
  }
  data.tocMappings = nextMappings;
}
```

（`outlineOf(material)` = JSON.parse(material.outline ?? "[]")；`nodeIdToChapter` 是 `importChapterTree` 内部「节点索引 → 新建/既有 chapterId」的映射，实现时从现有 create/relink 循环收集。）

2. `createChapter`（及其内部建章函数）：`persistDocIfEnabled` 调用加条件 `if (level <= 2)`；level≥3 时 `siyuanBlockId: null`。
3. `matchChapterForKp`：现有两级匹配改为遍历任意深度节点（`normalizeChapterRef` 比较 chapterName 与 sectionName 字段对 `ch.name`；多个命中取 `nearestDocAncestorId` 链上最深者），返回类型不变。
4. `deleteChapters`：删除章节集合 `deletedIds` 后追加 `data.tocMappings = data.tocMappings.filter((m) => !deletedIds.has(m.chapterId));`
5. **删除** `aggregateCourseToc` 与 `correctTocWithAi` 两个函数（含 `recognize_toc` 相关 import/引用）。
6. `material.ts`：
   - `deleteMaterial`：追加 `data.tocMappings = data.tocMappings.filter((m) => m.materialId !== materialId);`
   - `runOrganizeTask` 末尾自动预览段（现 `aggregateCourseToc` + `openChapterPreview`）替换为：

```ts
if (latest.settings.chapterMode === "auto" && !otherOrganizing) {
  orgTask?.done(msg); // 梳理任务先结项
  startTocMergeTask(courseId, [materialId]); // 结构识别（自动补跑）+ 语义合并 → 完成后弹窗（Task 8）
  return;
}
```

（`import { startTocMergeTask } from "./tocMerge";` 顶部静态导入即可，无环：tocMerge → material(queryMaterials) → 不 import outlineExtract 以外的反向依赖；若出现循环 import，改在 `runOrganizeTask` 内动态 `await import("./tocMerge")`，与本文件现有 `await import("../utils/documentParser")` 模式一致。）
7. `course.ts` 课程删除级联处（与 `materialChapters` 删除同位置）追加 `tocMappings` 按 `courseId` 过滤删除。

- [ ] **Step 4: 跑测试 + 类型检查（此时 Topbar/UploadMaterialModal/CourseContentView 还有 aggregateCourseToc 引用会编译失败——本任务内一并替换）**

三个调用点替换（均为「打开目录预览」语义）：
- `components/Topbar.vue:206-207`（任务铃铛点开的目录任务）：`startTocMergeTask(t.courseId)`（该铃铛项本身即 toc 任务，Task 5 已产生；此处改为直接监听 `toc-merged` 事件或保持占位——**以 Task 8 的统一事件方案为准**，本任务先替换为 `startTocMergeTask(t.courseId)` 保证可编译）
- `components/UploadMaterialModal.vue:310-311`（未启用 AI 梳理分支）：`startTocMergeTask(courseId)`
- `views/CourseContentView.vue:794-805`（「重新识别目录」按钮）：`startTocMergeTask(currentCourseId())`

Run: `npx vue-tsc --noEmit -p packages/siyuan/tsconfig.json && npx vue-tsc --noEmit -p packages/core/tsconfig.json && npx vitest run`
Expected: 全绿

- [ ] **Step 5: 提交**

```bash
git add -u packages/core/src
git commit -m "feat: 目录落库 N 级化——importChapterTree 写 tocMappings/深度≥3 不建文档/级联删，删旧两级 toc 流"
```

---

### Task 7: 阶段④ api/nodeExtract.ts（按规范节点抽取）

**Files:**
- Create: `packages/core/src/api/nodeExtract.ts`
- Modify: `packages/core/src/api/extract.ts`（`extractKnowledgePoints` 内部改调 nodeExtract；删 `chunkByChapters` 依赖与 `section→unit` 挂接逻辑；`startExtractTask`/`startBatchExtractTask` 对外签名不变）
- Test: `packages/core/src/api/__tests__/nodeExtract.test.ts`

**Interfaces:**
- Consumes: Task 1 `TocMapping`；Task 2 `alignOutlineSpans`/`buildChapterTree`/`chapterPathText`/`nodePathOf`；`extractState.ts` 并发锁；`createKnowledgePoint` 既有写入路径（`extract.ts` 现有 KP 创建函数，保持复用）
- Produces:
  - `resolveExtractNodes(data: AppData, materialIds: number[]): number[]`（返回 node chapterId 列表：被这些资料映射覆盖、且尚无 KP 的节点，按章节树文档序）
  - `buildNodeText(data: AppData, nodeId: number): { text: string; materialIds: number[] }`（资料自然序拼接该节点映射 span 文本；未定位 span 跳过）
  - `extractNodeKps(courseId: number, nodeId: number, onProgress?: (done: number, total: number) => void, isAborted?: () => boolean): Promise<{ created: number; skippedDup: number }>`
  - `extractMaterialNodes(courseId: number, materialIds: number[], onProgress?: (done: number, total: number, nodePath: string) => void, isAborted?: () => boolean): Promise<{ nodeTotal: number; nodeDone: number; created: number }>`
  - 单节点正文 >60000 字：节点内顺序分片多次调用（每片带「本节点正文第 i/N 片」提示），结果合并后统一去重

- [ ] **Step 1: 写失败测试**

`api/__tests__/nodeExtract.test.ts`（假桥模式；KP 写入走真实 `saveData` 假桥，AI 响应由假桥 `callAi` 返回固定 JSON）：

```ts
import { describe, expect, it } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import type { AppData } from "../../types/appData";
import { createEmptyData } from "../../types/appData";
import { setBridge } from "../../bridge";
import { buildNodeText, resolveExtractNodes } from "../nodeExtract";

// fixture：课程 1；章 1（level1）→ 节 2（level2）→ 小节 3（level3）
// 资料 10 outline: [第一章 L1, 1.1 L2, 1.1.1 L3, 第二章 L1]
// 映射: 10@第一章→1, 10@第一章>1.1→2, 10@第一章>1.1>1.1.1→3, 10@第二章→4
// 资料 11 outline: [第一章 L1, 1.1 L2]  映射: 11@第一章→1, 11@第一章>1.1→2
// 节点 1 已有 KP（chapterId=1）
function fixture(): AppData {
  const d = createEmptyData();
  d.courses = [{ id: 1, siyuanDocId: null, name: "C", description: "", target: "", totalCycle: "", status: "active", createTime: "t", modelId: 1 }];
  d.chapters = [
    { id: 1, courseId: 1, parentId: null, siyuanBlockId: null, name: "第一章", level: 1, sort: 1 },
    { id: 2, courseId: 1, parentId: 1, siyuanBlockId: null, name: "1.1", level: 2, sort: 1 },
    { id: 3, courseId: 1, parentId: 2, siyuanBlockId: null, name: "1.1.1", level: 3, sort: 1 },
    { id: 4, courseId: 1, parentId: null, siyuanBlockId: null, name: "第二章", level: 1, sort: 2 },
  ];
  const base = {
    id: 0, courseId: 1, name: "", fileType: "txt", assetPath: null,
    contentText: "", headings: "[]", siyuanDocId: null, createTime: "t",
    outline: "[]", outlineStatus: "done" as const,
  };
  d.materials = [
    { ...base, id: 10, name: "教材A", contentText: "第一章\n甲\n1.1\n乙\n1.1.1\n丙\n第二章\n丁" },
    { ...base, id: 11, name: "教材B", contentText: "第一章\n甲2\n1.1\n乙2" },
  ];
  d.materials[0].outline = JSON.stringify([
    { text: "第一章", level: 1 }, { text: "1.1", level: 2 },
    { text: "1.1.1", level: 3 }, { text: "第二章", level: 1 },
  ]);
  d.materials[1].outline = JSON.stringify([
    { text: "第一章", level: 1 }, { text: "1.1", level: 2 },
  ]);
  d.tocMappings = [
    { id: 1, materialId: 10, courseId: 1, materialPath: "第一章", chapterId: 1 },
    { id: 2, materialId: 10, courseId: 1, materialPath: "第一章>1.1", chapterId: 2 },
    { id: 3, materialId: 10, courseId: 1, materialPath: "第一章>1.1>1.1.1", chapterId: 3 },
    { id: 4, materialId: 10, courseId: 1, materialPath: "第二章", chapterId: 4 },
    { id: 5, materialId: 11, courseId: 1, materialPath: "第一章", chapterId: 1 },
    { id: 6, materialId: 11, courseId: 1, materialPath: "第一章>1.1", chapterId: 2 },
  ];
  d.knowledgePoints = [
    { id: 100, courseId: 1, chapterId: 1, chapterName: "第一章", name: "既有KP", description: "x", sourceAssetIds: [99], blockId: null, createTime: "t" },
  ];
  return d;
}

describe("resolveExtractNodes", () => {
  it("覆盖节点的并集，排除已有 KP 的节点，按文档序", () => {
    const d = fixture();
    expect(resolveExtractNodes(d, [10])).toEqual([2, 3, 4]);
    expect(resolveExtractNodes(d, [11])).toEqual([2]); // 节点1已有KP
    expect(resolveExtractNodes(d, [10, 11])).toEqual([2, 3, 4]); // 共享节点不重复
  });
  it("无映射的资料 → 空", () => {
    const d = fixture();
    expect(resolveExtractNodes(d, [999])).toEqual([]);
  });
});

describe("buildNodeText", () => {
  it("资料自然序拼接 span 文本，只含本节点范围", () => {
    const d = fixture();
    const { text, materialIds } = buildNodeText(d, 3);
    expect(materialIds).toEqual([10]);
    expect(text).toContain("丙");
    expect(text).not.toContain("乙");
    expect(text).not.toContain("丁");
  });
  it("多资料共享节点都包含", () => {
    const d = fixture();
    const { text, materialIds } = buildNodeText(d, 2);
    expect(materialIds).toEqual([10, 11]);
    expect(text).toContain("乙");
    expect(text).toContain("乙2");
  });
});
```

（`KnowledgePoint`/`Material` 必填字段以 `types/appData.ts` 实际为准补全。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/core/src/api/__tests__/nodeExtract.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `nodeExtract.ts`**

```ts
import { getData, saveData } from "./storage";
import { callAi, AiCanceledError } from "./ai";
import { findTaskBinding } from "./taskModel";
import { resolvePromptTemplate, renderPrompt } from "./promptTemplates";
import { queryMaterials } from "./material";
import {
  alignOutlineSpans, buildChapterTree, chapterPathText, isDescendant, nodePathOf,
  type OutlineNode,
} from "../utils/outline";
import { isDuplicateKpName } from "./kpMatch";
import type { AppData, Material } from "../types/appData";
import { nextId } from "../utils/csvIds";

const NODE_TEXT_CHUNK = 60000;

function outlineOf(material: Material): OutlineNode[] {
  if (!material.outline) return [];
  try {
    const v: unknown = JSON.parse(material.outline);
    return Array.isArray(v)
      ? v.filter((x): x is OutlineNode => typeof x === "object" && x !== null && typeof (x as OutlineNode).text === "string")
      : [];
  } catch {
    return [];
  }
}

/** 资料集合 → 需抽取的规范节点（被映射覆盖且尚无 KP），按章节树文档序 */
export function resolveExtractNodes(data: AppData, materialIds: number[]): number[] {
  const set = new Set(materialIds);
  const courseId = data.materials.find((m) => set.has(m.id))?.courseId;
  if (courseId === undefined) return [];
  const nodes = data.tocMappings
    .filter((m) => m.courseId === courseId && set.has(m.materialId))
    .map((m) => m.chapterId);
  const withKp = new Set(data.knowledgePoints.filter((k) => k.courseId === courseId).map((k) => k.chapterId));
  const candidates = [...new Set(nodes)].filter((id) => !withKp.has(id));
  const chapters = data.chapters.filter((c) => c.courseId === courseId);
  const order = new Map<number, number>();
  let i = 0;
  const walk = (list: ReturnType<typeof buildChapterTree>[number][]): void => {
    for (const n of list) {
      order.set(n.chapter.id, i++);
      walk(n.children);
    }
  };
  walk(buildChapterTree(chapters, courseId));
  return candidates.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
}

/** 节点的精确圈定原文：各贡献资料映射 span 文本，资料自然序拼接 */
export function buildNodeText(data: AppData, nodeId: number): { text: string; materialIds: number[] } {
  const courseId = data.chapters.find((c) => c.id === nodeId)?.courseId;
  if (courseId === undefined) return { text: "", materialIds: [] };
  const mats = queryMaterials(courseId);
  const byId = new Map(mats.map((m) => [m.id, m]));
  const parts: string[] = [];
  const materialIds: number[] = [];
  for (const m of mats) {
    const ms = data.tocMappings.filter((t) => t.chapterId === nodeId && t.materialId === m.id);
    if (ms.length === 0) continue;
    const outline = outlineOf(m);
    if (outline.length === 0) continue;
    const { spans } = alignOutlineSpans(m.contentText, outline);
    const slices: string[] = [];
    for (const t of ms) {
      const seq = outline.findIndex((h) => nodePathOf(outline, outline.indexOf(h)) === t.materialPath);
      // 上式按路径查 seq：预建 path→seq 索引更高效
      void seq;
    }
    // 预建 path→seq 索引
    const pathToSeq = new Map(outline.map((_, i2) => [nodePathOf(outline, i2), i2]));
    for (const t of ms) {
      const seq = pathToSeq.get(t.materialPath);
      if (seq === undefined) continue;
      const span = spans[seq];
      if (!span || span.start < 0) continue; // 未定位跳过
      slices.push(m.contentText.slice(span.start, span.end).trim());
    }
    if (slices.length > 0) {
      parts.push(slices.join("\n\n"));
      materialIds.push(m.id);
    }
  }
  return { text: parts.join("\n\n"), materialIds };
}
```

注意：上面 `for (const t of ms)` 的第一处循环是冗余的（写实现时删除，只保留 pathToSeq 索引版本）——**最终代码不得含死循环/void 占位**。

```ts
function sliceNodeText(text: string): string[] {
  if (text.length <= NODE_TEXT_CHUNK) return [text];
  const paras = text.split(/\n{2,}/);
  const out: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (cur.length > 0 && cur.length + p.length + 2 > NODE_TEXT_CHUNK) {
      out.push(cur);
      cur = p;
    } else {
      cur = cur ? cur + "\n\n" + p : p;
    }
    while (cur.length > NODE_TEXT_CHUNK) {
      out.push(cur.slice(0, NODE_TEXT_CHUNK));
      cur = cur.slice(NODE_TEXT_CHUNK);
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** 抽取单个规范节点：圈定正文（>60K 分片）→ AI → 按映射挂接 + 双层去重 */
export async function extractNodeKps(
  courseId: number,
  nodeId: number,
  onProgress?: (done: number, total: number) => void,
  isAborted?: () => boolean,
): Promise<{ created: number; skippedDup: number }> {
  const data = await getData();
  const binding = findTaskBinding(data, "extract_kp", courseId);
  if (!binding) throw new Error("未配置「知识点抽取」模型：请到「模型配置 → 任务模型」为该任务指定模型");
  const tpl = resolvePromptTemplate(data, "extract_kp");
  const course = data.courses.find((c) => c.id === courseId);
  if (!course) throw new Error("课程不存在或已删除");
  const chapters = data.chapters.filter((c) => c.courseId === courseId);
  const { text, materialIds } = buildNodeText(data, nodeId);
  if (!text.trim()) return { created: 0, skippedDup: 0 };

  const node = chapters.find((c) => c.id === nodeId);
  const nodePath = chapterPathText(chapters, nodeId);
  // 兄弟节点 = 同父节点的其他子节点名
  const siblings = node?.parentId === null
    ? chapters.filter((c) => c.parentId === null && c.id !== nodeId).map((c) => c.name)
    : chapters.filter((c) => c.parentId === node!.parentId && c.id !== nodeId).map((c) => c.name);
  const existingNodeKps = data.knowledgePoints.filter((k) => k.courseId === courseId && k.chapterId === nodeId);
  const courseKps = data.knowledgePoints.filter((k) => k.courseId === courseId);
  const chunks = sliceNodeText(text);

  interface RawKp { name: string; description: string }
  let raw: RawKp[] = [];
  for (let i = 0; i < chunks.length; i++) {
    if (isAborted?.()) throw new AiCanceledError();
    onProgress?.(i, chunks.length);
    const partNote = chunks.length > 1 ? `\n（本节点正文较长，以下为第 ${i + 1}/${chunks.length} 片）` : "";
    const res = await callAi({
      providerId: binding.providerId,
      modelId: binding.modelId,
      taskKey: "extract_kp",
      scope: `node-${nodeId}`,
      messages: [
        { role: "system", content: renderPrompt(tpl.system, {}) },
        { role: "user", content: renderPrompt(tpl.user, {
          courseName: course.name,
          chapter: nodePath,
          siblings: siblings.length ? siblings.join("、") : "（无）",
          existingKps: existingNodeKps.map((k) => k.name).join("、") || "（无）",
          courseKps: courseKps.map((k) => k.name).join("、") || "（无）",
          text: chunks[i] + partNote,
        }) },
      ],
    });
    raw = raw.concat(parseKpItems(res.content));
  }
  onProgress?.(chunks.length, chunks.length);

  // 双层去重（节点内 + 课程级），挂接 = nodeId（映射是结构事实，无模糊匹配）
  const latest = await getData();
  const createdNames = new Set(latest.knowledgePoints.filter((k) => k.courseId === courseId).map((n) => n.name));
  const nodeNames = new Set<string>();
  let created = 0;
  let skippedDup = 0;
  const now = new Date().toISOString();
  for (const item of raw) {
    const name = item.name.trim();
    if (!name) continue;
    if ([...nodeNames].some((n) => isDuplicateKpName(n, name))) { skippedDup++; continue; }
    if ([...createdNames].some((n) => isDuplicateKpName(n, name))) { skippedDup++; continue; }
    latest.knowledgePoints.push({
      id: nextId(latest.knowledgePoints.map((k) => k.id)),
      courseId,
      chapterId: nodeId,
      chapterName: nodePath,
      name,
      description: item.description.trim(),
      sourceAssetIds: materialIds,
      blockId: null,
      createTime: now,
    });
    nodeNames.add(name);
    createdNames.add(name);
    created++;
  }
  if (created > 0) await saveData(latest);
  return { created, skippedDup };
}

/** 解析 [{name, description}]（新契约，无 section） */
function parseKpItems(content: string): { name: string; description: string }[] {
  let s = content.trim();
  const fence = s.match(/^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("[");
  const end = s.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("AI 返回的知识点不是合法 JSON");
  let arr: unknown;
  try {
    arr = JSON.parse(s.slice(start, end + 1));
  } catch {
    throw new Error("AI 返回的知识点不是合法 JSON");
  }
  if (!Array.isArray(arr)) throw new Error("AI 返回的知识点不是数组");
  const out: { name: string; description: string }[] = [];
  for (const item of arr) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim() : "";
    const description = typeof o.description === "string" ? o.description : "";
    if (name) out.push({ name, description });
  }
  return out;
}

/** 资料集合 → 节点集合 → 逐节点抽取（多资料共享节点只抽一次） */
export async function extractMaterialNodes(
  courseId: number,
  materialIds: number[],
  onProgress?: (done: number, total: number, nodePath: string) => void,
  isAborted?: () => boolean,
): Promise<{ nodeTotal: number; nodeDone: number; created: number }> {
  const data = await getData();
  const nodes = resolveExtractNodes(data, materialIds);
  let created = 0;
  for (let i = 0; i < nodes.length; i++) {
    if (isAborted?.()) throw new AiCanceledError();
    const path = chapterPathText(data.chapters.filter((c) => c.courseId === courseId), nodes[i]);
    onProgress?.(i, nodes.length, path);
    const r = await extractNodeKps(courseId, nodes[i], undefined, isAborted);
    created += r.created;
  }
  if (!isAborted?.()) onProgress?.(nodes.length, nodes.length, "");
  return { nodeTotal: nodes.length, nodeDone: isAborted?.() ? 0 : nodes.length, created };
}
```

实现前核对：`nextId` 的实际工具名（`utils/csvIds.ts` 或 `extract.ts` 现有 KP 创建处的取 id 方式）、`isDuplicateKpName` 签名（`kpMatch.ts`）、`KnowledgePoint` 必填字段——以现有 `extract.ts` 创建 KP 的代码为准，保持一致。

`extract.ts` 改造：
- `extractKnowledgePoints(materialId, courseId, opts)` 内部：原「按资料分块 + section 挂接」逻辑删除，改为：
  - 进入前 `markMaterialExtracting`/退出 `unmark` 照旧（并发锁语义不变：锁粒度仍是资料集合）
  - 调 `extractMaterialNodes(courseId, [materialId], onProgress 适配, isAborted)`
  - `opts.onProgress(current, total, blockTitle)` 的 blockTitle 传节点路径（UI 文案兼容）
  - 取消/失败/完成提示照旧
- `startExtractTask`/`startBatchExtractTask` 签名与互斥逻辑（`extractState`）不变
- 删除 `chunkByChapters`/`chunkByMarkdownHeadings` import（若仅抽取用，函数本体任务 10 删）

- [ ] **Step 4: 跑测试确认通过 + 全量回归**

Run: `npx vitest run packages/core/src/api/__tests__/nodeExtract.test.ts && npx vitest run && npx vue-tsc --noEmit -p packages/core/tsconfig.json`
Expected: 全绿

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/api/nodeExtract.ts packages/core/src/api/__tests__/nodeExtract.test.ts packages/core/src/api/extract.ts
git commit -m "feat: 阶段④ 按规范节点抽取——映射挂接/兄弟边界/60K 分片/共享节点只抽一次"
```

---

### Task 8: 目录预览弹窗 N 级递归重写

**Files:**
- Modify: `packages/core/src/stores/modal.ts`（`chapterPreviewHeadings: ParsedHeading[]` → `chapterPreviewResult: MergeResult | null`）
- Create: `packages/core/src/components/PreviewTreeNode.vue`（递归节点行）
- Modify: `packages/core/src/components/ChapterTreePreviewModal.vue`（递归渲染 + meta + 确认落库带映射）
- Modify: `packages/core/src/style.css`（新增 `tp-tree` 相关样式）
- Modify: `components/Topbar.vue`、`views/CourseContentView.vue`（`toc-merged` 事件监听统一开预览）
- Test: `packages/core/src/components/__tests__/PreviewTreeNode.test.ts`

**Interfaces:**
- Consumes: Task 5 `MergeResult`/`MergeNode`/`RawMapping`；Task 6 `importChapterTree(courseId, nodes, toc)`；Task 2 `buildOutlineTree`
- Produces:
  - `useModalStore().openChapterPreview(courseId: number, result: MergeResult, sourceMaterialId: number | null, materialCount: number)`
  - `chapterPreviewResult: MergeResult | null`（store）
  - 预览树节点内部结构 `interface PreviewNode { id: number; name: string; variants: string[]; from: string[]; unlocated: boolean; children: PreviewNode[]; chapterId: number | null }`（`from`=来源资料名；`unlocated`=该节点存在未定位映射）
  - 确认时输出 `ChapterTreeNode[]`（level:number，父在子前）+ 原样传 `MergeResult`（`importChapterTree` 的 `toc` 参数需要 `materials`——弹窗不持有，改由 `importChapterTree` 内部 `queryMaterials(courseId)` 取，Task 6 的 `toc.materials` 参数**在本任务改为内部获取**：签名收敛为 `importChapterTree(courseId, nodes, toc?: { result: MergeResult })`）

- [ ] **Step 1: 改 `importChapterTree` 签名（先做，弹窗依赖）**

`kp.ts`：`toc?: { result: MergeResult; materials: Material[] }` → `toc?: { result: MergeResult }`，`materials` 改内部 `queryMaterials(courseId)` 获取（资料自然序，与 Task 6 测试同步更新：`mergeFixture` 的 `materialIdx` 按自然序对应）。跑 `npx vitest run packages/core/src/api/__tests__/kp.test.ts` 确认绿。

- [ ] **Step 2: 写失败测试（递归组件）**

`components/__tests__/PreviewTreeNode.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import PreviewTreeNode from "../PreviewTreeNode.vue";

const root = {
  id: 0, name: "第一章", variants: ["第一章 极限"], from: ["教材A", "教材B"],
  unlocated: false, chapterId: null,
  children: [
    { id: 1, name: "1.1 节", variants: [], from: ["教材A"], unlocated: true, chapterId: null, children: [] },
  ],
};

describe("PreviewTreeNode", () => {
  it("递归渲染节点与缩进层级", async () => {
    const w = mount(PreviewTreeNode, { props: { node: root, depth: 0 } });
    expect(w.findAll(".tp-node-row").length).toBe(2);
    expect(w.find(".tp-node-row").attributes("data-depth")).toBe("0");
    expect(w.findAll(".tp-node-row")[1].attributes("data-depth")).toBe("1");
  });
  it("展示 variants（等 N 种写法折叠）与来源徽章与未定位警告", async () => {
    const w = mount(PreviewTreeNode, { props: { node: root, depth: 0 } });
    expect(w.text()).toContain("第一章 极限");
    expect(w.find(".tp-from").text()).toContain("教材A");
    expect(w.find(".tp-warn").exists()).toBe(false); // 根无警告
    expect(w.findAll(".tp-warn").length).toBe(1); // 子节点有
  });
  it("添加子节点事件带父 id", async () => {
    const w = mount(PreviewTreeNode, { props: { node: root, depth: 0 } });
    await w.find("[data-act='add']").trigger("click");
    expect(w.emitted("add")?.[0]).toEqual([0]);
  });
  it("删除子树事件", async () => {
    const w = mount(PreviewTreeNode, { props: { node: root, depth: 0 } });
    await w.findAll("[data-act='remove']")[1].trigger("click");
    expect(w.emitted("remove")?.[0]).toEqual([1]);
  });
});
```

- [ ] **Step 3: 实现组件与弹窗**

`PreviewTreeNode.vue`（递归自身引用；props `{ node: PreviewNode; depth: number }`；emit `add(nodeId)`/`remove(nodeId)`）：

```vue
<template>
  <div>
    <div class="tp-node-row" :data-depth="depth" :style="{ marginLeft: depth * 14 + 'px' }">
      <span class="tp-tag" :class="depth === 0 ? 'chapter' : depth === 1 ? 'unit' : 'sub'">{{ depth === 0 ? "章" : depth === 1 ? "节" : "小节" }}</span>
      <input v-model="node.name" class="tp-input" :aria-label="`节点名称 L${depth + 1}`" placeholder="节点名称" />
      <span v-if="node.variants.length" class="tp-variants" :title="node.variants.join('；')">（{{ node.variants[0] }}{{ node.variants.length > 1 ? ` 等${node.variants.length}种写法` : "" }}）</span>
      <span v-if="node.from.length" class="tp-from">{{ node.from.slice(0, 2).join("、") }}{{ node.from.length > 2 ? "…" : "" }}</span>
      <span v-if="node.unlocated" class="tp-warn" title="存在未能定位到正文的标题">⚠</span>
      <button class="btn sm ghost" data-act="add" @click="emit('add', node.id)">＋子</button>
      <button class="btn sm ghost" data-act="remove" @click="emit('remove', node.id)">删除</button>
    </div>
    <PreviewTreeNode v-for="child in node.children" :key="child.id" :node="child" :depth="depth + 1" @add="(id) => emit('add', id)" @remove="(id) => emit('remove', id)" />
  </div>
</template>
```

（`<script setup lang="ts">` 中 `defineProps<{ node: PreviewNode; depth: number }>()` + `const emit = defineEmits<{ add: [number]; remove: [number] }>()`；`PreviewNode` 接口定义在本组件并 export，弹窗 import 复用。样式全部进 `style.css`：`.tp-variants`（淡色小字）、`.tp-from`（徽章）、`.tp-warn`（橙色）等。）

`ChapterTreePreviewModal.vue` 重写（要点）：
- `watch(chapterPreviewOpen)`：`modalStore.chapterPreviewResult` → 转 `PreviewNode[]`：`MergeNode[]`（扁平）按 parent 建递归树（id 保持 MergeNode.id）；`from` 由 `mappings` 反查（`materialIdx` → 资料名，弹窗打开时 `queryMaterials(courseId)` 取名）；`unlocated` 由该节点映射对应 outline 节点的定位状态算（`alignOutlineSpans` 复算，`spans[seq].start < 0`）
- 渲染 `<PreviewTreeNode v-for="n in tree" @add="addNode" @remove="removeNode">`；`addNode(nodeId)` 在 `children` 末尾推 `{ id: nextId++, name: "", variants: [], from: [], unlocated: false, chapterId: null, children: [] }`；`removeNode` 过滤子树
- 失败资料区：`result.failed.length > 0` 时渲染列表（资料名 + 原因 + 其 outline 原文行 + 提示「可确认后手工「＋子」补章」）
- `confirm()`：
  - 递归遍历 `PreviewNode[]` 生成 `ChapterTreeNode[]`（`level = depth + 1`，`parentName = 父节点当前 name`，父在子前；空名节点连同其子树跳过——与现逻辑一致）
  - `await importChapterTree(courseId, nodes, { result: modalStore.chapterPreviewResult! })`
  - 后续（未抽资料批量抽取启动、`notifyChapterImported`、提示文案）沿用现有 `confirm()` 逻辑；文案中「小节」措辞改「章节」
- 顶部说明文案改「识别到以下章节结构（N 级，由 M 份资料语义合并）」

`stores/modal.ts`：`chapterPreviewHeadings: [] as ParsedHeading[]` → `chapterPreviewResult: null as MergeResult | null`（import type from `../api` 会成环（api 不 import store，安全）；`openChapterPreview` 参数改 `result: MergeResult`；close 时置 null）。

`Topbar.vue`/`CourseContentView.vue` 统一事件监听（模块级 `onMounted` 一次，或现有挂载钩子处）：

```ts
const onTocMerged = (e: Event) => {
  const detail = (e as CustomEvent<{ courseId: number; result: MergeResult }>).detail;
  if (detail.courseId === currentCourseId()) {
    const count = materials.value.length;
    modalStore.openChapterPreview(detail.courseId, detail.result, null, count);
  }
};
window.addEventListener("siyuan-ai-study:toc-merged", onTocMerged);
// onUnmounted 移除
```

（`CourseContentView` 是课程视图根，主监听放这里即可；`Topbar` 的旧 `openChapterPreview` 调用删除，铃铛点击保持现状（打开对应任务详情）不再直接弹预览。）

- [ ] **Step 4: 跑测试 + 类型检查**

Run: `npx vitest run && npx vue-tsc --noEmit -p packages/siyuan/tsconfig.json && npx vue-tsc --noEmit -p packages/core/tsconfig.json`
Expected: 全绿

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/stores/modal.ts packages/core/src/components/PreviewTreeNode.vue packages/core/src/components/ChapterTreePreviewModal.vue packages/core/src/components/__tests__/PreviewTreeNode.test.ts packages/core/src/style.css packages/core/src/components/Topbar.vue packages/core/src/views/CourseContentView.vue packages/core/src/api/kp.ts packages/core/src/api/__tests__/kp.test.ts
git commit -m "feat: 目录预览 N 级递归树——来源/变体/未定位标注 + 确认落库带映射"
```

---

### Task 9: 主界面章节树 N 级 + 入口 + 全量重抽

**Files:**
- Modify: `packages/core/src/utils/chapterMove.ts`（N 级规则）
- Modify: `packages/core/src/utils/__tests__/chapterTree.test.ts`（同步新规则用例）
- Modify: `packages/core/src/views/CourseContentView.vue`（递归树渲染/拖拽/章节弹窗子节点/菜单入口/全量重抽进度）
- Create: `packages/core/src/components/ChapterTreeRow.vue`（递归行组件，含拖拽指示）
- Modify: `packages/core/src/style.css`（N 级缩进/拖拽指示样式）

**Interfaces:**
- Consumes: Task 2 `buildChapterTree`/`isDescendant`/`chapterPathText`；Task 7 `extractMaterialNodes`；Task 4 `startOutlineTask`；Task 5 `startTocMergeTask`
- Produces: `computeChapterMove(all, dragId, targetId, pos)` N 级语义（签名不变）：
  - `inside`：挂为 target 直接子节点（任意深度）
  - `before/after`：插入 target 所在同级列表对应位置（可跨父）
  - 落点为自身子树 → null（`isDescendant` 判定）

- [ ] **Step 1: 写失败测试（chapterMove N 级）**

`utils/__tests__/chapterTree.test.ts` 中现有两级用例改 N 级语义，新增：

```ts
it("N 级：小节可挂到任意深度节点下", () => {
  const all = [
    ch(1, null, 1, 1, "第一章"), ch(2, 1, 2, 1, "1.1"), ch(3, 2, 3, 1, "1.1.1"), ch(4, null, 1, 2, "第二章"),
  ];
  const next = computeChapterMove(all, 4, 3, "inside")!;
  const moved = next.find((c) => c.id === 4)!;
  expect(moved.parentId).toBe(3);
});
it("N 级：跨父同级插入（before/after 按 target 父级列表）", () => {
  const all = [
    ch(1, null, 1, 1, "第一章"), ch(2, 1, 2, 1, "1.1"), ch(3, 1, 2, 2, "1.2"), ch(4, null, 1, 2, "第二章"), ch(5, 4, 2, 1, "2.1"),
  ];
  // 把 5（2.1）拖到 2（1.1）之后 → 父变 1，sort 介于 2 与 3 间
  const next = computeChapterMove(all, 5, 2, "after")!;
  const m = next.find((c) => c.id === 5)!;
  expect(m.parentId).toBe(1);
  const siblings = next.filter((c) => c.parentId === 1).sort((a, b) => a.sort - b.sort);
  expect(siblings.map((c) => c.id)).toEqual([2, 5, 3]);
});
it("落点为自身子树返回 null", () => {
  const all = [ch(1, null, 1, 1, "第一章"), ch(2, 1, 2, 1, "1.1")];
  expect(computeChapterMove(all, 1, 2, "inside")).toBeNull();
});
```

（`ch(...)` helper 同 Task 2 测试：`{ id, courseId: 1, parentId, siyuanBlockId: null, name, level, sort }`。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/core/src/utils/__tests__/chapterTree.test.ts`
Expected: 新用例 FAIL（旧规则下 `inside` 要求 target level1 且 drag level2）

- [ ] **Step 3: 实现**

`chapterMove.ts` 整体替换（N 级）：

```ts
import type { Chapter } from "../api";
import { isDescendant } from "./outline";

export type DropPos = "before" | "after" | "inside";

/**
 * 计算拖拽移动后的章节列表（sort/parentId 已更新）。N 级规则：
 * - 节点行中部拖放 = 挂为该节点直接子节点（任意深度）
 * - 节点行上/下沿 = 插入该节点所在同级列表的对应位置（可跨父）
 * - 落点在拖拽节点自身子树内 → null
 */
export function computeChapterMove(all: Chapter[], dragId: number, targetId: number, pos: DropPos): Chapter[] | null {
  if (dragId === targetId) return null;
  const next = all.map((c) => ({ ...c }));
  const byId = (id: number) => next.find((c) => c.id === id);
  const dragCopy = byId(dragId);
  const targetCopy = byId(targetId);
  if (!dragCopy || !targetCopy) return null;
  const oldParentId = dragCopy.parentId;

  const newParentId = pos === "inside" ? targetId : targetCopy.parentId;
  if (newParentId === dragId || isDescendant(next, dragId, newParentId)) return null;

  dragCopy.parentId = newParentId;
  const siblings = next
    .filter((c) => c.parentId === newParentId && c.id !== dragId)
    .sort((a, b) => a.sort - b.sort);
  if (pos === "inside") {
    siblings.push(dragCopy);
  } else {
    const ti = siblings.findIndex((c) => c.id === targetId);
    if (ti < 0) return null;
    siblings.splice(pos === "before" ? ti : ti + 1, 0, dragCopy);
  }
  siblings.forEach((c, i) => { c.sort = i + 1; });
  if (oldParentId !== null && oldParentId !== newParentId) {
    next
      .filter((c) => c.parentId === oldParentId)
      .sort((a, b) => a.sort - b.sort)
      .forEach((c, i) => { c.sort = i + 1; });
  }
  return next;
}
```

`ChapterTreeRow.vue`（递归行；props `{ node: NestedChapter; depth: number }`；emits：`dragstart(id)`/`dragover(node, pos)`/`drop(node, pos)`/`click(node)`/`menu(node)`；渲染 tag（章/节/小节按 depth）、名称、KP 数徽标（`kpCountByNode`）、拖拽上/下/中三区指示（现有模板的指示 class 迁移过来，`data-pos` 属性））。

`CourseContentView.vue`：
- `chapterTree` computed：`buildChapterTree(chapters.value.filter((c) => c.courseId === currentCourseId()), currentCourseId())`
- 模板：`<ChapterTreeRow v-for="n in chapterTree" ...>` 递归（替换现有两级 v-for）
- 章节弹窗（`chapterModal`）：`'unit'` 语义 → `'child'`，`parentId` 取被点节点 id（任意深度）；`addUnit(ch)` → `addChapterChild(ch)`（`createChapter(name, parentId, level = parent.level + 1)`）
- 资料行菜单：新增「重新识别结构」→ `startOutlineTask(m.id, courseId)` 完成后再 `startTocMergeTask(courseId, [m.id])`（两步串联：outline 任务 `done` 事件经 bgTask store 监听，或简化为直接 `startTocMergeTask(courseId, [m.id])`——**采用后者**：mergeCourseToc 内部对无 outline 资料自动补跑②，单入口更简单；「重新识别结构」即 `startTocMergeTask(courseId, [m.id])`，提示「将重新识别该资料结构并合并目录」）
- 课程菜单：「重新识别目录」已是 `startTocMergeTask(courseId)`（Task 6 已接）
- `fullReExtract()`：逐资料 `extractKnowledgePoints` 循环不变（内部已是节点单位）；进度文案改 `正在重新抽取：节点 ${p.block}`（`p.block` 现传节点路径），label 计算同步

- [ ] **Step 4: 跑测试 + 类型检查 + 构建**

Run: `npx vitest run && npx vue-tsc --noEmit -p packages/siyuan/tsconfig.json && npx vue-tsc --noEmit -p packages/core/tsconfig.json && npm run build:web && npm run build:plugin`
Expected: 全绿

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/utils/chapterMove.ts packages/core/src/utils/__tests__/chapterTree.test.ts packages/core/src/components/ChapterTreeRow.vue packages/core/src/views/CourseContentView.vue packages/core/src/style.css
git commit -m "feat: 主界面章节树 N 级——递归渲染/任意深度拖拽/子节点创建/结构重识别入口"
```

---

### Task 10: 文档同步策略 + 遗留清理

**Files:**
- Modify: `packages/core/src/api/kpDocSync.ts`（`scheduleKpRegionSync` 深节点落最近有文档祖先）
- Modify: `packages/core/src/api/kp.ts`（`createChapter` 深节点不建文档的最终核对）
- Modify: `packages/core/src/utils/textChunker.ts`（删 `chunkByChapters`/`chunkByMarkdownHeadings`，确认无引用后）
- Modify: `packages/core/src/views/CourseContentView.vue`（`chapterScope` 相关展示若仍两级措辞则泛化）
- Test: `packages/core/src/api/__tests__/kpDocSync.test.ts`（追加深节点用例）

**Interfaces:**
- Consumes: Task 2 `nearestDocAncestorId`
- Produces: 无新 API；行为变更=level>2 节点的 KP 区域同步落到最近 level≤2 祖先文档

- [ ] **Step 1: 写失败测试**

`api/__tests__/kpDocSync.test.ts` 追加（沿用该文件既有 fixture 模式）：

```ts
it("level>2 节点的 KP 区域同步落到最近有文档祖先", async () => {
  // 章1(L1, docId d1) → 节2(L2, docId d2) → 小节3(L3, siyuanBlockId=null)
  // KP chapterId=3 → scheduleKpRegionSync 后 docRegions 写入 d2 的文档
  // 断言：假桥 updateDoc 收到的 docId === d2，且区域锚点内含该 KP
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/core/src/api/__tests__/kpDocSync.test.ts`
Expected: FAIL（现在直接拿 `chapter.siyuanBlockId`，L3 节点为 null 会落课程顶层文档或跳过）

- [ ] **Step 3: 实现**

`kpDocSync.ts` 中所有「按 KP 的 chapterId 取文档」处，取 `ch` 之后加：

```ts
import { nearestDocAncestorId } from "../utils/outline";
// ch = chapters.find(c => c.id === kp.chapterId)
// 文档落点：深节点（level>2，无文档）取最近有文档祖先
const docOwnerId = nearestDocAncestorId(chapters, ch.id);
const owner = chapters.find((c) => c.id === docOwnerId);
```

后续用 `owner.siyuanBlockId`（原 `ch.siyuanBlockId` 引用点逐一替换；未归章 KP 的 `course-<id>` 兜底逻辑不变）。

`textChunker.ts`：`grep -rn "chunkByChapters\|chunkByMarkdownHeadings" packages/` 确认仅测试引用后，删两个函数及其测试用例（保留 `chunkText`/`splitTextChunks` 等仍被使用者）。

- [ ] **Step 4: 全量回归**

Run: `npx vue-tsc --noEmit -p packages/siyuan/tsconfig.json && npx vue-tsc --noEmit -p packages/core/tsconfig.json && npx vitest run`
Expected: 全绿

- [ ] **Step 5: 提交**

```bash
git add -u packages/core/src
git commit -m "refactor: 深节点 KP 区域同步落最近有文档祖先 + 清理两级时代遗留函数"
```

---

### Task 11: 端到端验证 + 真机冒烟

**Files:** 无代码改动（验证任务；发现问题回对应任务修复）

**Interfaces:** 无

- [ ] **Step 1: 全量静态验证**

Run: `npx vue-tsc --noEmit -p packages/siyuan/tsconfig.json && npx vue-tsc --noEmit -p packages/core/tsconfig.json && npx vitest run`
Expected: 全绿（记录测试总数，基线 683 + 本计划新增）

- [ ] **Step 2: 构建 + 部署**

```bash
npm run build:web && npm run build:plugin && rsync -a --delete dist/ ~/SiYuan/data/plugins/AIstudy/
```

（不 clean；部署后思源 reloadPlugin 生效。）

- [ ] **Step 3: 浏览器冒烟（ego-browser，按项目 AGENTS.md 规范）**

用 ego-browser 打开 `http://127.0.0.1:6806` → **整页刷新** → 点顶栏 `div[aria-label="AI 智能学习"]`：
1. `.ai-study-app` 挂载成功，无 console error
2. 示例课（12 章）：课程主页章节树正常渲染（level 迁移后数字深度展示无误）；点开一章 KP 列表正常；今日任务/计划正常
3. 模型配置页：任务列表出现「结构识别（outline）」「目录语义合并」，`recognize_toc` 已消失；三个大块任务 desc 有大上下文提示
4. 上传一份 txt 资料（临时小文件）→ 梳理任务完成 → 铃铛出现「合并目录」任务 → 完成后目录预览弹窗为 N 级递归树，确认落库 → 章节树出现新章 → 抽取后台启动（若配置了抽取模型）
5. 清理测试数据（删资料/删课程/删章）

冒烟发现的 bug：定位后回对应任务修复，重跑 Step 1-3。

- [ ] **Step 4: 实机验收（用户参与，spec §6 清单）**

向用户交付验收清单（多资料课程重跑①→②→③核对合并质量、抽取核对归属与保真、增量合并、示例课回归），等用户执行并反馈；反馈的问题逐个修复（新 bug 走 systematic-debugging）。

- [ ] **Step 5: 收尾提交（如有修复）**

```bash
git status && git diff
# 无待提交改动则跳过；有则按问题分别提交
```

## Self-Review 记录

- **Spec 覆盖**：数据模型（§1→Task 1）、①清理（§2.1→Task 3）、②识别（§2.2→Task 4）、③合并（§2.3→Task 5/6/8）、④抽取（§2.4→Task 7）、UI（§3→Task 8/9）、兼容迁移（§4→Task 1）、错误处理（§5→Task 4/5/7 各自失败/重试入口 + 任务 9 菜单入口）、测试验收（§6→Task 11）、模型选型提示（§8→Task 3）——全覆盖
- **类型一致性**：`MergeNode`/`RawMapping`/`MergeResult`（Task 5 定义）在 Task 6/8 中引用一致；`OutlineNode`/`OutlineSpan`（Task 2）在 Task 4/5/7 一致；`importChapterTree` 签名 Task 6 定义、Task 8 Step 1 收敛（`toc.materials` 内部获取）——执行时以 Task 8 Step 1 为准
- **已知风险**：① AI 输出不稳定（解析全部 fail-loud + 阶段重试兜底）；② 目录页误匹配（单调对齐 + 点线过滤 + prompt 指令三层防御）；③ 顺序合并漂移（人工确认门兜底）；④ 大上下文模型依赖（Task 3 desc 提示 + 失败重试）
