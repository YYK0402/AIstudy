<template>
  <div v-if="unit.name" class="gantt-row gantt-unit-row">
    <div class="gantt-left gantt-unit-left" :class="{ deep: depth >= 2 }">{{ unit.name }}</div>
    <div class="gantt-track" :style="trackStyle" />
  </div>
  <template v-for="row in unit.rows" :key="row.key">
    <div class="gantt-row gantt-kp-row" :class="{ done: row.done === row.total && row.total > 0 }">
      <div class="gantt-left gantt-kp-left">
        <button
          class="task-check"
          :disabled="archived || rowBusy(row)"
          :title="archived ? '课程已归档，任务只读' : rowBusy(row) ? '保存中…' : row.done === row.total ? '撤销完成' : '标记完成'"
          @click.stop="emit('toggle-row', row.tasks)"
        >
          <span v-if="rowBusy(row)" class="task-check-spinner" />
          <template v-else>{{ row.done === row.total ? "✓" : row.done > 0 ? "–" : "" }}</template>
        </button>
        <span class="gantt-kp-name" :title="row.name">{{ row.name }}</span>
        <span v-if="row.overdue" class="tag overdue" :title="`${row.overdue} 条过期未完成`">{{ row.overdue }}</span>
      </div>
      <div class="gantt-track" :style="trackStyle">
        <template v-for="cell in row.cells" :key="cell.colIndex">
          <div
            class="gantt-cell"
            :class="{ done: cell.done === cell.total, overdue: cell.overdue, open: isCellOpen(cellKey(row.key, cell.colIndex)) }"
            :style="{ left: px(cell.colIndex * colW), width: px(colW - 2) }"
            :title="cellTitle(cell)"
            @click="emit('toggle-cell', cellKey(row.key, cell.colIndex))"
          >
            <span
              v-for="seg in cell.segments"
              :key="seg.type"
              :class="`seg-${seg.type}`"
              :style="{ width: `${(seg.count / cell.total) * 100}%` }"
            />
          </div>
        </template>
        <div v-if="showTodayLine" class="gantt-today-line" :style="{ left: todayLineX }" />
      </div>
    </div>
    <!-- 单元格明细行 -->
    <template v-for="cell in row.cells" :key="`d-${cell.colIndex}`">
      <div v-if="isCellOpen(cellKey(row.key, cell.colIndex))" class="gantt-row gantt-detail-row">
        <div class="gantt-left"></div>
        <div class="gantt-detail" :style="{ marginLeft: px(cell.colIndex * colW) }">
          <div v-for="t in cell.tasks" :key="t.id" class="gantt-detail-task">
            <button
              class="task-check"
              :disabled="archived || pendingTaskIds.has(t.id)"
              @click.stop="emit('toggle-row', [t])"
            >
              <span v-if="pendingTaskIds.has(t.id)" class="task-check-spinner" />
              <template v-else>{{ t.status === "done" ? "✓" : "" }}</template>
            </button>
            <span v-if="!isDay" class="gantt-detail-date" :title="t.scheduledDate">{{ taskDateLabel(t) }}</span>
            <span class="gantt-detail-title" :class="{ done: t.status === 'done' }">{{ t.title || row.name }}</span>
            <span class="tag" :class="t.taskType"><span class="d"></span>{{ taskTypeLabel(t.taskType) }}</span>
            <router-link
              v-if="taskAction(t)"
              class="kp-act"
              :to="taskAction(t)!.to"
            >{{ taskAction(t)!.label }} →</router-link>
            <button
              v-if="cell.overdue && !archived"
              class="btn sm ghost gantt-postpone"
              :disabled="postponeBusy"
              @click.stop="emit('postpone-tasks', cell.tasks)"
            >顺延</button>
          </div>
        </div>
      </div>
    </template>
  </template>
  <GanttUnitNode
    v-for="(c, ci) in unit.children"
    :key="ci + ':' + (c.name || '')"
    :unit="c"
    :depth="depth + 1"
    :col-w="colW"
    :track-style="trackStyle"
    :today-line-x="todayLineX"
    :show-today-line="showTodayLine"
    :is-day="isDay"
    :archived="archived"
    :pending-task-ids="pendingTaskIds"
    :expanded-cells="expandedCells"
    :postpone-busy="postponeBusy"
    @toggle-row="emit('toggle-row', $event)"
    @toggle-cell="emit('toggle-cell', $event)"
    @postpone-tasks="emit('postpone-tasks', $event)"
  />
</template>

<script setup lang="ts">
import { taskTypeLabel } from "../constants/tasks";
import { dowOf, type GanttCell, type GanttRow, type GanttUnit } from "../api/planGantt";
import type { StudyTask } from "../types/appData";

const props = defineProps<{
  unit: GanttUnit;
  /** 1 = 章直属子章节（L2），向下逐级 +1 */
  depth: number;
  colW: number;
  trackStyle: Record<string, string>;
  /** 今天竖线 x（仅 showTodayLine 时有效） */
  todayLineX: string;
  /** 区间是否覆盖今天（model.todayIndex >= 0） */
  showTodayLine: boolean;
  isDay: boolean;
  archived: boolean;
  pendingTaskIds: Set<number>;
  expandedCells: Set<string>;
  postponeBusy: boolean;
}>();

const emit = defineEmits<{
  (e: "toggle-row", tasks: StudyTask[]): void;
  (e: "toggle-cell", key: string): void;
  (e: "postpone-tasks", tasks: StudyTask[]): void;
}>();

/** 数字 → 带单位字符串：CSSOM 不接收无单位长度（非 0 数字会被静默丢弃） */
const px = (n: number): string => `${n}px`;

const WD = ["一", "二", "三", "四", "五", "六", "日"];

const cellKey = (rowKey: string, colIndex: number): string => `${rowKey}:${colIndex}`;
const isCellOpen = (key: string): boolean => props.expandedCells.has(key);

const rowBusy = (row: GanttRow): boolean => row.tasks.some((t) => props.pendingTaskIds.has(t.id));

const cellTitle = (cell: GanttCell): string => {
  const range = cell.start === cell.end ? cell.start : `${cell.start} ~ ${cell.end}`;
  const segs = cell.segments.map((s) => `${taskTypeLabel(s.type)}×${s.count}`).join("、");
  return `${range} · ${segs}${cell.overdue ? " · 已过期" : ""} · ${cell.done}/${cell.total} 完成`;
};

/** 明细行任务日期标签（周/月列一个单元格含多天，需标日期） */
const taskDateLabel = (t: StudyTask): string => `${t.scheduledDate.slice(5).replace("-", "/")}（${WD[dowOf(t.scheduledDate)]}）`;

/** 明细行任务跳转（仅 KP 任务） */
const taskAction = (t: StudyTask): { to: { path: string; query: Record<string, string> }; label: string } | null => {
  if (t.kpId == null) return null;
  const map: Record<string, { path: string; label: string }> = {
    learn: { path: "/study", label: "去学习" },
    practice: { path: "/quiz", label: "去刷题" },
    review: { path: "/review", label: "去复习" },
  };
  const m = map[t.taskType];
  return m ? { to: { path: m.path, query: { kp: String(t.kpId) } }, label: m.label } : null;
};
</script>
