<template>
  <div class="modal-mask" :class="{ open: open }" @click.self="close">
    <div class="modal">
      <h2>{{ isCreate ? "添加章节（顶层）" : "添加小节" }}</h2>
      <div class="field">
        <label>名称 <span class="req">*</span></label>
        <input v-model="name" @keyup.enter="save" />
      </div>
      <div class="modal-actions">
        <button class="btn ghost" @click="close">取消</button>
        <button class="btn primary" :disabled="!name.trim() || saving" @click="save">
          {{ saving ? "保存中…" : "保存" }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { createChapter, updateChapter } from "../api";
import type { Chapter } from "../api";

const props = defineProps<{
  open: boolean;
  /** 要编辑的章节；为 null 时按创建模式处理 */
  chapter: Chapter | null;
  /** 创建模式下新增子章节的父章 id；null 表示顶层 */
  courseId: number;
  parentId: number | null;
}>();

const emit = defineEmits<{ (e: "close"): void; (e: "saved"): void }>();

const name = ref("");
const saving = ref(false);

const isCreate = computed(() => props.chapter === null);

watch(
  () => props.open,
  (open) => {
    if (open) {
      name.value = props.chapter?.name ?? "";
    }
  },
);

function close() {
  emit("close");
}

async function save() {
  const trimmed = name.value.trim();
  if (!trimmed || saving.value) return;
  saving.value = true;
  try {
    if (props.chapter) {
      await updateChapter({ ...props.chapter, name: trimmed });
    } else {
      await createChapter({
        courseId: props.courseId,
        name: trimmed,
        parentId: props.parentId,
        level: props.parentId === null ? "chapter" : "unit",
      });
    }
    emit("saved");
    close();
  } catch (e) {
    console.error("保存章节失败:", e);
  } finally {
    saving.value = false;
  }
}
</script>
