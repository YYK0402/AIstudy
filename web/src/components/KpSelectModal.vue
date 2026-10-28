<template>
  <Teleport to=".ai-study-app">
  <div class="modal-mask" :class="{ open }" @click.self="close">
    <div class="modal modal--lg kp-select-modal">
      <h2>选择知识点</h2>
      <KpTreePicker :chapters="chapters" :kps="kps" v-model="ids" />
      <div class="modal-actions">
        <button class="btn ghost" @click="ids = []">清空</button>
        <button class="btn ghost" @click="close">取消</button>
        <button class="btn primary" :disabled="ids.length === 0" @click="confirm">确定选择（{{ ids.length }}）</button>
      </div>
    </div>
  </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import type { Chapter, KnowledgePoint } from "../api";
import KpTreePicker from "./KpTreePicker.vue";

const props = defineProps<{
  open: boolean;
  chapters: Chapter[];
  kps: KnowledgePoint[];
  /** 打开时预勾选项（可选） */
  initialSelected?: number[];
}>();

const emit = defineEmits<{ (e: "close"): void; (e: "confirm", ids: number[]): void }>();

const ids = ref<number[]>([]);

watch(
  () => props.open,
  (v) => {
    if (!v) return;
    ids.value = [...(props.initialSelected ?? [])];
  },
);

function confirm() {
  emit("confirm", ids.value);
}

function close() {
  emit("close");
}
</script>
