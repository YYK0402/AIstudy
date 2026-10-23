<template>
  <aside class="sidebar">
    <div class="brand">
      <div class="brand-mark">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
          <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" />
        </svg>
      </div>
      <div>
        <div class="brand-name">研习</div>
        <div class="brand-sub">AI 智能学习</div>
      </div>
    </div>

    <div class="course-switch" ref="switchRef">
      <label>当前课程</label>
      <div class="course-select" @click.stop="toggleDropdown">
        <div class="course-emoji">{{ currentEmoji }}</div>
        <span class="name">{{ currentName }}</span>
        <span class="chev">▾</span>
      </div>
      <div class="course-dropdown" :class="{ open: dropdownOpen }">
        <div
          v-for="c in courseStore.courses"
          :key="c.id"
          class="cd-item"
          :class="{ active: c.id === courseStore.currentCourseId }"
          @click="selectCourse(c)"
        >
          <span class="cd-emoji">{{ emojiOf(c.id) }}</span>{{ c.name }}
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
            v-html="icons[item.icon]"
          ></svg>
          <span class="lbl">{{ item.label }}</span>
          <span v-if="item.badge" class="badge">{{ item.badge }}</span>
        </router-link>
      </template>
    </nav>

    <div class="sidebar-foot">
      <router-link to="/settings" class="nav-item" active-class="active">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          v-html="icons.settings"
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
import { queryCourses, queryWrongQuestions, DATA_SAVED_EVENT } from "../api";
import { emojiOf } from "../utils";
import type { Course } from "../api";

const courseStore = useCourseStore();
const modalStore = useModalStore();
const router = useRouter();

const dropdownOpen = ref(false);
const switchRef = ref<HTMLElement | null>(null);

// 当前课程错题数（0 时不显示角标）
const wrongCount = ref(0);

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

function onDataSaved() {
  loadWrongCount();
  // 课程状态（归档）/列表变化后同步 store，保证各页面读到的 status 最新
  courseStore.refresh().catch((e) => console.error("刷新课程列表失败:", e));
}

const icons: Record<string, string> = {
  home: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  course: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  content: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>',
  plan: '<path d="M8 2v4M16 2v4M3 9h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z"/><path d="M8 14h4l2-3 2 3h1"/>',
  study: '<path d="M12 6.5C10 4.5 7 4.5 5 6.5v11c2-2 5-2 7 0 2-2 5-2 7 0v-11c-2-2-5-2-7 0z"/><path d="M12 6.5V17.5"/>',
  quiz: '<path d="M4 4h16v16H4z"/><path d="M8 10h8M8 14h8"/><path d="M12 4v16"/>',
  wrong: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z"/><path d="M12 8v4M12 16h.01"/>',
  repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 014-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 01-4 4H3"/>',
  graph: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8 7.5l7-1M7.5 8l3.5 8M16.5 8l-3.5 8"/>',
  report: '<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/>',
};

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
  window.addEventListener(DATA_SAVED_EVENT, onDataSaved);
  document.addEventListener("pointerdown", onDocPointerDown);
  document.addEventListener("keydown", onKeydown);
});
onBeforeUnmount(() => {
  window.removeEventListener(DATA_SAVED_EVENT, onDataSaved);
  document.removeEventListener("pointerdown", onDocPointerDown);
  document.removeEventListener("keydown", onKeydown);
});
watch(() => courseStore.currentCourseId, loadWrongCount);
</script>
