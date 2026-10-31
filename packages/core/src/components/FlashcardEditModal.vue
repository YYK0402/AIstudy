<template>
  <Teleport to=".ai-study-app">
  <div class="modal-mask" :class="{ open: open }" @click.self="close">
    <div class="modal">
      <h2>{{ card ? "编辑闪卡" : "手动添加闪卡" }}</h2>
      <div class="field">
        <label>知识点 <span class="req">*</span></label>
        <select v-model="kpId" aria-label="关联知识点">
          <option v-for="k in kps" :key="k.id" :value="k.id">{{ k.name }}</option>
        </select>
      </div>
      <div class="field">
        <label>正面（问题） <span class="req">*</span></label>
        <textarea v-model="front" rows="3" aria-label="闪卡正面" placeholder="如：什么是营运资本？" />
      </div>
      <div class="field">
        <label>背面（答案要点） <span class="req">*</span></label>
        <textarea v-model="back" rows="4" aria-label="闪卡背面" placeholder="1-3 句，抓要点即可" />
      </div>
      <div class="modal-actions">
        <button class="btn ghost" @click="close">取消</button>
        <button class="btn primary" :disabled="saving || !front.trim() || !back.trim() || !kpId" @click="save">
          {{ saving ? "保存中…" : "保存" }}
        </button>
      </div>
    </div>
  </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { createFlashCard, updateFlashCard } from "../api";
import type { FlashCard, KnowledgePoint } from "../api";
import { getBridge } from "@/bridge";

const props = defineProps<{
  open: boolean;
  /** 要编辑的闪卡；为 null 时按创建模式处理 */
  card: FlashCard | null;
  courseId: number;
  kps: KnowledgePoint[];
}>();

const emit = defineEmits<{ (e: "close"): void; (e: "saved"): void }>();

const kpId = ref(0);
const front = ref("");
const back = ref("");
const saving = ref(false);

const isCreate = computed(() => props.card === null);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    kpId.value = props.card?.kpId ?? props.kps[0]?.id ?? 0;
    front.value = props.card?.front ?? "";
    back.value = props.card?.back ?? "";
  },
);

function close() {
  emit("close");
}

async function save() {
  if (saving.value) return;
  saving.value = true;
  try {
    if (props.card) {
      await updateFlashCard(props.card.id, { kpId: kpId.value, front: front.value, back: back.value });
    } else {
      await createFlashCard({ courseId: props.courseId, kpId: kpId.value, front: front.value, back: back.value });
    }
    emit("saved");
    close();
  } catch (e) {
    console.error("保存闪卡失败:", e);
    getBridge().showMessage(e instanceof Error ? e.message : "保存闪卡失败", 4000, "error");
  } finally {
    saving.value = false;
  }
}
</script>
