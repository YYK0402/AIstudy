<template>
  <div class="page">
    <div class="hero">
      <div class="greet">晚上好，专心者<small>{{ courseStore.courses.length }} 门课程 · 点击课程卡片开始学习</small></div>
      <div class="streak"><div class="num">{{ courseStore.courses.length }}</div><div class="lbl">我的课程</div></div>
    </div>

    <div class="section-head">
      <h2>我的课程</h2><span class="hint">点击卡片进入课程继续学习</span>
      <button class="btn sm" @click="modalStore.openNewCourse()">＋ 新建课程</button>
    </div>
    <div class="course-grid">
      <div v-for="c in courseStore.courses" :key="c.id" class="course-card" @click="enterCourse(c)">
        <div class="cc-top">
          <div class="cc-icon" style="background:var(--as-accent-soft)">{{ emojiOf(c.id) }}</div>
          <div><div class="cc-name">{{ c.name }}</div><div class="cc-desc">{{ c.description || "尚未添加简介" }}</div></div>
        </div>
        <div class="cc-stats" style="margin-top:14px"><span>创建于 {{ formatDate(c.createTime) }}</span></div>
        <div class="cc-foot"><span class="cc-todo" style="color:var(--as-text-faint)">○ 暂无学习记录</span><span class="cc-go">开始学习 →</span></div>
      </div>
      <div class="course-card add" @click="modalStore.openNewCourse()">
        <span class="plus">＋</span>
        <span class="txt">新建一门课程</span>
      </div>
    </div>

    <div class="section-head">
      <h2>今日任务</h2><span class="hint">跨课程汇总 · 按学习计划自动生成</span>
    </div>
    <div class="card">
      <div v-if="todayTasks.length === 0" class="empty-state">
        <span class="ico">📭</span>
        暂无待办任务，创建课程并生成学习计划后，任务会显示在这里
      </div>
      <div v-else class="today-list" style="padding:4px 0">
        <div v-for="task in todayTasks" :key="task.title" class="today-item" :class="{ done: task.done }" @click="task.done = !task.done">
          <div class="ico" :style="{ background: task.color }"><span style="font-size:14px">{{ task.icon }}</span></div>
          <div class="info"><div class="t">{{ task.title }}</div><div class="s">{{ task.sub }}</div></div>
          <span class="today-badge">{{ task.course }}</span>
          <div class="done"></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive } from "vue";
import { useRouter } from "vue-router";
import { useCourseStore } from "../stores/course";
import { useModalStore } from "../stores/modal";
import { emojiOf } from "../utils";
import type { Course } from "../api";

const router = useRouter();
const courseStore = useCourseStore();
const modalStore = useModalStore();

const todayTasks = reactive<Array<{ title: string; sub: string; course: string; icon: string; color: string; done: boolean }>>([]);

function enterCourse(course: Course) {
  courseStore.setCurrent(course.id);
  router.push("/course");
}

function formatDate(iso: string): string {
  if (!iso) {
    return "";
  }
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
</script>
