<template>
  <div class="page">
    <div class="page-title"><h1>开始学习</h1><div class="desc">冯诺依曼输出式学习 · 讲解 → 评估 → 补强</div></div>

    <div v-if="!currentCourseId()" class="card">
      <div class="empty-state"><span class="ico">📭</span> 请先在「课程主页」选择或创建一个课程</div>
    </div>

    <div v-else-if="knowledgePoints.length === 0" class="card">
      <div class="empty-state">
        <span class="ico">🌱</span>
        暂无待学习的知识点<br />请先在「课程内容」中上传资料并生成知识点
      </div>
      <div style="display:flex;justify-content:center;margin-top:16px">
        <router-link to="/content" class="btn primary">前往课程内容</router-link>
      </div>
    </div>

    <template v-else>
      <div class="card">
        <h3>选择知识点
          <span style="margin-left:auto;font-size:11px;color:var(--as-text-faint)">共 {{ knowledgePoints.length }} 个</span>
        </h3>
        <div class="kp-select">
          <button
            v-for="kp in knowledgePoints"
            :key="kp.id"
            class="kp-chip"
            :class="{ on: selectedKpId === kp.id }"
            @click="selectKp(kp.id)"
          >{{ kp.name }}</button>
        </div>
      </div>

      <div v-if="selectedKp" class="card" style="margin-top:14px">
        <h3>讲解 "{{ selectedKp.name }}"
          <span v-if="selectedKp.mastery" class="tag" :class="selectedKp.mastery" style="margin-left:auto">
            <span class="d"></span>{{ masteryLabel(selectedKp.mastery) }}
          </span>
        </h3>
        <details v-if="selectedKp.content" class="kp-ref">
          <summary>参考描述</summary>
          <div class="ref-body">{{ selectedKp.content }}</div>
        </details>
        <textarea
          v-model="explanation"
          class="essay-input"
          rows="8"
          placeholder="假如你是老师，用自己的话向别人讲清这个知识点：它是什么？为什么？举例说明…"
          :disabled="evaluating"
        />
        <div class="explain-actions">
          <button class="btn primary" :disabled="!explanation.trim() || evaluating" @click="submit">
            {{ evaluating ? "AI 评估中…" : "提交讲解" }}
          </button>
        </div>
        <div v-if="explainError" class="s" style="color:var(--as-red);margin-top:10px">✗ {{ explainError }}</div>

        <div v-if="lastResult" class="explain-result">
          <div class="score" :class="{ pass: lastResult.score >= 60, fail: lastResult.score < 60 }">
            {{ lastResult.score }} 分
          </div>
          <div class="fb">{{ lastResult.feedback || "AI 未给出具体点评" }}</div>
        </div>
      </div>

      <div v-if="selectedKp && history.length" class="card" style="margin-top:14px">
        <h3>讲解历史
          <span style="margin-left:auto;font-size:11px;color:var(--as-text-faint)">共 {{ history.length }} 次</span>
        </h3>
        <div v-for="r in history" :key="r.id" class="record-row">
          <div class="score-num" :class="Number(r.aiScore) >= 60 ? 'ok' : 'bad'">{{ r.aiScore }}</div>
          <div class="record-main">
            <div class="record-fb">{{ r.aiFeedback || "（无点评）" }}</div>
            <div class="record-time">{{ formatTime(r.createTime) }}</div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useCourseStore } from "../stores/course";
import { queryKnowledgePoints, submitExplain, queryExplainRecords } from "../api";
import type { KnowledgePoint, ExplainRecord, Mastery, ExplainResult } from "../api";

const courseStore = useCourseStore();
const currentCourseId = () => courseStore.currentCourseId;

const knowledgePoints = ref<KnowledgePoint[]>([]);
const selectedKpId = ref<number | null>(null);
const explanation = ref("");
const evaluating = ref(false);
const explainError = ref("");
const lastResult = ref<ExplainResult | null>(null);
const history = ref<ExplainRecord[]>([]);

const selectedKp = computed<KnowledgePoint | null>(() =>
  selectedKpId.value !== null
    ? knowledgePoints.value.find((k) => k.id === selectedKpId.value) ?? null
    : null,
);

const masteryLabel = (m: Mastery): string => {
  const map: Record<Mastery, string> = { unlearn: "未学习", known: "了解", mastered: "掌握", proficient: "精通" };
  return map[m];
};

function formatTime(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

async function load() {
  if (!currentCourseId()) {
    knowledgePoints.value = [];
    selectedKpId.value = null;
    history.value = [];
    return;
  }
  knowledgePoints.value = await queryKnowledgePoints(currentCourseId());
  if (selectedKpId.value !== null && !knowledgePoints.value.some((k) => k.id === selectedKpId.value)) {
    selectedKpId.value = null;
    history.value = [];
  }
}

async function selectKp(id: number) {
  selectedKpId.value = id;
  explanation.value = "";
  lastResult.value = null;
  explainError.value = "";
  try {
    history.value = await queryExplainRecords(id);
  } catch (e) {
    console.error("加载讲解历史失败:", e);
    history.value = [];
  }
}

async function submit() {
  const kp = selectedKp.value;
  const content = explanation.value.trim();
  if (!kp || !content || evaluating.value) return;
  evaluating.value = true;
  explainError.value = "";
  try {
    lastResult.value = await submitExplain(kp, content);
    history.value = await queryExplainRecords(kp.id);
  } catch (e) {
    explainError.value = e instanceof Error ? e.message : String(e);
  } finally {
    evaluating.value = false;
  }
}

watch(
  () => courseStore.currentCourseId,
  () => {
    selectedKpId.value = null;
    explanation.value = "";
    lastResult.value = null;
    explainError.value = "";
    history.value = [];
    load();
  },
);

onMounted(load);
</script>
