<template>
  <div class="topbar">
    <div class="crumbs">研习 <span class="sep">/</span> <span class="cur">{{ title }}</span></div>
    <div class="spacer"></div>
    <div class="topbar-today">
      <span class="dot"></span> 今日待完成 <b>6</b> 项 · <b>5</b> 知识点复习 · <b>3</b> 道错题
    </div>
    <button class="theme-toggle" title="切换明暗主题" @click="theme.toggle()">
      <svg class="ic-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="4.5" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
      <svg class="ic-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />
      </svg>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useThemeStore } from "../stores/theme";

const route = useRoute();
const theme = useThemeStore();

const titleMap: Record<string, string> = {
  home: "学习首页",
  course: "课程主页",
  content: "课程内容",
  plan: "学习计划",
  study: "开始学习",
  quiz: "刷题练习",
  wrong: "错题本",
  graph: "知识图谱",
  report: "学习报告",
  settings: "模型配置",
};

const title = computed(() => titleMap[(route.name as string) ?? ""] ?? "学习首页");
</script>
