<template>
  <div class="modal-mask" :class="{ open: open }" @click.self="close">
    <div class="modal">
      <h2>编辑知识点</h2>
      <div class="field">
        <label>名称 <span class="req">*</span></label>
        <input v-model="form.name" />
      </div>
      <div class="field">
        <label>描述</label>
        <textarea v-model="form.content" rows="5" />
      </div>
      <div class="field">
        <label>掌握程度</label>
        <select v-model="form.mastery">
          <option value="unlearn">未学习</option>
          <option value="known">了解</option>
          <option value="mastered">掌握</option>
          <option value="proficient">精通</option>
        </select>
      </div>
      <div class="field">
        <label>归属章节</label>
        <select v-model="chapterId">
          <option value="0">（未分配）</option>
          <option v-for="c in chapters" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
      </div>
      <div class="field">
        <label>标签</label>
        <input v-model="tagsText" placeholder="如：计算题高频, 易混淆（逗号分隔）" />
      </div>
      <div class="field">
        <label>绑定思源文档（可细化到块，详情可跳转原文）</label>
        <SiyuanDocPicker v-model="binding" :show-blocks="true" :allow-unbind="true" />
      </div>
      <div class="modal-actions">
        <button class="btn ghost" @click="close">取消</button>
        <button class="btn primary" :disabled="!form.name.trim() || saving" @click="save">
          {{ saving ? "保存中…" : "保存" }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref, watch } from "vue";
import { parseTagsInput, queryChapters, updateKnowledgePoint } from "../api";
import type { Chapter, KnowledgePoint, SiyuanDocSelection } from "../api";
import SiyuanDocPicker from "./SiyuanDocPicker.vue";

const props = defineProps<{
  open: boolean;
  knowledgePoint: KnowledgePoint | null;
}>();

const emit = defineEmits<{ (e: "close"): void; (e: "saved"): void }>();

const form = reactive({ name: "", content: "", mastery: "unlearn" as KnowledgePoint["mastery"] });
const chapterId = ref(0);
const tagsText = ref("");
const binding = ref<SiyuanDocSelection | null>(null);
const chapters = ref<Chapter[]>([]);
const saving = ref(false);

function loadChapters() {
  if (!props.knowledgePoint) return;
  queryChapters(props.knowledgePoint.courseId).then((cs) => {
    chapters.value = cs;
  });
}

watch(
  () => props.knowledgePoint,
  (kp) => {
    if (kp) {
      form.name = kp.name;
      form.content = kp.content;
      form.mastery = kp.mastery;
      chapterId.value = kp.chapterId ?? 0;
      tagsText.value = (kp.tags ?? []).join("，");
      binding.value = kp.blockId
        ? { docId: kp.blockId, docName: kp.blockName ?? "", blockId: null, label: kp.blockName ?? kp.blockId }
        : null;
    } else {
      binding.value = null;
    }
  },
  { immediate: true },
);

onMounted(() => {
  loadChapters();
});

watch(
  () => props.open,
  (open) => {
    if (open) {
      loadChapters();
    }
  },
);

function close() {
  emit("close");
}

async function save() {
  if (!props.knowledgePoint || !form.name.trim()) return;
  saving.value = true;
  try {
    const tags = parseTagsInput(tagsText.value);
    await updateKnowledgePoint({
      ...props.knowledgePoint,
      name: form.name.trim(),
      content: form.content,
      mastery: form.mastery,
      chapterId: chapterId.value === 0 ? null : chapterId.value,
      tags: tags.length ? tags : undefined,
      blockId: binding.value ? (binding.value.blockId ?? binding.value.docId) : null,
      blockName: binding.value?.label,
    });
    emit("saved");
    close();
  } catch (e) {
    console.error("保存知识点失败:", e);
    window.siyuanAiStudy.showMessage(e instanceof Error ? e.message : "保存知识点失败", 4000, "error");
  } finally {
    saving.value = false;
  }
}
</script>