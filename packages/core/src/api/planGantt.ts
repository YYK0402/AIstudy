import type { Chapter, KnowledgePoint, StudyPlan, StudyTask } from "../types/appData";

/** 任务类型展示顺序（学 → 练 → 复 → 测），与 StudyPlanView 一致 */
const TYPE_ORDER = ["learn", "practice", "review", "test"];

/** 列单位：天列（全部/周/月聚焦）、周列（季度聚焦）、月列（年度聚焦） */
export type GanttColUnit = "day" | "week" | "month";

/** 甘特列：一个时间桶（一天 / 一周（周一~日）/ 一月） */
export interface GanttColumn {
  /** 唯一键：unit:start */
  key: string;
  start: string;
  end: string;
  /** 列标签：天=日号，周=周一 M/D，月=M月（首月/跨年带年份） */
  label: string;
  /** 天列专用：是否周六/日 */
  isWknd: boolean;
  /** 天列专用：星期 0=周一…6=周日（周/月列为 0） */
  dow: number;
}

/** 表头跨度（列下标空间）：月份行等 */
export interface GanttSpan {
  label: string;
  start: number;
  count: number;
}

/** 甘特单元格：某列某行的任务聚合（周/月列可含多天任务） */
export interface GanttCell {
  /** 在 model.columns 中的下标 */
  colIndex: number;
  start: string;
  end: string;
  tasks: StudyTask[];
  total: number;
  done: number;
  /** 含早于今天且未完成的日期 */
  overdue: boolean;
  /** 按任务类型分段（TYPE_ORDER 序，未知类型殿后），供按比例着色 */
  segments: { type: string; count: number }[];
}

/** 甘特行：一个知识点 / 悬空 KP / 测评 / 其他任务 */
export interface GanttRow {
  /** 行唯一键：kp:<id> / test:<chId|none> / other:<chId|none> */
  key: string;
  kind: "kp" | "test" | "other";
  kpId: number | null;
  name: string;
  chapterId: number | null;
  sort: number;
  tasks: StudyTask[];
  /** 按列下标升序，只含有任务的列 */
  cells: GanttCell[];
  barStart: string;
  barEnd: string;
  /** 首/末有任务列的下标（无任务为 -1），供整条定位 */
  barColStart: number;
  barColEnd: number;
  total: number;
  done: number;
  /** 过期未完成任务数 */
  overdue: number;
}

/** 行分组；name 为 null = 无标题（节直属章、测评/其他行） */
export interface GanttUnit {
  name: string | null;
  rows: GanttRow[];
}

export interface GanttChapter {
  /** ch:<id> 或 ch:ungrouped */
  key: string;
  chapterId: number | null;
  name: string;
  sort: number;
  units: GanttUnit[];
  /** 全部行（含各节），供聚合 */
  rows: GanttRow[];
  total: number;
  done: number;
  overdue: number;
}

export interface GanttModel {
  start: string;
  end: string;
  colUnit: GanttColUnit;
  /** 时间列（天/周/月），宽度与定位以此为准 */
  columns: GanttColumn[];
  /** 月份表头跨度（列下标空间），三种列单位通用 */
  months: GanttSpan[];
  /** 周表头跨度（仅天列，列下标空间）；周一为一周之始，首尾周可能不完整 */
  weeks: GanttSpan[];
  /** 天列专用：起始日到第一个周一的天数（0 = 起始日即周一），供网格线对齐周一 */
  weekShift: number;
  /** 天列专用：每列日期（与 columns 一一对应） */
  dates: string[];
  today: string;
  /** today 所在列下标；区间不覆盖今天时为 -1 */
  todayIndex: number;
  /** today 在所在列内的相对位置 0..1（天列=0.5，周列=(星期+0.5)/7，月列=(日-0.5)/天数） */
  todayFrac: number;
  chapters: GanttChapter[];
}

/** 本地时区星期：0=周一 … 6=周日 */
export function dowOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
}

/** 本地时区周一对齐：返回 date 所在周的周一 */
export function mondayOf(date: string): string {
  return addDaysLocal(date, -dowOf(date));
}

/** 本地时区日期加 n 天（按分量构造，避免 UTC 偏移） */
export function addDaysLocal(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${dt.getFullYear()}-${mm}-${dd}`;
}

/** date 所在月的天数 */
export function daysInMonthOf(date: string): number {
  const [y, m] = date.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

/** 本地时区加 n 个月（日自动收敛，如 1/31 + 1月 = 2/28） */
export function addMonthsLocal(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1 + n, 1);
  const dim = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(Math.min(d, dim)).padStart(2, "0")}`;
}

/** 本地时区加 n 年（2/29 收敛为 2/28） */
export function addYearsLocal(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const yy = y + n;
  const leap = (v: number) => (v % 4 === 0 && v % 100 !== 0) || v % 400 === 0;
  const day = m === 2 && d === 29 && !leap(yy) ? 28 : d;
  return `${yy}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** date 所在月/周（周一~日）/季度的起止 */
export function monthRangeOf(date: string): { start: string; end: string } {
  const p = date.slice(0, 8);
  return { start: `${p}01`, end: `${p}${String(daysInMonthOf(date)).padStart(2, "0")}` };
}

export function weekRangeOf(date: string): { start: string; end: string } {
  const start = mondayOf(date);
  return { start, end: addDaysLocal(start, 6) };
}

export function quarterRangeOf(date: string): { start: string; end: string } {
  const [y, m] = date.split("-").map(Number);
  const sm = Math.floor((m - 1) / 3) * 3 + 1;
  const em = sm + 2;
  return {
    start: `${y}-${String(sm).padStart(2, "0")}-01`,
    end: `${y}-${String(em).padStart(2, "0")}-${String(daysInMonthOf(`${y}-${String(em).padStart(2, "0")}-15`)).padStart(2, "0")}`,
  };
}

function buildCell(colIndex: number, col: GanttColumn, tasks: StudyTask[], today: string): GanttCell {
  const count: Record<string, number> = {};
  for (const t of tasks) count[t.taskType] = (count[t.taskType] ?? 0) + 1;
  const segments = [
    ...TYPE_ORDER.filter((ty) => count[ty]).map((ty) => ({ type: ty, count: count[ty] })),
    ...Object.keys(count)
      .filter((ty) => !TYPE_ORDER.includes(ty))
      .sort()
      .map((ty) => ({ type: ty, count: count[ty] })),
  ];
  return {
    colIndex,
    start: col.start,
    end: col.end,
    tasks,
    total: tasks.length,
    done: tasks.filter((t) => t.status === "done").length,
    overdue: tasks.some((t) => t.status !== "done" && t.scheduledDate < today),
    segments,
  };
}

function buildRow(
  key: string,
  kind: GanttRow["kind"],
  kpId: number | null,
  name: string,
  chapterId: number | null,
  sort: number,
  tasks: StudyTask[],
  today: string,
  dateToCol: Map<string, number>,
  columns: GanttColumn[],
): GanttRow {
  const byCol = new Map<number, StudyTask[]>();
  for (const t of tasks) {
    const ci = dateToCol.get(t.scheduledDate);
    if (ci == null) continue;
    const list = byCol.get(ci) ?? [];
    list.push(t);
    byCol.set(ci, list);
  }
  const cells = [...byCol.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ci, list]) => {
      list.sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate) || a.sort - b.sort);
      return buildCell(ci, columns[ci], list, today);
    });
  let barStart = "";
  let barEnd = "";
  for (const t of tasks) {
    if (!barStart || t.scheduledDate < barStart) barStart = t.scheduledDate;
    if (!barEnd || t.scheduledDate > barEnd) barEnd = t.scheduledDate;
  }
  return {
    key,
    kind,
    kpId,
    name,
    chapterId,
    sort,
    tasks,
    cells,
    barStart,
    barEnd,
    barColStart: cells.length ? cells[0].colIndex : -1,
    barColEnd: cells.length ? cells[cells.length - 1].colIndex : -1,
    total: tasks.length,
    done: tasks.filter((t) => t.status === "done").length,
    overdue: tasks.filter((t) => t.status === "todo" && t.scheduledDate < today).length,
  };
}

/** 月份表头跨度（列下标空间）：列按起始日归属月份，首段或跨年时带年份 */
function buildMonthSpans(columns: GanttColumn[]): GanttSpan[] {
  const segs: { y: number; m: number; start: number; count: number }[] = [];
  for (let i = 0; i < columns.length; i++) {
    const [y, m] = columns[i].start.split("-").map(Number);
    const cur = segs[segs.length - 1];
    if (cur && cur.y === y && cur.m === m) cur.count++;
    else segs.push({ y, m, start: i, count: 1 });
  }
  return segs.map((seg, i) => ({
    label: i === 0 || segs[i - 1].y !== seg.y ? `${seg.y}年${seg.m}月` : `${seg.m}月`,
    start: seg.start,
    count: seg.count,
  }));
}

/** 周表头跨度（天列专用）：按周一分段，label = 该周周一的 M/D（首段周一可能在区间外） */
function buildWeeks(dates: string[]): { weeks: GanttSpan[]; weekShift: number } {
  const segs: { monday: string; start: number; count: number }[] = [];
  for (let i = 0; i < dates.length; i++) {
    const monday = mondayOf(dates[i]);
    const cur = segs[segs.length - 1];
    if (cur && cur.monday === monday) cur.count++;
    else segs.push({ monday, start: i, count: 1 });
  }
  const weeks = segs.map((s) => ({
    label: s.monday.slice(5).replace("-", "/"),
    start: s.start,
    count: s.count,
  }));
  return { weeks, weekShift: dowOf(dates[0]) };
}

/** 生成时间列：天列逐日；周列=完整 ISO 周（首尾周可越界）；月列=完整月 */
function buildColumns(start: string, end: string, unit: GanttColUnit): GanttColumn[] {
  const cols: GanttColumn[] = [];
  if (unit === "day") {
    for (let d = start; d <= end; d = addDaysLocal(d, 1)) {
      const dow = dowOf(d);
      cols.push({ key: `day:${d}`, start: d, end: d, label: String(Number(d.slice(8))), isWknd: dow >= 5, dow });
    }
    return cols;
  }
  if (unit === "week") {
    for (let mon = mondayOf(start); mon <= end; mon = addDaysLocal(mon, 7)) {
      cols.push({ key: `week:${mon}`, start: mon, end: addDaysLocal(mon, 6), label: mon.slice(5).replace("-", "/"), isWknd: false, dow: 0 });
    }
    return cols;
  }
  let cur = monthRangeOf(start).start;
  let prevYear = -1;
  while (cur <= end) {
    const [y, m] = cur.split("-").map(Number);
    const label = prevYear === -1 || y !== prevYear ? `${y}年${m}月` : `${m}月`;
    const { end: me } = monthRangeOf(cur);
    cols.push({ key: `month:${cur}`, start: cur, end: me, label, isWknd: false, dow: 0 });
    prevYear = y;
    cur = addMonthsLocal(cur, 1);
  }
  return cols;
}

/** 日期 → 列下标 索引（覆盖所有列的日期范围） */
function buildDateToCol(columns: GanttColumn[]): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < columns.length; i++) {
    for (let d = columns[i].start; d <= columns[i].end; d = addDaysLocal(d, 1)) map.set(d, i);
  }
  return map;
}

/** today 所在列下标与列内相对位置；不在任何列内时 -1 */
function locateToday(columns: GanttColumn[], unit: GanttColUnit, today: string): { index: number; frac: number } {
  for (let i = 0; i < columns.length; i++) {
    const c = columns[i];
    if (today >= c.start && today <= c.end) {
      const frac =
        unit === "week"
          ? (dowOf(today) + 0.5) / 7
          : unit === "month"
            ? (Number(today.slice(8)) - 0.5) / daysInMonthOf(today)
            : 0.5;
      return { index: i, frac };
    }
  }
  return { index: -1, frac: 0 };
}

/** 章分桶的槽位：节用 "u:<id>"，章直属 "direct"，特殊行 "test" / "other" */
interface ChBucket {
  id: number | null;
  name: string;
  sort: number;
  slots: Map<string, GanttRow[]>;
}

/** 聚焦选项：列单位 + 显式区间（聚焦模式传，「全部」模式不传） */
export interface GanttModelOpts {
  colUnit?: GanttColUnit;
  range?: { start: string; end: string };
}

/**
 * 推导甘特模型（纯函数）。
 * 分组口径与 StudyPlanView 一致：章（教材序）→ 节 → 知识点（教材序），
 * 章直属 KP 排节之后，测评/其他任务（无 KP）殿后；未归入任何章的归「未分组」。
 * 未排期 KP（无任何任务）不出现。
 * 聚焦模式（传 range）：任务先按区间过滤，区间外无任务的行不出现；列单位由 colUnit 决定。
 */
export function buildGanttModel(
  plan: StudyPlan,
  tasks: StudyTask[],
  chapters: Chapter[],
  knowledgePoints: KnowledgePoint[],
  today: string,
  opts: GanttModelOpts = {},
): GanttModel {
  const colUnit = opts.colUnit ?? "day";
  // 日期范围：聚焦区间 或（计划区间 ∪ 实际任务日期）
  let start = opts.range ? opts.range.start : plan.startDate ?? today;
  let end = opts.range ? opts.range.end : plan.targetDate || today;
  if (!opts.range) {
    for (const t of tasks) {
      if (t.scheduledDate < start) start = t.scheduledDate;
      if (t.scheduledDate > end) end = t.scheduledDate;
    }
  }
  if (start > end) [start, end] = [end, start];
  // 聚焦模式：任务按区间过滤
  const inTasks = opts.range ? tasks.filter((t) => t.scheduledDate >= start && t.scheduledDate <= end) : tasks;
  const columns = buildColumns(start, end, colUnit);
  const dateToCol = buildDateToCol(columns);
  const dates: string[] = colUnit === "day" ? columns.map((c) => c.start) : [];

  const kpById = new Map(knowledgePoints.map((k) => [k.id, k]));
  const unitById = new Map(chapters.filter((c) => c.level === "unit").map((c) => [c.id, c]));
  const topLevel = chapters
    .filter((c) => c.level === "chapter" || c.parentId == null)
    .sort((a, b) => a.sort - b.sort);

  const buckets = new Map<number, ChBucket>();
  for (const ch of topLevel) {
    buckets.set(ch.id, { id: ch.id, name: ch.name, sort: ch.sort, slots: new Map() });
  }
  const ungrouped: ChBucket = { id: null, name: "未分组", sort: Number.MAX_SAFE_INTEGER, slots: new Map() };

  const pushRow = (bucket: ChBucket, slot: string, row: GanttRow) => {
    const list = bucket.slots.get(slot) ?? [];
    list.push(row);
    bucket.slots.set(slot, list);
  };

  // 任务 chapterId → 所属桶（命中章自身返回 [桶, 章直属]，命中节返回 [桶, 节槽位]）
  const locate = (chId: number | null): { bucket: ChBucket; slot: string } => {
    if (chId != null) {
      const unit = unitById.get(chId);
      const ch = unit ? topLevel.find((c) => c.id === unit.parentId) : topLevel.find((c) => c.id === chId);
      if (ch) {
        const bucket = buckets.get(ch.id)!;
        return { bucket, slot: unit ? `u:${chId}` : "direct" };
      }
    }
    return { bucket: ungrouped, slot: "direct" };
  };

  // 1) KP 行（有任务的 KP；悬空 kpId 也成行，名称带「已删除」）
  const taskKpIds = [...new Set(inTasks.filter((t) => t.kpId != null).map((t) => t.kpId as number))];
  for (const kpId of taskKpIds) {
    const kp = kpById.get(kpId) ?? null;
    const ts = inTasks.filter((t) => t.kpId === kpId).sort((a, b) => a.sort - b.sort);
    const chId = kp?.chapterId ?? ts[0].chapterId ?? null;
    const row = buildRow(`kp:${kpId}`, "kp", kpId, kp ? kp.name : `#${kpId}（已删除）`, chId, kp?.sort ?? 0, ts, today, dateToCol, columns);
    pushRow(locate(chId).bucket, locate(chId).slot, row);
  }

  // 2) 测评/其他行（无 KP 任务，按 chapterId 分桶，固定进本桶的 test/other 槽位）
  const noKpTasks = inTasks.filter((t) => t.kpId == null);
  const noKpByCh = new Map<number, { test: StudyTask[]; other: StudyTask[] }>();
  for (const t of noKpTasks) {
    const k = t.chapterId ?? 0;
    const list = noKpByCh.get(k) ?? { test: [], other: [] };
    (t.taskType === "test" ? list.test : list.other).push(t);
    noKpByCh.set(k, list);
  }
  for (const [k, list] of noKpByCh) {
    const bucket = locate(k === 0 ? null : k).bucket;
    if (list.test.length) {
      pushRow(bucket, "test", buildRow(`test:${k || "none"}`, "test", null, "测评", k || null, 9000, list.test, today, dateToCol, columns));
    }
    if (list.other.length) {
      pushRow(bucket, "other", buildRow(`other:${k || "none"}`, "other", null, "其他任务", k || null, 9001, list.other, today, dateToCol, columns));
    }
  }

  // 3) 组装章行（节 → 直属 → 其他 → 测评）
  const assemble = (bucket: ChBucket): GanttChapter => {
    const units: GanttUnit[] = [];
    if (bucket.id != null) {
      const unitNodes = chapters
        .filter((c) => c.parentId === bucket.id && c.level === "unit")
        .sort((a, b) => a.sort - b.sort);
      for (const u of unitNodes) {
        const rows = (bucket.slots.get(`u:${u.id}`) ?? []).sort((a, b) => a.sort - b.sort);
        if (rows.length) units.push({ name: u.name, rows });
      }
    }
    for (const [slot, title] of [["direct", null], ["other", null], ["test", null]] as const) {
      const rows = (bucket.slots.get(slot) ?? []).sort((a, b) => a.sort - b.sort);
      if (rows.length) units.push({ name: title, rows });
    }
    const rows = units.flatMap((u) => u.rows);
    return {
      key: bucket.id == null ? "ch:ungrouped" : `ch:${bucket.id}`,
      chapterId: bucket.id,
      name: bucket.name,
      sort: bucket.sort,
      units,
      rows,
      total: rows.reduce((s, r) => s + r.total, 0),
      done: rows.reduce((s, r) => s + r.done, 0),
      overdue: rows.reduce((s, r) => s + r.overdue, 0),
    };
  };

  const resultChapters: GanttChapter[] = [];
  for (const ch of topLevel) {
    const bucket = buckets.get(ch.id)!;
    if (bucket.slots.size) resultChapters.push(assemble(bucket));
  }
  if (ungrouped.slots.size) resultChapters.push(assemble(ungrouped));

  const { weeks, weekShift } = colUnit === "day" && dates.length ? buildWeeks(dates) : { weeks: [], weekShift: 0 };
  const { index: todayIndex, frac: todayFrac } = locateToday(columns, colUnit, today);
  return {
    start,
    end,
    colUnit,
    columns,
    dates,
    months: buildMonthSpans(columns),
    weeks,
    weekShift,
    today,
    todayIndex,
    todayFrac,
    chapters: resultChapters,
  };
}
