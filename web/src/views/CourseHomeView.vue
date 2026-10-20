<template>
  <div class="page">
    <div class="hero">
      <div class="greet">
        {{ courseName }}<small>{{ courseDesc || "暂无简介" }}</small>
        <button v-if="courseStore.currentCourse" class="btn sm" style="margin-top:12px" @click="openEdit">✎ 编辑课程信息</button>
      </div>
      <div class="streak"><div class="num">0</div><div class="lbl">已掌握知识点</div></div>
    </div>

    <div class="stat-grid">
      <div class="stat"><div class="k"><span class="dot" style="background:var(--as-green)"></span>已掌握知识点</div><div class="v">0<span> / 0</span></div></div>
      <div class="stat"><div class="k"><span class="dot" style="background:var(--as-accent)"></span>待复习</div><div class="v">0</div></div>
      <div class="stat"><div class="k"><span class="dot" style="background:var(--as-red)"></span>错题待攻克</div><div class="v">0</div></div>
      <div class="stat"><div class="k"><span class="dot" style="background:var(--as-blue)"></span>题目总数</div><div class="v">0</div></div>
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
import { useModalStore } from "../stores/modal";

const courseStore = useCourseStore();
const modalStore = useModalStore();
const courseName = computed(() => courseStore.currentCourse?.name ?? "课程");
const courseDesc = computed(() => courseStore.currentCourse?.description ?? "");

function openEdit() {
  const course = courseStore.currentCourse;
  if (course) {
    modalStore.openEditCourse(course);
  }
}
</script>
