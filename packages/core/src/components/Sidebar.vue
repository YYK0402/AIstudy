<template>
  <aside class="sidebar">
    <div class="brand">
      <div class="brand-mark">
        <img :src="logoUrl" alt="" aria-hidden="true" />
      </div>
      <div>
        <div class="brand-name">研习</div>
        <div class="brand-sub">AI 智能学习</div>
      </div>
    </div>

    <div class="course-switch" ref="switchRef">
      <label>当前课程</label>
      <div class="course-select" role="button" tabindex="0" :aria-expanded="dropdownOpen" @click.stop="toggleDropdown" @keydown.enter.stop.prevent="toggleDropdown" @keydown.space.stop.prevent="toggleDropdown">
        <div class="course-emoji" aria-hidden="true">{{ currentEmoji }}</div>
        <span class="name">{{ currentName }}</span>
        <span class="chev" aria-hidden="true">▾</span>
      </div>
      <div class="course-dropdown" :class="{ open: dropdownOpen }">
        <div
          v-for="c in courseStore.courses"
          :key="c.id"
          class="cd-item"
          :class="{ active: c.id === courseStore.currentCourseId }"
          @click="selectCourse(c)"
        >
          <span class="cd-emoji" aria-hidden="true">{{ emojiOf(c.id) }}</span>{{ c.name }}
          <span class="cd-check">✓</span>
        </div>
        <div class="cd-add" @click="openNewCourse">＋ 新建课程</div>
      </div>
    </div>

    <nav class="nav">
      <template v-for="group in navGroups" :key="group.label">
        <div class="nav-section">{{ group.label }}</div>
        <router-link
          v-for="item in group.items"
          :key="item.to"
          :to="item.to"
          class="nav-item"
          active-class="active"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            v-html="navIcons[item.icon]"
          ></svg>
          <span class="lbl">{{ item.label }}</span>
          <span v-if="item.badge" class="badge">{{ item.badge }}</span>
        </router-link>
      </template>
    </nav>

    <div class="sidebar-foot">
      <div class="nav-item" role="button" tabindex="0" @click="openCommunity" @keydown.enter.prevent="openCommunity" @keydown.space.prevent="openCommunity">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          v-html="navIcons.community"
        ></svg>
        <span class="lbl">交流群</span>
      </div>
      <router-link to="/settings" class="nav-item" active-class="active">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          v-html="navIcons.settings"
        ></svg>
        <span class="lbl">模型配置</span>
      </router-link>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from "vue";
import { useRouter } from "vue-router";
import { useCourseStore } from "../stores/course";
import { useModalStore } from "../stores/modal";
import { queryCourses, queryWrongQuestions, queryDueFlashcardCount } from "../api";
import { useDataSavedRefresh } from "../composables/useDataSaved";
import { emojiOf } from "../utils";
import { navIcons } from "./navIcons";
// 品牌 logo 与插件图标同源（packages/siyuan/icon.png / 飞牛 ICON），改图标时三处同步
import logoUrl from "../assets/logo.png";
import type { Course } from "../api";

const courseStore = useCourseStore();
const modalStore = useModalStore();
const router = useRouter();

const dropdownOpen = ref(false);
const switchRef = ref<HTMLElement | null>(null);

// 当前课程错题数（0 时不显示角标）
const wrongCount = ref(0);
// 当前课程今日到期闪卡数（0 时不显示角标）
const cardDueCount = ref(0);

const navGroups = computed(() => [
  {
    label: "学习",
    items: [
      { to: "/", icon: "home", label: "学习首页" },
      { to: "/course", icon: "course", label: "课程主页" },
      { to: "/content", icon: "content", label: "课程内容" },
      { to: "/plan", icon: "plan", label: "学习计划" },
      { to: "/study", icon: "study", label: "开始学习" },
    ],
  },
  {
    label: "练习",
    items: [
      { to: "/quiz", icon: "quiz", label: "刷题练习" },
      { to: "/wrong", icon: "wrong", label: "错题本", badge: wrongCount.value },
      { to: "/cards", icon: "cards", label: "闪卡本", badge: cardDueCount.value },
      { to: "/review", icon: "repeat", label: "复习计划" },
      { to: "/graph", icon: "graph", label: "知识图谱" },
    ],
  },
  {
    label: "洞察",
    items: [{ to: "/report", icon: "report", label: "学习报告" }],
  },
]);

async function loadWrongCount() {
  const id = courseStore.currentCourseId;
  if (!id) {
    wrongCount.value = 0;
    return;
  }
  try {
    wrongCount.value = (await queryWrongQuestions(id)).length;
  } catch (e) {
    console.error("加载错题数失败:", e);
  }
}

async function loadCardDueCount() {
  const id = courseStore.currentCourseId;
  if (!id) {
    cardDueCount.value = 0;
    return;
  }
  try {
    cardDueCount.value = await queryDueFlashcardCount(id);
  } catch (e) {
    console.error("加载闪卡到期数失败:", e);
  }
}

// 计数按当前课程刷新；课程列表仅全局变化（建课/删课/归档）时刷新
useDataSavedRefresh(() => {
  loadWrongCount();
  loadCardDueCount();
});
useDataSavedRefresh(
  () => courseStore.refresh().catch((e) => console.error("刷新课程列表失败:", e)),
  { scope: "global" },
);

const currentName = computed(() => courseStore.currentCourse?.name ?? "暂无课程");
const currentEmoji = computed(() => {
  const c = courseStore.currentCourse;
  return c ? emojiOf(c.id) : "📚";
});

function toggleDropdown() {
  dropdownOpen.value = !dropdownOpen.value;
}

// 点击下拉外部关闭
function onDocPointerDown(e: PointerEvent) {
  if (!dropdownOpen.value) return;
  if (switchRef.value && !switchRef.value.contains(e.target as Node)) {
    dropdownOpen.value = false;
  }
}

// Esc 关闭下拉
function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape" && dropdownOpen.value) {
    dropdownOpen.value = false;
  }
}

function selectCourse(course: Course) {
  const switched = course.id !== courseStore.currentCourseId;
  courseStore.setCurrent(course.id);
  dropdownOpen.value = false;
  // 切换课程后自动跳到课程主页
  if (switched) {
    void router.push("/course");
  }
}

function openNewCourse() {
  dropdownOpen.value = false;
  modalStore.openNewCourse();
}

function openCommunity() {
  modalStore.openCommunity();
}

onMounted(async () => {
  if (courseStore.courses.length === 0) {
    try {
      const courses = await queryCourses();
      courseStore.setCourses(courses);
    } catch (error) {
      console.error("加载课程失败:", error);
    }
  }
  loadWrongCount();
  loadCardDueCount();
  document.addEventListener("pointerdown", onDocPointerDown);
  document.addEventListener("keydown", onKeydown);
});
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocPointerDown);
  document.removeEventListener("keydown", onKeydown);
});
watch(() => courseStore.currentCourseId, () => {
  loadWrongCount();
  loadCardDueCount();
});
</script>
