<template>
  <div class="ai-study-app">
    <Sidebar />
    <main class="main">
      <Topbar />
      <div class="content">
        <router-view />
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
</script>
