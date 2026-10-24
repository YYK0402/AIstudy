<template>
  <div class="modal-mask" :class="{ open }" @click.self="$emit('close')">
    <div class="modal modal--lg mp-modal">
      <div class="mp-header">
        <h2>{{ material?.name }}</h2>
        <button class="btn sm ghost mp-close" @click="$emit('close')">✕</button>
      </div>
      <div v-if="material" class="s" style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        .{{ material.fileType }} · {{ material.contentText.length }} 字 · {{ materialSourceLabel(material) }}
        <template v-if="material.siyuanDocId">
          <span style="color:var(--as-text-faint)">（内容快照，原文可能已更新）</span>
          <button class="btn sm ghost" style="margin-left:auto" :disabled="opening" @click="openInSiyuan">
            {{ opening ? "打开中…" : "在思源打开" }}
          </button>
        </template>
      </div>
      <div v-if="headings.length > 0" class="mp-toc">
        <div class="mp-toc-title">目录结构（{{ headings.length }} 个标题）</div>
        <div
          v-for="(h, i) in headings"
          :key="i"
          class="mp-toc-item"
          :style="{ paddingLeft: `${(h.level - 1) * 14}px` }"
        >{{ h.text }}</div>
      </div>
      <div class="mp-content">
        <div v-if="material && material.contentText">{{ material.contentText }}</div>
        <div v-else style="color:var(--as-text-faint)">（无文本内容）</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { materialSourceLabel, openSiyuanDoc } from "../api";
import type { Material } from "../api";
import type { ParsedHeading } from "../utils/documentParser";

const props = defineProps<{
  open: boolean;
  material: Material | null;
}>();
defineEmits<{ close: [] }>();

const opening = ref(false);

/** 调宿主 openFileById 在主工作区打开原文（3.8.8 无 HTTP 接口且不消费 hash，已实证） */
async function openInSiyuan() {
  const id = props.material?.siyuanDocId;
  if (!id || opening.value) return;
  opening.value = true;
  try {
    await openSiyuanDoc(id);
  } catch (e) {
    console.error("打开思源文档失败:", e);
    window.siyuanAiStudy.showMessage(e instanceof Error ? e.message : "打开思源文档失败", 4000, "error");
  } finally {
    opening.value = false;
  }
}

const headings = computed<ParsedHeading[]>(() => {
  if (!props.material) return [];
  try {
    const parsed = JSON.parse(props.material.headings);
    if (Array.isArray(parsed)) {
      return parsed.filter((h): h is ParsedHeading => Boolean(h) && typeof h.text === "string");
    }
  } catch {
    // ignore
  }
  return [];
});
</script>

<style scoped>
.mp-modal {
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 20px;
}
.mp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.mp-header h2 {
  margin: 0;
  font-size: 18px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mp-close {
  flex-shrink: 0;
  margin-left: 12px;
  color: var(--as-text-faint);
}
.mp-toc {
  margin-bottom: 12px;
  padding: 10px 14px;
  background: var(--as-bg-elev2);
  border: 1px solid var(--as-border);
  border-radius: var(--as-radius-sm);
  max-height: 140px;
  overflow-y: auto;
}
.mp-toc-title {
  font-size: 11px;
  color: var(--as-text-faint);
  margin-bottom: 6px;
  letter-spacing: .06em;
}
.mp-toc-item {
  font-size: 12.5px;
  line-height: 1.9;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mp-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px 14px;
  border: 1px solid var(--as-border);
  border-radius: var(--as-radius-sm);
  font-size: 13px;
  line-height: 1.8;
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text;
  -webkit-user-select: text;
}
</style>
