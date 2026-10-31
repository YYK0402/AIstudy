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
    <ChangelogModal v-if="modalStore.changelogOpen" />
    <ConfirmModal v-if="modalStore.confirmOpen" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import Sidebar from "./components/Sidebar.vue";
import Topbar from "./components/Topbar.vue";
import NewCourseModal from "./components/NewCourseModal.vue";
import NewProviderModal from "./components/NewProviderModal.vue";
import UploadMaterialModal from "./components/UploadMaterialModal.vue";
import ChapterTreePreviewModal from "./components/ChapterTreePreviewModal.vue";
import ChangelogModal from "./components/ChangelogModal.vue";
import ConfirmModal from "./components/ConfirmModal.vue";
import { useModalStore } from "./stores/modal";
import { CHANGELOG, changelogSince } from "./constants/changelog";
import { isNewerVersion } from "./utils/version";

const modalStore = useModalStore();

// 需要 keep-alive 缓存的视图 name（与各自 defineOptions({ name }) 对应，改动需同步）
const cachedViews = ["CourseContentView", "QuizView", "WrongView", "FlashcardsView", "ReportView"];

// ===== 更新说明：版本变化后首次启动弹增量，关闭后记录当前版本 =====
const SEEN_KEY = "aiStudy.seenChangelogVersion";
const pendingSeenUpdate = ref<string | null>(null);

onMounted(() => {
  const current = __APP_VERSION__;
  const seen = localStorage.getItem(SEEN_KEY);
  if (seen == null) {
    // 首次安装：只记录版本，不弹
    localStorage.setItem(SEEN_KEY, current);
  } else if (isNewerVersion(current, seen)) {
    const diff = changelogSince(CHANGELOG, seen);
    if (diff.length > 0) {
      pendingSeenUpdate.value = current;
      modalStore.openChangelog(seen);
    } else {
      // 版本号更新了但内置 changelog 无对应条目：直接记录，不弹
      localStorage.setItem(SEEN_KEY, current);
    }
  }
});

watch(
  () => modalStore.changelogOpen,
  (open) => {
    if (!open && pendingSeenUpdate.value != null) {
      localStorage.setItem(SEEN_KEY, pendingSeenUpdate.value);
      pendingSeenUpdate.value = null;
    }
  }
);
</script>
