<template>
  <div class="page mobile-home">
    <!-- 课程行：当前课程 + 掌握进度 + 切换入口 -->
    <button type="button" class="mh-course-row" @click="sheetOpen = true">
      <span class="cs-emoji" aria-hidden="true">{{ currentCourse ? emojiOf(currentCourse.id) : "📚" }}</span>
      <span class="mh-course-name">{{ currentCourse?.name ?? "未选择课程" }}</span>
      <span v-if="kpTotal > 0" class="mh-course-prog">{{ kpMastered }}/{{ kpTotal }} 已掌握</span>
      <span class="chev" aria-hidden="true">▾</span>
    </button>

    <!-- 今日任务：跨课程聚合（与桌面首页同一数据源 todayStore） -->
    <div class="section-head">
      <h2>今日任务</h2>
      <span class="hint">跨课程 · 计划 + 到期间隔复习</span>
    </div>
    <div class="card">
      <SkeletonList v-if="todayStore.loading && todayStore.groups.length === 0" :rows="4" />
      <LoadError
        v-else-if="todayStore.loadError && todayStore.groups.length === 0"
        :message="todayStore.loadError"
        @retry="todayStore.load"
      />
      <div v-else-if="todayStore.groups.length === 0" class="empty-state compact">
        暂无待办任务<br />
        <span class="hint">去学习计划创建，或等待间隔复习到期</span>
      </div>
      <div v-else class="today-groups">
        <div v-for="g in todayStore.groups" :key="g.courseId" class="today-group">
          <div class="today-course" @click="todayStore.toggleCourse(g.courseId)">
            <span class="tc-emoji" aria-hidden="true">{{ emojiOf(g.courseId) }}</span>
            <span class="tc-name">{{ g.courseName }}</span>
            <span class="tc-sum">{{ g.tasks.length }} 个任务 · {{ taskCountsSummary(g.counts) }}</span>
            <span class="tc-prog">{{ g.doneCount }}/{{ g.tasks.length }} 完成</span>
            <ProgressBar :value="g.doneCount" :max="g.tasks.length" tone="green" sm />
            <button class="link-btn tc-tgl" @click.stop="todayStore.toggleCourse(g.courseId)">
              {{ todayStore.isCourseOpen(g.courseId) ? "收起" : "展开" }}
            </button>
          </div>
          <div v-if="todayStore.isCourseOpen(g.courseId)" class="today-list">
            <StudyTaskRow
              v-for="task in g.tasks"
              :key="task.kind + '-' + task.id"
              :title="task.title"
              :task-type="task.taskType"
              :done="task.done"
              :checkable="task.kind === 'plan'"
              :busy="todayStore.pendingTaskIds.has(task.id)"
              :action="taskAction(task)"
              dense
              @click="todayStore.openTask(task)"
              @toggle="todayStore.toggleTask(task)"
            />
          </div>
        </div>
      </div>
    </div>

    <CourseSwitcherSheet :open="sheetOpen" @close="sheetOpen = false" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useCourseStore } from "../../stores/course";
import { useTodayStore } from "../../stores/today";
import { useDataSavedRefresh } from "../../composables/useDataSaved";
import { taskAction, taskCountsSummary } from "../../constants/tasks";
import { getData } from "../../api";
import { emojiOf } from "../../utils";
import StudyTaskRow from "../StudyTaskRow.vue";
import ProgressBar from "../ProgressBar.vue";
import SkeletonList from "../SkeletonList.vue";
import LoadError from "../LoadError.vue";
import CourseSwitcherSheet from "../CourseSwitcherSheet.vue";

const courseStore = useCourseStore();
const todayStore = useTodayStore();
const sheetOpen = ref(false);
const kpMastered = ref(0);
const kpTotal = ref(0);
const currentCourse = computed(() => courseStore.currentCourse);

/** 当前课程掌握进度（口径与桌面课程卡片一致：mastered + proficient） */
async function loadKpStats(): Promise<void> {
  try {
    const data = await getData();
    const kps = data.knowledgePoints.filter((k) => k.courseId === courseStore.currentCourseId);
    kpTotal.value = kps.length;
    kpMastered.value = kps.filter((k) => k.mastery === "mastered" || k.mastery === "proficient").length;
  } catch (e) {
    console.error("课程掌握统计失败:", e);
  }
}

function refresh(): void {
  void todayStore.load().catch((e) => console.error("刷新今日任务失败:", e));
  void loadKpStats();
}

onMounted(() => {
  refresh();
});
useDataSavedRefresh(refresh);
</script>
