<template>
  <div class="gantt" ref="ganttRef">
    <div class="gantt-scroll">
      <!-- 月份行 -->
      <div class="gantt-row gantt-month-row">
        <div class="gantt-left"></div>
        <div class="gantt-track" :style="trackStyle">
          <div
            v-for="m in model.months"
            :key="m.start"
            class="gantt-month"
            :style="{ left: px(m.start * colW), width: px(m.count * colW) }"
          >{{ m.label }}</div>
        </div>
      </div>
      <!-- 周行（天列）：每段 label = 该周周一 M/D -->
      <div v-if="isDay" class="gantt-row gantt-week-row">
        <div class="gantt-left"></div>
        <div class="gantt-track" :style="trackStyle">
          <div
            v-for="w in model.weeks"
            :key="w.start"
            class="gantt-week"
            :style="{ left: px(w.start * colW), width: px(w.count * colW) }"
          >{{ w.label }}</div>
        </div>
      </div>
      <!-- 星期行（天列）：一…日，今天竖线 -->
      <div v-if="isDay" class="gantt-row gantt-wd-row">
        <div class="gantt-left"></div>
        <div class="gantt-track" :style="trackStyle">
          <template v-for="(d, i) in model.dates" :key="d">
            <div
              class="gantt-wd"
              :class="{ wknd: isWknd(d), today: d === model.today }"
              :style="{ left: px(i * colW), width: px(colW) }"
              :title="d"
            >{{ wdLabel(d) }}</div>
          </template>
          <div v-if="model.todayIndex >= 0" class="gantt-today-line" :style="{ left: todayLineX }" />
        </div>
      </div>
      <!-- 周标签行（周列）：每列 label = 该周周一 M/D -->
      <div v-if="model.colUnit === 'week'" class="gantt-row gantt-wklabel-row">
        <div class="gantt-left"></div>
        <div class="gantt-track" :style="trackStyle">
          <div
            v-for="(c, i) in model.columns"
            :key="c.key"
            class="gantt-wklabel"
            :style="{ left: px(i * colW), width: px(colW) }"
            :title="`${c.start} ~ ${c.end}`"
          >{{ c.label }}</div>
        </div>
      </div>
      <!-- 章/行区 -->
      <template v-for="ch in model.chapters" :key="ch.key">
        <div class="gantt-row gantt-ch-row" :class="{ expanded: isChOpen(ch.key) }">
          <div class="gantt-left gantt-ch-left" @click="emit('toggle-chapter', ch.key)">
            <AppIcon :name="isChOpen(ch.key) ? 'chevron-down' : 'chevron-right'" :size="12" class="gantt-ch-tgl" />
            <span class="gantt-ch-name">{{ ch.name }}</span>
            <span v-if="ch.overdue" class="tag overdue" :title="`${ch.overdue} 条过期未完成`">{{ ch.overdue }}</span>
            <span class="gantt-ch-prog">{{ ch.done }}/{{ ch.total }}</span>
            <span class="gantt-ch-bar"><ProgressBar :value="ch.done" :max="ch.total" tone="green" sm /></span>
          </div>
          <div class="gantt-track" :style="trackStyle">
            <div
              v-if="chBarStyle(ch)"
              class="gantt-bar gantt-bar-ch"
              :class="{ full: ch.done === ch.total && ch.total > 0 }"
              :style="chBarStyle(ch)"
              :title="`${ch.name}：${ch.done}/${ch.total} 完成`"
            />
            <div v-if="model.todayIndex >= 0" class="gantt-today-line" :style="{ left: todayLineX }" />
          </div>
        </div>
        <template v-if="isChOpen(ch.key)">
          <GanttUnitNode
            v-for="(u, ui) in ch.units"
            :key="ui + ':' + (u.name || '')"
            :unit="u"
            :depth="1"
            :col-w="colW"
            :track-style="trackStyle"
            :today-line-x="todayLineX"
            :show-today-line="model.todayIndex >= 0"
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
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import AppIcon from "./AppIcon.vue";
import GanttUnitNode from "./GanttUnitNode.vue";
import ProgressBar from "./ProgressBar.vue";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { dowOf, type GanttChapter, type GanttModel } from "../api/planGantt";
import type { StudyTask } from "../types/appData";

/** 左侧标签栏宽度，px（与 style.css .gantt-left 一致） */
const LEFT_W = 220;
/** 每列最小宽度：列宽被压缩到该值以下时改为横向滚动 */
const MIN_COL = 12;

/** 数字 → 带单位字符串：CSSOM 不接收无单位长度（非 0 数字会被静默丢弃） */
const px = (n: number): string => `${n}px`;

const props = defineProps<{
  model: GanttModel;
  archived: boolean;
  pendingTaskIds: Set<number>;
  expandedChapters: Set<string>;
  expandedCells: Set<string>;
  postponeBusy: boolean;
}>();

const emit = defineEmits<{
  (e: "toggle-chapter", key: string): void;
  (e: "toggle-row", tasks: StudyTask[]): void;
  (e: "toggle-cell", key: string): void;
  (e: "postpone-tasks", tasks: StudyTask[]): void;
}>();

// 列宽自适应：日期轨道占满卡片剩余宽度（容器宽 - 左栏），ResizeObserver 跟随窗口变化
const ganttRef = ref<HTMLElement | null>(null);
const availW = ref(0);
let ro: ResizeObserver | null = null;
onMounted(() => {
  const el = ganttRef.value;
  if (!el) return;
  const measure = () => {
    availW.value = Math.max(0, el.clientWidth - LEFT_W);
  };
  measure();
  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(measure);
    ro.observe(el);
  }
});
onBeforeUnmount(() => ro?.disconnect());

const isDay = computed(() => props.model.colUnit === "day");

const colW = computed(() =>
  availW.value > 0 ? Math.max(MIN_COL, availW.value / props.model.columns.length) : 16,
);

/** 今天竖线 x：天列=今天列中点；周/月列=今天在该列内的比例位置 */
const todayLineX = computed(() =>
  px((props.model.todayIndex + props.model.todayFrac) * colW.value),
);

/**
 * 网格线背景（天列三层，自上而下：周线 > 日分隔线 > 周末底纹）。
 * 周一相位 O 直接烘焙进各层色标（而非 background-position 平移，平移会在左侧留空隙）：
 * 周期 P=7 列，O = 首个周一相对轨道左缘的偏移；O=0 时首列即周一。
 * 周/月列：仅每列边界 1px 线。
 */
const gridBg = computed(() => {
  const c = colW.value;
  if (!isDay.value) {
    return `repeating-linear-gradient(90deg, var(--as-border) 0px 1px, transparent 1px ${c}px)`;
  }
  const P = 7 * c;
  const O = ((7 - props.model.weekShift) % 7) * c;
  const f = (n: number): string => `${n}px`;
  // 周线：1px，位于 O + kP
  const weekLine =
    O <= 0
      ? `repeating-linear-gradient(90deg, var(--as-border) 0px 1px, transparent 1px ${f(P)})`
      : `repeating-linear-gradient(90deg, transparent 0px ${f(O)}, var(--as-border) ${f(O)} ${f(O + 1)}, transparent ${f(O + 1)} ${f(P)})`;
  // 日分隔线：1px，每列边界，无需相位
  const dayLine = `repeating-linear-gradient(90deg, var(--as-border-soft) 0px 1px, transparent 1px ${f(c)})`;
  // 周末底纹：每周的周六+周日（周一前 2 列）
  const wknd =
    O >= 2 * c
      ? `repeating-linear-gradient(90deg, transparent 0px ${f(O - 2 * c)}, var(--as-bg-elev2) ${f(O - 2 * c)} ${f(O)}, transparent ${f(O)} ${f(P)})`
      : O <= 0
        ? `repeating-linear-gradient(90deg, transparent 0px ${f(5 * c)}, var(--as-bg-elev2) ${f(5 * c)} ${f(P)})`
        : `repeating-linear-gradient(90deg, var(--as-bg-elev2) 0px ${f(O)}, transparent ${f(O)} ${f(O + 5 * c)}, var(--as-bg-elev2) ${f(O + 5 * c)} ${f(P)})`;
  return `${weekLine}, ${dayLine}, ${wknd}`;
});

const trackStyle = computed(() => ({
  width: px(colW.value * props.model.columns.length),
  backgroundImage: gridBg.value,
}));

const WD = ["一", "二", "三", "四", "五", "六", "日"];
const wdLabel = (date: string): string => WD[dowOf(date)];
const isWknd = (date: string): boolean => {
  const dow = dowOf(date);
  return dow === 5 || dow === 6;
};

const isChOpen = (key: string): boolean => props.expandedChapters.has(key);

/** 章整体条：章内所有行首末列的并集范围 */
function chBarStyle(ch: GanttChapter): { left: string; width: string } | null {
  let min = -1;
  let max = -1;
  for (const row of ch.rows) {
    if (row.barColStart < 0) continue;
    if (min < 0 || row.barColStart < min) min = row.barColStart;
    if (row.barColEnd > max) max = row.barColEnd;
  }
  if (min < 0) return null;
  return { left: px(min * colW.value), width: px((max - min + 1) * colW.value - 2) };
}

</script>
