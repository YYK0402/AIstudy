<template>
  <Teleport to=".ai-study-app">
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
        <div v-if="kp.tags && kp.tags.length" class="kd-section">
          <div class="kd-label">标签</div>
          <div class="kd-tags">
            <span v-for="t in kp.tags" :key="t" class="tag-plain">{{ t }}</span>
          </div>
        </div>
        <div class="kd-section">
          <div class="kd-label">来源资料</div>
          <div class="kd-text">{{ sourceNames.length ? sourceNames.join("、") : "无" }}</div>
        </div>
        <div v-if="kp.blockId" class="kd-section">
          <div class="kd-label">绑定原文</div>
          <div class="kd-text">{{ kp.blockName || "（未记录名称）" }}</div>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn ghost" @click="close">关闭</button>
        <button v-if="kp?.blockId" class="btn ghost" :disabled="opening" @click="openOriginal">
          {{ opening ? "打开中…" : "📄 查看原文" }}
        </button>
        <template v-if="!readonly">
          <button class="btn ghost danger" @click="remove">删除</button>
          <button class="btn primary" @click="edit">编辑</button>
        </template>
      </div>
    </div>
  </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { openSiyuanDoc } from "../api";
import type { KnowledgePoint } from "../api";
import { getBridge } from "@/bridge";

const props = defineProps<{
  open: boolean;
  kp: KnowledgePoint | null;
  chapterName: string;
  sourceNames: string[];
  /** 只读模式（课程归档）：隐藏编辑/删除 */
  readonly?: boolean;
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

const opening = ref(false);

async function openOriginal() {
  const id = props.kp?.blockId;
  if (!id || opening.value) return;
  opening.value = true;
  try {
    await openSiyuanDoc(id);
  } catch (e) {
    console.error("打开原文失败:", e);
    getBridge().showMessage(e instanceof Error ? e.message : "打开原文失败", 4000, "error");
  } finally {
    opening.value = false;
  }
}

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
