<template>
  <div class="app">
    <Sidebar />
    <main class="main">
      <Topbar />
      <div class="content">
        <router-view />
      </div>
    </main>
    <NewCourseModal />
    <NewProviderModal />
  </div>
</template>

<script setup lang="ts">
import Sidebar from "./components/Sidebar.vue";
import Topbar from "./components/Topbar.vue";
import NewCourseModal from "./components/NewCourseModal.vue";
import NewProviderModal from "./components/NewProviderModal.vue";
</script>
