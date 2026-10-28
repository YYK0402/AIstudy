<template>
  <Teleport to=".ai-study-app">
  <div class="modal-mask" :class="{ open }" @click.self="close">
    <div class="modal">
      <h2>批量绑定知识点</h2>
      <div class="s" style="margin-bottom:14px">将应用到已选 {{ count }} 道题目</div>
      <div class="field">
        <label>绑定方式</label>
        <div class="mode-grid">
          <div class="mode-card" :class="{ sel: mode === 'add' }" @click="mode = 'add'">
            <div class="t">追加</div>
            <div class="d">在原有绑定上新增所选知识点（去重）</div>
          </div>
          <div class="mode-card" :class="{ sel: mode === 'replace' }" @click="mode = 'replace'">
            <div class="t">替换</div>
            <div class="d">清空原绑定，仅保留所选知识点</div>
          </div>
        </div>
      </div>
      <div class="field">
        <label>知识点（可多选）</label>
        <div v-if="knowledgePoints.length === 0" class="qe-empty">暂无知识点</div>
        <div class="kp-select">
          <button
            v-for="kp in knowledgePoints"
            :key="kp.id"
            class="kp-chip"
            :class="{ on: kpIds.includes(kp.id) }"
            :disabled="saving"
            @click="toggleKp(kp.id)"
          >{{ kp.name }}</button>
        </div>
      </div>
      <div v-if="error" class="s" style="color:var(--as-red);margin-bottom:10px">✗ {{ error }}</div>
      <div class="modal-actions">
        <button class="btn ghost" @click="close">取消</button>
        <button class="btn primary" :disabled="saving || kpIds.length === 0" @click="save">
          {{ saving ? "应用中…" : "应用" }}
        </button>
      </div>
    </div>
  </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { batchBindQuestionKps } from "../api";
import type { KnowledgePoint } from "../api";

const props = defineProps<{
  open: boolean;
  ids: number[];
  knowledgePoints: KnowledgePoint[];
}>();

const emit = defineEmits<{ (e: "close"): void; (e: "saved", count: number): void }>();

const mode = ref<"add" | "replace">("add");
const kpIds = ref<number[]>([]);
const saving = ref(false);
const error = ref("");

const count = props.ids.length;

watch(
  () => props.open,
  (v) => {
    if (v) {
      mode.value = "add";
      kpIds.value = [];
      error.value = "";
    }
  },
);

function toggleKp(id: number) {
  kpIds.value = kpIds.value.includes(id) ? kpIds.value.filter((x) => x !== id) : [...kpIds.value, id];
}

async function save() {
  if (kpIds.value.length === 0) return;
  saving.value = true;
  error.value = "";
  try {
    const applied = await batchBindQuestionKps(props.ids, kpIds.value, mode.value);
    emit("saved", applied);
    close();
  } catch (e) {
    console.error("批量绑定知识点失败:", e);
    error.value = e instanceof Error ? e.message : "批量绑定知识点失败";
  } finally {
    saving.value = false;
  }
}

function close() {
  emit("close");
}
</script>
