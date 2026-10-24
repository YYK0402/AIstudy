<template>
  <div class="task-row" :class="{ done, dense }">
    <button
      v-if="checkable"
      class="task-check"
      :disabled="disabled || busy"
      :title="disabled ? '课程已归档，任务只读' : busy ? '保存中…' : done ? '撤销完成' : '标记完成'"
      @click.stop="$emit('toggle')"
    >
      <span v-if="busy" class="task-check-spinner" />
      <template v-else>{{ checkState === 'partial' ? '–' : checkState === 'done' || done ? '✓' : '' }}</template>
    </button>
    <span v-else class="task-check" style="visibility:hidden"></span>
    <span class="task-ico" :class="`ti-${taskType}`">
      <AppIcon :name="taskTypeIcon(taskType)" :size="15" />
    </span>
    <div class="task-main">
      <div class="task-title" :title="title">{{ title }}</div>
      <div v-if="courseName || !hideTypeTag || chapterName" class="task-meta">
        <span v-if="courseName" class="task-course">{{ courseName }}</span>
        <span v-if="!hideTypeTag" class="tag" :class="taskType">
          <span class="d"></span>{{ taskTypeLabel(taskType) }}
        </span>
        <span v-if="chapterName" class="task-chapter" :title="chapterName">{{ chapterName }}</span>
      </div>
    </div>
    <span v-if="$slots.extra" class="task-extra"><slot name="extra" /></span>
    <router-link v-if="resolvedAction" class="task-act" :to="resolvedAction.to" @click.stop>{{ resolvedAction.label }} →</router-link>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import AppIcon from "./AppIcon.vue";
import { taskAction, taskTypeIcon, taskTypeLabel, type TaskAction } from "../constants/tasks";

const props = withDefaults(
  defineProps<{
    title: string;
    taskType: string;
    done?: boolean;
    /** 勾选状态：done 已完成 / partial 部分完成（学习计划多任务行） / none */
    checkState?: "done" | "partial" | "none";
    checkable?: boolean;
    disabled?: boolean;
    /** 勾选写入中：按钮显示转圈并禁用 */
    busy?: boolean;
    courseName?: string;
    chapterName?: string;
    hideTypeTag?: boolean;
    dense?: boolean;
    /** 不传则按类型自动生成去处 */
    action?: TaskAction | null;
    kpId?: number | null;
    chapterId?: number | null;
  }>(),
  { done: false, checkState: "none", checkable: true, disabled: false, busy: false, hideTypeTag: false, dense: false },
);

defineEmits<{ toggle: [] }>();

const resolvedAction = computed(() =>
  props.action === undefined
    ? taskAction({ taskType: props.taskType, kpId: props.kpId, chapterId: props.chapterId })
    : props.action,
);
</script>
