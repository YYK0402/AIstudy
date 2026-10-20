<template>
  <div class="page">
    <div class="page-title"><h1>错题本</h1><div class="desc">答错自动归集 · 反复训练</div></div>

    <div v-if="!currentCourseId" class="card">
      <div class="empty-state"><span class="ico">📭</span> 请先在「课程主页」选择或创建一个课程</div>
    </div>

    <div v-else class="card">
      <h3>错题列表
        <span style="margin-left:auto;font-size:11px;color:var(--as-text-faint)">共 {{ wrongList.length }} 题</span>
      </h3>
      <div v-if="wrongList.length === 0" class="empty-state" style="padding:24px 0">
        <span class="ico">🎯</span> 暂无错题<br />刷题时答错的题目会自动归集到这里
      </div>
      <div v-else class="q-list">
        <div v-for="w in wrongList" :key="w.wrong.id" class="q-fixed">
          <div class="top">
            <span class="tag" :class="w.question.qType"><span class="d"></span>{{ QUESTION_TYPE_LABELS[w.question.qType as QuestionType] }}</span>
            <span class="wrong-times">答错 {{ w.wrong.reviewTimes }} 次</span>
          </div>
          <div class="title">{{ w.question.title }}</div>
          <div class="foot">
            <span>{{ formatTime(w.wrong.createTime) }}</span>
            <span style="margin-left:auto"></span>
            <button class="btn sm ghost" @click="del(w)">移出</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { useCourseStore } from "../stores/course";
import { queryWrongQuestions, deleteWrongQuestion, QUESTION_TYPE_LABELS } from "../api";
import type { WrongQuestion, Question, QuestionType } from "../api";

const courseStore = useCourseStore();
const currentCourseId = () => courseStore.currentCourseId;

const wrongList = ref<Array<{ wrong: WrongQuestion; question: Question }>>([]);

async function load() {
  if (!currentCourseId()) {
    wrongList.value = [];
    return;
  }
  wrongList.value = await queryWrongQuestions(currentCourseId());
}

async function del(w: { wrong: WrongQuestion }) {
  try {
    await deleteWrongQuestion(w.wrong.id);
    wrongList.value = wrongList.value.filter((x) => x.wrong.id !== w.wrong.id);
  } catch (e) {
    console.error("移出错题失败:", e);
  }
}

function formatTime(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

watch(
  () => courseStore.currentCourseId,
  () => load(),
);

onMounted(load);
</script>
