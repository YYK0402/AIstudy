<template>
  <Teleport to=".ai-study-app">
  <div class="modal-mask" :class="{ open: open }" @click.self="close">
    <div class="modal">
      <h2>编辑知识点</h2>
      <div class="field">
        <label>名称 <span class="req">*</span></label>
        <input v-model="form.name" aria-label="知识点名称" />
      </div>
      <div class="field">
        <label>描述</label>
        <textarea v-model="form.content" rows="5" aria-label="知识点内容" />
      </div>
      <div class="field">
        <label>掌握程度</label>
        <select v-model="form.mastery" aria-label="掌握度">
          <option value="unlearn">未学习</option>
          <option value="known">了解</option>
          <option value="mastered">掌握</option>
          <option value="proficient">精通</option>
        </select>
      </div>
      <div class="field">
        <label>归属章节</label>
        <div class="chapter-tree" ref="treeWrap">
          <button type="button" class="chapter-tree-trigger" :title="selectedLabel" @click="treeOpen = !treeOpen">
            <span v-if="selectedLabel">{{ selectedLabel }}</span>
            <span class="t-faint" v-else>（未分配）</span>
          </button>
          <div v-if="treeOpen" class="chapter-tree-panel">
            <div class="ct-row" :class="{ active: chapterId === 0 }" @click="pickChapter(0)">
              <span class="t-faint">（未分配）</span>
            </div>
            <div
              v-for="row in chapterTree"
              :key="row.id"
              class="ct-row"
              :class="{ active: chapterId === row.id, unit: row.depth >= 1 }"
              :style="{ paddingLeft: 8 + row.depth * 18 + 'px' }"
              @click="pickChapter(row.id)"
            >
              <span class="tp-tag" :class="row.depth === 0 ? 'chapter' : row.depth === 1 ? 'unit' : 'sub'">
                {{ row.depth === 0 ? "章" : row.depth === 1 ? "节" : "小节" }}
              </span>
              <span class="ct-name">{{ row.name }}</span>
            </div>
          </div>
        </div>
      </div>
      <div class="field">
        <label>标签</label>
        <input v-model="tagsText" aria-label="知识点标签" placeholder="如：计算题高频, 易混淆（逗号分隔）" />
      </div>
      <div v-if="docsEnabled()" class="field">
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
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { docsEnabled, parseTagsInput, queryChapters, updateKnowledgePoint } from "../api";
import type { Chapter, KnowledgePoint, SiyuanDocSelection } from "../api";
import SiyuanDocPicker from "./SiyuanDocPicker.vue";
import { getBridge } from "@/bridge";
import { buildChapterTreeFlat, type NestedChapter } from "../utils/outline";

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
const treeOpen = ref(false);
const treeWrap = ref<HTMLElement | null>(null);

interface ChapterTreeRow {
  id: number;
  name: string;
  /** 树层（0=顶层章）：下拉面板不折叠，仅按层缩进 */
  depth: number;
}

/** 归属章节下拉：N 级树前序展平（任意深度可选，孤儿提升顶层） */
const chapterTree = computed<ChapterTreeRow[]>(() => {
  const rows: ChapterTreeRow[] = [];
  const walk = (list: NestedChapter[], depth: number) => {
    for (const n of list) {
      rows.push({ id: n.chapter.id, name: n.chapter.name, depth });
      walk(n.children, depth + 1);
    }
  };
  walk(buildChapterTreeFlat(chapters.value), 0);
  return rows;
});

const selectedLabel = computed(() => chapters.value.find((c) => c.id === chapterId.value)?.name ?? "");

function pickChapter(id: number) {
  chapterId.value = id;
  treeOpen.value = false;
}

// 点击面板外区域关闭
function onDocClick(e: MouseEvent) {
  if (treeOpen.value && treeWrap.value && !treeWrap.value.contains(e.target as Node)) {
    treeOpen.value = false;
  }
}

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
  document.addEventListener("click", onDocClick);
});

onBeforeUnmount(() => {
  document.removeEventListener("click", onDocClick);
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
    getBridge().showMessage(e instanceof Error ? e.message : "保存知识点失败", 4000, "error");
  } finally {
    saving.value = false;
  }
}
</script>
