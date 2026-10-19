<template>
  <div class="page">
    <div class="hero">
      <div class="greet">{{ courseName }}<small>{{ courseDesc || "暂无简介" }}</small></div>
      <div class="streak"><div class="num">0</div><div class="lbl">已掌握知识点</div></div>
    </div>

    <div class="stat-grid">
      <div class="stat"><div class="k"><span class="dot" style="background:var(--green)"></span>已掌握知识点</div><div class="v">0<span> / 0</span></div></div>
      <div class="stat"><div class="k"><span class="dot" style="background:var(--accent)"></span>待复习</div><div class="v">0</div></div>
      <div class="stat"><div class="k"><span class="dot" style="background:var(--red)"></span>错题待攻克</div><div class="v">0</div></div>
      <div class="stat"><div class="k"><span class="dot" style="background:var(--blue)"></span>题目总数</div><div class="v">0</div></div>
    </div>

    <div class="two-col">
      <div class="card">
        <h3>本课程今日任务</h3>
        <div class="empty-state">
          <span class="ico">📭</span>
          暂无学习任务，先生成学习计划
        </div>
      </div>
      <div class="card">
        <h3>掌握度分布</h3>
        <div class="empty-state">
          <span class="ico">🌱</span>
          暂无知识点，上传资料后由 AI 解析生成
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useCourseStore } from "../stores/course";

const courseStore = useCourseStore();
const courseName = computed(() => courseStore.currentCourse?.name ?? "课程");
const courseDesc = computed(() => courseStore.currentCourse?.description ?? "");
</script>
