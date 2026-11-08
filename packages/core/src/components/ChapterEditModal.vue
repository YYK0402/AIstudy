<template>
  <Teleport to=".ai-study-app">
  <div class="modal-mask" :class="{ open: open }" @click.self="close">
    <div class="modal">
      <h2>{{ isCreate ? (parent ? "添加子级" : "添加章节（顶层）") : "编辑章节" }}</h2>
      <div class="field">
        <label>名称 <span class="req">*</span></label>
        <input v-model="name" aria-label="章节名称" @keyup.enter="save" />
      </div>
      <div class="modal-actions">
        <button class="btn ghost" @click="close">取消</button>
        <button class="btn primary" :disabled="!name.trim() || saving" @click="save">
          {{ saving ? "保存中…" : "保存" }}
        </button>
      </div>
    </div>
  </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { createChapter, updateChapter } from "../api";
import type { Chapter } from "../api";
import { getBridge } from "@/bridge";

const props = defineProps<{
  open: boolean;
  /** 要编辑的章节；为 null 时按创建模式处理 */
  chapter: Chapter | null;
  /** 创建模式下父节点（任意深度）；null = 顶层。子级 level = parent.level + 1 */
  parent: Chapter | null;
  courseId: number;
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
        parentId: props.parent ? props.parent.id : null,
        level: props.parent ? props.parent.level + 1 : 1,
      });
    }
    emit("saved");
    close();
  } catch (e) {
    console.error("保存章节失败:", e);
    getBridge().showMessage(e instanceof Error ? e.message : "保存章节失败", 4000, "error");
  } finally {
    saving.value = false;
  }
}
</script>
