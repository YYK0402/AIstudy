<template>
  <div class="page">
    <div class="page-title"><h1>学习报告</h1><div class="desc">学习统计 · 薄弱知识点分析</div></div>

    <div v-if="!currentCourseId()" class="card">
      <div class="empty-state"><span class="ico"><AppIcon name="folder" :size="28" /></span> 请先在「课程主页」选择或创建一个课程</div>
    </div>

    <template v-else>
      <SkeletonList v-if="loading" :rows="4" />
      <LoadError v-else-if="loadError" :message="loadError" @retry="load" />
      <template v-else>
      <div class="stat-grid">
        <div class="stat"><div class="k">知识点掌握</div><div class="v">{{ stats.kp.total }}<span> 个</span></div>
          <div v-if="stats.kp.total" class="sub">{{ masteredCount }}/{{ stats.kp.total }} 已掌握</div></div>
        <div class="stat"><div class="k">答题正确率</div><div class="v">{{ stats.quiz.accuracy || "—" }}</div>
          <div v-if="stats.quiz.total" class="sub">共答 {{ stats.quiz.total }} 题 · 错题 {{ stats.quiz.wrongCount }}</div></div>
        <div class="stat"><div class="k">讲解均分</div><div class="v">{{ stats.explain.avgScore || "—" }}
          <template v-if="stats.explain.total"><span> / 100</span></template></div>
          <div v-if="stats.explain.total" class="sub">共讲解 {{ stats.explain.total }} 次</div></div>
        <div class="stat"><div class="k">计划完成</div><div class="v">{{ stats.plan.done }}<span> / {{ stats.plan.total }}</span></div>
          <div v-if="stats.review.touchpoints" class="sub">复习触点 {{ stats.review.touchpoints }} · 累计 {{ stats.review.totalReviews }} 次</div></div>
        <div class="stat"><div class="k">学习时长</div><div class="v">{{ stats.study.totalSeconds > 0 ? formatDuration(stats.study.totalSeconds) : "—" }}</div>
          <div class="sub">答题/讲解/复习实际耗时</div></div>
      </div>

      <div class="card">
        <h3>近 30 天学习时长趋势
          <span v-if="trendHasData" style="margin-left:auto;font-size:11px;color:var(--as-text-faint)">{{ formatDuration(stats.study.totalSeconds) }} / 30 天</span>
        </h3>
        <div v-if="!trendHasData" class="empty-state" style="padding:20px 0">
          <span class="ico"><AppIcon name="clock" :size="28" /></span> 近 30 天暂无学习记录（答题、讲解、复习、打卡会自动计入）
        </div>
        <div v-else class="trend-wrap">
          <svg class="trend-svg" :viewBox="`0 0 ${trendWidth} ${TREND_H + 22}`" preserveAspectRatio="xMidYMax meet">
            <line x1="0" :y1="TREND_H" :x2="trendWidth" :y2="TREND_H" class="trend-axis" />
            <g v-for="(b, i) in trendBars" :key="b.date">
              <rect
                v-if="b.h > 0"
                :x="i * (TREND_BAR_W + TREND_GAP)"
                :y="TREND_H - b.h"
                :width="TREND_BAR_W"
                :height="b.h"
                rx="3"
                class="trend-bar"
                :class="{ today: b.isToday }"
              ><title>{{ b.tip }}</title></rect>
              <rect v-else :x="i * (TREND_BAR_W + TREND_GAP)" :y="TREND_H - 2" :width="TREND_BAR_W" height="2" rx="1" class="trend-bar zero" />
              <text v-if="i === 0 || i === 7 || i === 14 || i === 21 || i === 29" :x="i * (TREND_BAR_W + TREND_GAP) + TREND_BAR_W / 2" :y="TREND_H + 16" class="trend-label" text-anchor="middle">{{ b.label }}</text>
            </g>
          </svg>
        </div>
      </div>

      <div v-if="stats.kp.total" class="card">
        <h3>掌握度分布</h3>
        <div class="dist-bar">
          <div v-for="m in MASTERY_ORDER" :key="m" class="dist-seg" :class="m" :style="{ width: distPct(m) + '%' }">
            <span v-if="distPct(m) >= 12">{{ stats.kp.distribution[m] }}</span>
          </div>
        </div>
        <div class="dist-legend">
          <span v-for="m in MASTERY_ORDER" :key="m" class="leg"><i class="d" :class="m"></i>{{ MASTERY_LABELS[m] }} {{ stats.kp.distribution[m] }}</span>
        </div>
      </div>

      <div v-if="stats.kp.total > 0 && heatRows.length > 0" class="card" style="margin-top:14px">
        <h3>掌握度热力图</h3>
        <div class="hm-list">
          <div
            v-for="row in heatRows"
            :key="row.chapterId ?? -1"
            class="hm-row"
            :class="{ clickable: row.chapterId != null }"
            :title="row.chapterId != null ? '在课程内容中定位该章节' : ''"
            @click="goChapter(row.chapterId)"
          >
            <div class="hm-head">
              <span class="hm-name">{{ row.name }}</span>
              <span class="hm-progress">{{ row.mastered }}/{{ row.total }}</span>
            </div>
            <div class="hm-dots" @click.stop>
              <router-link
                v-for="c in row.kps"
                :key="c.id"
                class="hm-dot"
                :class="c.mastery"
                :title="`${c.name} · ${MASTERY_LABELS[c.mastery]}`"
                :to="{ path: '/study', query: { kp: String(c.id) } }"
              />
            </div>
          </div>
        </div>
        <div class="dist-legend" style="margin-top:12px">
          <span v-for="m in MASTERY_ORDER" :key="m" class="leg"><i class="d" :class="m"></i>{{ MASTERY_LABELS[m] }} {{ stats.kp.distribution[m] }}</span>
        </div>
      </div>

      <div v-if="stats.kp.total > 0 && (treeData.chapters.length > 0 || treeData.unassigned)" class="card" style="margin-top:14px">
        <h3>章节掌握树</h3>
        <div class="mtree">
          <template v-for="ch in treeData.chapters" :key="ch.id">
            <div class="mtree-node" :class="`lv-${ch.level}`">
              <span class="tag" :class="ch.level"><span class="d"></span>{{ MASTERY_LABELS[ch.level] }}</span>
              <span class="mtree-name">{{ ch.name }}</span>
              <span class="mtree-progress">{{ ch.mastered }}/{{ ch.total }}</span>
              <div class="mtree-bar">
                <i v-for="m in MASTERY_ORDER" :key="m" :class="m" :style="{ width: nodePct(ch, m) + '%' }"></i>
              </div>
            </div>
            <div v-if="ch.units.length > 0" class="mtree-children">
              <div v-for="u in ch.units" :key="u.id" class="mtree-node sm" :class="`lv-${u.level}`">
                <span class="mtree-name">{{ u.name }}</span>
                <span class="mtree-progress">{{ u.mastered }}/{{ u.total }}</span>
                <div class="mtree-bar">
                  <i v-for="m in MASTERY_ORDER" :key="m" :class="m" :style="{ width: nodePct(u, m) + '%' }"></i>
                </div>
              </div>
            </div>
          </template>
          <div v-if="treeData.unassigned" class="mtree-node" :class="`lv-${treeData.unassigned.level}`">
            <span class="tag" :class="treeData.unassigned.level"><span class="d"></span>{{ MASTERY_LABELS[treeData.unassigned.level] }}</span>
            <span class="mtree-name">{{ treeData.unassigned.name }}</span>
            <span class="mtree-progress">{{ treeData.unassigned.mastered }}/{{ treeData.unassigned.total }}</span>
            <div class="mtree-bar">
              <i v-for="m in MASTERY_ORDER" :key="m" :class="m" :style="{ width: nodePct(treeData.unassigned, m) + '%' }"></i>
            </div>
          </div>
        </div>
        <div class="mtree-note">等级 = 已掌握（掌握+精通）占比：≥100% 精通 · ≥60% 掌握 · ≥30% 了解 · 其余未学习</div>
      </div>

      <div class="card" style="margin-top:14px">
        <h3>薄弱点清单 TOP {{ weakKps.length }}</h3>
        <div v-if="weakKps.length === 0" class="empty-state" style="padding:20px 0">
          <span class="ico">💪</span> 暂无明显薄弱点（未掌握 + 低分讲解 + 高频错题加权排序）
        </div>
        <div v-else class="weak-list">
          <div v-for="(w, i) in weakKps" :key="w.kpId" class="weak-row">
            <span class="weak-rank">{{ i + 1 }}</span>
            <div class="weak-main">
              <div class="weak-name">{{ w.name }}</div>
              <div class="weak-reasons">
                <span v-for="r in w.reasons" :key="r" class="tag-chip">{{ r }}</span>
              </div>
            </div>
            <span class="tag" :class="w.mastery"><span class="d"></span>{{ MASTERY_LABELS[w.mastery] }}</span>
            <span class="weak-score">{{ w.score }}</span>
            <router-link class="btn sm ghost" :to="{ path: '/quiz', query: { kp: String(w.kpId) } }">去刷题</router-link>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:14px">
        <h3>AI 综合报告
          <span style="margin-left:auto;display:flex;gap:8px">
            <button v-if="report" class="btn sm ghost" :disabled="generating" @click="copyReport">复制全文</button>
            <button v-if="report" class="btn sm ghost" :disabled="generating" @click="downloadReport">下载 .md</button>
            <button class="btn primary sm" :disabled="generating" @click="generate">
              <AppIcon name="spark" :size="14" /> {{ generating ? "生成中…" : report ? "重新生成" : "生成报告" }}
            </button>
          </span>
        </h3>
        <div v-if="reportError" class="s" style="color:var(--as-red)">✗ {{ reportError }}</div>
        <div v-else-if="report" class="report-body">{{ report }}</div>
        <div v-else class="empty-state" style="padding:20px 0">
          <span class="ico">📊</span> 由 AI 根据上面的学习统计数据生成综合点评与建议，导出为 Markdown
        </div>
        <div v-if="copyOk" class="s" style="color:var(--as-green);margin-top:8px">✓ 已复制到剪贴板</div>
      </div>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import AppIcon from "../components/AppIcon.vue";
import SkeletonList from "../components/SkeletonList.vue";
import LoadError from "../components/LoadError.vue";
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useCourseStore } from "../stores/course";
import { queryCourseStats, generateCourseReport, getData, queryWrongQuestions, parseQuestionKpIds } from "../api";
import { rankWeakKps } from "../utils/weakKps";
import type { WeakKpEntry } from "../utils/weakKps";
import { formatDuration } from "../utils/studyTrend";
import { buildMasteryHeatmap } from "../utils/masteryHeatmap";
import type { HeatmapRow } from "../utils/masteryHeatmap";
import { buildMasteryTree } from "../utils/masteryTree";
import type { MasteryTree, MasteryTreeNode } from "../utils/masteryTree";
import { queryChapters } from "../api";
import type { CourseStats, Mastery } from "../api";

const courseStore = useCourseStore();
const currentCourseId = () => courseStore.currentCourseId;

const stats = ref<CourseStats>({
  kp: { total: 0, distribution: { unlearn: 0, known: 0, mastered: 0, proficient: 0 } },
  quiz: { total: 0, correct: 0, accuracy: "", essayAvgScore: "", wrongCount: 0 },
  explain: { total: 0, avgScore: "" },
  review: { touchpoints: 0, totalReviews: 0 },
  plan: { done: 0, total: 0 },
  study: { totalSeconds: 0, daily: [] },
  lastStudyTime: "",
});
const loading = ref(true);
const loadError = ref("");
const report = ref("");
const generating = ref(false);
const reportError = ref("");
const copyOk = ref(false);
const weakKps = ref<WeakKpEntry[]>([]);
const heatRows = ref<HeatmapRow[]>([]);
const treeData = ref<MasteryTree>({ chapters: [], unassigned: null });

const router = useRouter();

/** 热力图行 → 课程内容页定位到对应章节（未分配章节仅进入内容页） */
function goChapter(chapterId: number | null) {
  router.push({ path: "/content", query: chapterId != null ? { chapter: String(chapterId) } : {} });
}

const MASTERY_ORDER: Mastery[] = ["proficient", "mastered", "known", "unlearn"];
const MASTERY_LABELS: Record<Mastery, string> = { unlearn: "未学习", known: "了解", mastered: "掌握", proficient: "精通" };

const masteredCount = computed(() => stats.value.kp.distribution.mastered + stats.value.kp.distribution.proficient);

function distPct(m: Mastery): number {
  const total = stats.value.kp.total;
  return total ? Math.round((stats.value.kp.distribution[m] / total) * 1000) / 10 : 0;
}

// ===== 近 30 天时长趋势（SVG 柱状） =====
const trendHasData = computed(() => stats.value.study.totalSeconds > 0 || stats.value.study.daily.some((d) => d.actions > 0));

interface TrendBar {
  date: string;
  label: string;
  minutes: number;
  h: number; // SVG 高度（px）
  tip: string;
  isToday: boolean;
}

const TREND_H = 120; // 绘图区高度（px）
const TREND_BAR_W = 16;
const TREND_GAP = 6;

const trendBars = computed<TrendBar[]>(() => {
  const daily = stats.value.study.daily;
  if (daily.length === 0) return [];
  const maxSec = Math.max(...daily.map((d) => d.seconds), 60);
  const todayLabel = daily[daily.length - 1].date;
  return daily.map((d) => ({
    date: d.date,
    label: d.date.slice(5).replace("-", "/"),
    minutes: Math.round(d.seconds / 60),
    h: d.seconds > 0 ? Math.max(3, Math.round((d.seconds / maxSec) * (TREND_H - 14))) : 0,
    tip: `${d.date} · ${formatDuration(d.seconds)} · ${d.actions} 次学习`,
    isToday: d.date === todayLabel,
  }));
});
const trendWidth = computed(() => trendBars.value.length * (TREND_BAR_W + TREND_GAP) - TREND_GAP);

/** 树节点某档占比（0 知识点节点全空条） */
function nodePct(n: MasteryTreeNode, m: Mastery): number {
  return n.total ? Math.round((n.dist[m] / n.total) * 1000) / 10 : 0;
}

async function load() {
  loading.value = true;
  loadError.value = "";
  try {
  report.value = "";
  reportError.value = "";
  weakKps.value = [];
  heatRows.value = [];
  treeData.value = { chapters: [], unassigned: null };
  if (!currentCourseId()) return;
  stats.value = await queryCourseStats(currentCourseId());
  // 薄弱点：掌握度基础分 + 低分讲解 + 高频错题；热力图：章节 × 知识点矩阵
  try {
    const data = await getData();
    const kps = data.knowledgePoints.filter((k) => k.courseId === currentCourseId());
    const chapters = await queryChapters(currentCourseId());
    heatRows.value = buildMasteryHeatmap(kps, chapters);
    treeData.value = buildMasteryTree(kps, chapters);
    const wrongItems = await queryWrongQuestions(currentCourseId());
    const wrongKpCounts = new Map<number, number>();
    for (const { question } of wrongItems) {
      for (const id of parseQuestionKpIds(question)) {
        wrongKpCounts.set(id, (wrongKpCounts.get(id) ?? 0) + 1);
      }
    }
    weakKps.value = rankWeakKps({
      kps,
      explainScores: data.explainRecords.filter((r) => r.courseId === currentCourseId()),
      wrongKpCounts,
    });
  } catch (e) {
    console.error("加载薄弱点清单失败:", e);
  }
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : "加载学习报告失败";
    console.error("加载学习报告失败:", e);
  } finally {
    loading.value = false;
  }
}

async function generate() {
  const course = courseStore.currentCourse;
  if (!course) return;
  generating.value = true;
  reportError.value = "";
  try {
    report.value = await generateCourseReport(course, stats.value);
  } catch (e) {
    reportError.value = e instanceof Error ? e.message : String(e);
  } finally {
    generating.value = false;
  }
}

async function copyReport() {
  if (!report.value) return;
  try {
    await navigator.clipboard.writeText(report.value);
    copyOk.value = true;
    window.setTimeout(() => (copyOk.value = false), 2000);
  } catch (e) {
    console.error("复制报告失败:", e);
    reportError.value = "复制失败：浏览器剪贴板不可用，请尝试下载 .md";
  }
}

function downloadReport() {
  if (!report.value) return;
  const course = courseStore.currentCourse;
  const date = new Date();
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  const blob = new Blob([report.value], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = window.document.createElement("a");
  a.href = url;
  a.download = `${course?.name ?? "课程"}-学习报告-${stamp}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

watch(
  () => courseStore.currentCourseId,
  () => {
    generating.value = false;
    load();
  },
);

onMounted(load);
</script>
