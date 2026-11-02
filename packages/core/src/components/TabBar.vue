<template>
  <nav class="tabbar" aria-label="主导航">
    <router-link v-for="t in tabs" :key="t.to" :to="t.to" class="tab" active-class="active">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" v-html="navIcons[t.icon]"></svg>
      <span class="t-lbl">{{ t.label }}</span>
      <span v-if="t.badge > 0" class="tab-badge">{{ t.badge > 99 ? "99+" : t.badge }}</span>
    </router-link>
    <button type="button" class="tab" :class="{ active: moreOpen }" :aria-expanded="moreOpen" @click="moreOpen = !moreOpen">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" v-html="navIcons.more"></svg>
      <span class="t-lbl">更多</span>
    </button>

    <!-- 更多：底部弹层（.more-mask/.more-sheet 样式见 style.css） -->
    <template v-if="moreOpen">
      <div class="more-mask" @click.self="closeMore"></div>
      <div class="more-sheet" role="dialog" aria-label="更多功能">
        <div class="more-grid">
          <button v-for="m in moreItems" :key="m.to" type="button" class="more-item" @click="go(m.to)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" v-html="navIcons[m.icon]"></svg>
            <span class="m-lbl">{{ m.label }}</span>
            <span v-if="m.badge > 0" class="tab-badge">{{ m.badge > 99 ? "99+" : m.badge }}</span>
          </button>
        </div>
        <div class="more-quick">
          <button type="button" class="btn" @click="quickNewCourse">＋ 新建课程</button>
          <button type="button" class="btn" @click="quickUpload">上传资料</button>
        </div>
      </div>
    </template>
  </nav>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useModalStore } from "../stores/modal";
import { useCourseStore } from "../stores/course";
import { useTodayStore } from "../stores/today";
import { getBridge } from "../bridge";
import { useDataSavedRefresh } from "../composables/useDataSaved";
import { useTabBadges } from "../composables/useTabBadges";
import { navIcons } from "./navIcons";

const router = useRouter();
const modalStore = useModalStore();
const courseStore = useCourseStore();
const todayStore = useTodayStore();
const badges = useTabBadges();
const moreOpen = ref(false);

interface TabDef {
  to: string;
  label: string;
  icon: string;
  badge: number;
}

const tabs = computed<TabDef[]>(() => [
  { to: "/", label: "首页", icon: "home", badge: 0 },
  { to: "/study", label: "学习", icon: "study", badge: 0 },
  { to: "/quiz", label: "刷题", icon: "quiz", badge: 0 },
  { to: "/review", label: "复习", icon: "repeat", badge: todayStore.dueReviewTotal },
]);

const moreItems = computed<TabDef[]>(() => [
  { to: "/wrong", label: "错题本", icon: "wrong", badge: badges.wrongTotal.value },
  { to: "/cards", label: "闪卡组", icon: "cards", badge: badges.cardDueTotal.value },
  { to: "/content", label: "课程内容", icon: "content", badge: 0 },
  { to: "/plan", label: "学习计划", icon: "plan", badge: 0 },
  { to: "/graph", label: "知识图谱", icon: "graph", badge: 0 },
  { to: "/report", label: "学习报告", icon: "report", badge: 0 },
  { to: "/settings", label: "模型设置", icon: "settings", badge: 0 },
]);

function closeMore(): void {
  moreOpen.value = false;
}

function go(to: string): void {
  closeMore();
  void router.push(to);
}

function quickNewCourse(): void {
  closeMore();
  modalStore.openNewCourse();
}

function quickUpload(): void {
  closeMore();
  if (!courseStore.currentCourseId) {
    getBridge().showMessage("请先创建课程");
    return;
  }
  modalStore.openUploadMaterial(courseStore.currentCourseId);
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") closeMore();
}

onMounted(() => {
  document.addEventListener("keydown", onKeydown);
  // 到期复习徽标随今日任务刷新
  void todayStore.load().catch((e) => console.error("刷新今日任务失败:", e));
  void badges.refresh();
});
onBeforeUnmount(() => document.removeEventListener("keydown", onKeydown));

// 任意课程数据变化都刷新徽标（错题/闪卡跨课程求和，200ms 防抖）
useDataSavedRefresh(() => void badges.refresh(), { scope: "any" });
</script>
