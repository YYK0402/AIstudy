<template>
  <div class="ai-study-app">
    <Sidebar />
    <main class="main">
      <Topbar />
      <div class="content">
        <router-view />
      </div>
    </main>
    <NewCourseModal />
    <NewProviderModal />
    <UploadMaterialModal />
  </div>
</template>

<script setup lang="ts">
import Sidebar from "./components/Sidebar.vue";
import Topbar from "./components/Topbar.vue";
import NewCourseModal from "./components/NewCourseModal.vue";
import NewProviderModal from "./components/NewProviderModal.vue";
import UploadMaterialModal from "./components/UploadMaterialModal.vue";
</script>
