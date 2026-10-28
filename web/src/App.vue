<template>
  <div class="ai-study-app">
    <Sidebar />
    <main class="main">
      <Topbar />
      <div class="content">
        <router-view v-slot="{ Component }">
          <keep-alive :include="cachedViews">
            <component :is="Component" />
          </keep-alive>
        </router-view>
      </div>
    </main>
    <NewCourseModal v-if="modalStore.newCourseOpen" />
    <NewProviderModal v-if="modalStore.newProviderOpen" />
    <UploadMaterialModal v-if="modalStore.uploadMaterialOpen" />
    <ChapterTreePreviewModal v-if="modalStore.chapterPreviewOpen" />
  </div>
</template>

<script setup lang="ts">
import Sidebar from "./components/Sidebar.vue";
import Topbar from "./components/Topbar.vue";
import NewCourseModal from "./components/NewCourseModal.vue";
import NewProviderModal from "./components/NewProviderModal.vue";
import UploadMaterialModal from "./components/UploadMaterialModal.vue";
import ChapterTreePreviewModal from "./components/ChapterTreePreviewModal.vue";
import { useModalStore } from "./stores/modal";

const modalStore = useModalStore();

// 需要 keep-alive 缓存的视图 name（与各自 defineOptions({ name }) 对应，改动需同步）
const cachedViews = ["CourseContentView", "QuizView", "WrongView", "FlashcardsView", "ReportView"];
</script>
