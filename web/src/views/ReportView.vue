<template>
  <div class="page">
    <div class="page-title"><h1>学习报告</h1><div class="desc">学习统计 · 薄弱知识点分析</div></div>

    <div v-if="!currentCourseId()" class="card">
      <div class="empty-state"><span class="ico">📭</span> 请先在「课程主页」选择或创建一个课程</div>
    </div>

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

      <div class="card" style="margin-top:14px">
        <h3>AI 综合报告
          <span style="margin-left:auto;display:flex;gap:8px">
            <button v-if="report" class="btn sm ghost" :disabled="generating" @click="copyReport">复制全文</button>
            <button v-if="report" class="btn sm ghost" :disabled="generating" @click="downloadReport">下载 .md</button>
            <button class="btn primary sm" :disabled="generating" @click="generate">
              {{ generating ? "生成中…" : report ? "重新生成" : "⚡ 生成报告" }}
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
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useCourseStore } from "../stores/course";
import { queryCourseStats, generateCourseReport } from "../api";
import type { CourseStats, Mastery } from "../api";

const courseStore = useCourseStore();
const currentCourseId = () => courseStore.currentCourseId;

const stats = ref<CourseStats>({
  kp: { total: 0, distribution: { unlearn: 0, known: 0, mastered: 0, proficient: 0 } },
  quiz: { total: 0, correct: 0, accuracy: "", essayAvgScore: "", wrongCount: 0 },
  explain: { total: 0, avgScore: "" },
  review: { touchpoints: 0, totalReviews: 0 },
  plan: { done: 0, total: 0 },
});
const report = ref("");
const generating = ref(false);
const reportError = ref("");
const copyOk = ref(false);

const MASTERY_ORDER: Mastery[] = ["proficient", "mastered", "known", "unlearn"];
const MASTERY_LABELS: Record<Mastery, string> = { unlearn: "未学习", known: "了解", mastered: "掌握", proficient: "精通" };

const masteredCount = computed(() => stats.value.kp.distribution.mastered + stats.value.kp.distribution.proficient);

function distPct(m: Mastery): number {
  const total = stats.value.kp.total;
  return total ? Math.round((stats.value.kp.distribution[m] / total) * 1000) / 10 : 0;
}

async function load() {
  report.value = "";
  reportError.value = "";
  if (!currentCourseId()) return;
  stats.value = await queryCourseStats(currentCourseId());
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
