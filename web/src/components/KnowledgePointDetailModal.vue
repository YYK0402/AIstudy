<template>
  <div class="modal-mask" :class="{ open }" @click.self="close">
    <div class="modal">
      <h2>知识点详情</h2>
      <div v-if="kp" class="kp-detail">
        <div class="kd-head">
          <span class="kd-name">{{ kp.name }}</span>
          <span class="tag" :class="kp.mastery"><span class="d"></span>{{ masteryLabel }}</span>
        </div>
        <div class="kd-section">
          <div class="kd-label">内容</div>
          <div class="kd-content">{{ kp.content || "暂无描述" }}</div>
        </div>
        <div class="kd-section">
          <div class="kd-label">归属章节</div>
          <div class="kd-text">{{ chapterName || "未分配" }}</div>
        </div>
        <div class="kd-section">
          <div class="kd-label">来源资料</div>
          <div class="kd-text">{{ sourceNames.length ? sourceNames.join("、") : "无" }}</div>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn ghost" @click="close">关闭</button>
        <button class="btn ghost danger" @click="remove">删除</button>
        <button class="btn primary" @click="edit">编辑</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { KnowledgePoint } from "../api";

const props = defineProps<{
  open: boolean;
  kp: KnowledgePoint | null;
  chapterName: string;
  sourceNames: string[];
}>();

const emit = defineEmits<{ (e: "close"): void; (e: "edit"): void; (e: "delete"): void }>();

const masteryLabel = computed(() => {
  const map: Record<KnowledgePoint["mastery"], string> = {
    unlearn: "未学习",
    known: "了解",
    mastered: "掌握",
    proficient: "精通",
  };
  return props.kp ? map[props.kp.mastery] : "";
});

function close() {
  emit("close");
}

function edit() {
  emit("edit");
}

function remove() {
  emit("delete");
}
</script>
