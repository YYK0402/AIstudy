<template>
  <template v-if="open">
    <div class="more-mask" @click.self="close"></div>
    <div class="more-sheet" role="dialog" aria-label="切换课程">
      <div class="cs-head">切换课程</div>
      <div v-if="courseStore.courses.length === 0" class="empty-state compact">
        还没有课程，先创建一个吧
      </div>
      <div
        v-for="c in courseStore.courses"
        :key="c.id"
        class="cs-item"
        :class="{ active: c.id === courseStore.currentCourseId, archived: c.status === 'archived' }"
        @click="select(c.id)"
      >
        <span class="cs-emoji" aria-hidden="true">{{ emojiOf(c.id) }}</span>
        <span class="cs-name">{{ c.name }}</span>
        <span v-if="c.status === 'archived'" class="tag archived-tag">已归档</span>
        <span v-if="c.id === courseStore.currentCourseId" class="cs-check">✓</span>
      </div>
      <div class="more-quick">
        <button type="button" class="btn" @click="addNew">＋ 新建课程</button>
      </div>
    </div>
  </template>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import { useCourseStore } from "../stores/course";
import { useModalStore } from "../stores/modal";
import { emojiOf } from "../utils";

defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: "close"): void }>();

const courseStore = useCourseStore();
const modalStore = useModalStore();

function close(): void {
  emit("close");
}

// 选中 = 切课程 + 关闭（移动端原地切换，不导航到课程主页）
function select(id: number): void {
  if (id !== courseStore.currentCourseId) courseStore.setCurrent(id);
  close();
}

function addNew(): void {
  close();
  modalStore.openNewCourse();
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") close();
}

onMounted(() => {
  void courseStore.ensureLoaded();
  document.addEventListener("keydown", onKeydown);
});
onBeforeUnmount(() => document.removeEventListener("keydown", onKeydown));
</script>
