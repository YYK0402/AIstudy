<template>
  <div class="modal-mask" :class="{ open: modalStore.chapterPreviewOpen }" @click.self="close">
    <div class="modal tp-modal">
      <h2>目录预览</h2>
      <div class="s t-faint" style="margin-bottom:14px">识别到以下章节结构，可编辑后确认生成目录</div>
      <div class="tp-list">
        <div v-if="chapterNodes.length === 0" class="empty-state" style="padding:16px">
          未识别到标题结构，可手动「添加章节」
        </div>
        <template v-for="ch in chapterNodes" :key="ch.id">
          <div class="tp-node">
            <span class="tp-tag chapter">章</span>
            <input v-model="ch.name" class="tp-input" aria-label="章节名称" placeholder="章节名称" />
            <button class="btn sm ghost" @click="addUnit(ch)">＋节</button>
            <button class="btn sm ghost" @click="removeChapter(ch)">删除</button>
          </div>
          <div v-for="unit in getUnits(ch)" :key="unit.id" class="tp-node unit">
            <span class="tp-tag unit">节</span>
            <input v-model="unit.name" class="tp-input" aria-label="小节名称" placeholder="小节名称" />
            <button class="btn sm ghost" @click="removeUnit(unit)">删除</button>
          </div>
        </template>
        <button class="btn sm ghost" style="align-self:flex-start" @click="addChapter">＋ 添加章节</button>
      </div>
      <div class="modal-actions">
        <button class="btn ghost" @click="close">取消</button>
        <button class="btn primary" :disabled="saving" @click="confirm">
          {{ saving ? "生成中…" : "确认生成目录" }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { useModalStore } from "../stores/modal";
import { importChapterTree, startExtractTask } from "../api";
import type { ChapterTreeNode } from "../api";

const modalStore = useModalStore();
const saving = ref(false);

interface PreviewChapter {
  id: number;
  name: string;
  units: PreviewUnit[];
}

interface PreviewUnit {
  id: number;
  name: string;
}

const chapterNodes = ref<PreviewChapter[]>([]);
let nextId = 1;

/** 按文档顺序建树：level 1 开启一章，level 2 归入最近的前一章；三级及以下子标题是资料正文内部结构，不进课程目录 */
function buildNodes(headings: Array<{ level: number; text: string }>): PreviewChapter[] {
  const chapters: PreviewChapter[] = [];
  let current: PreviewChapter | null = null;
  for (const h of headings) {
    if (h.level === 1) {
      current = { id: nextId++, name: h.text, units: [] };
      chapters.push(current);
    } else if (h.level === 2) {
      if (current) current.units.push({ id: nextId++, name: h.text });
    }
  }
  return chapters;
}

watch(
  () => modalStore.chapterPreviewOpen,
  (open) => {
    if (open) {
      nextId = 1;
      chapterNodes.value = buildNodes(modalStore.chapterPreviewHeadings);
    }
  },
  { immediate: true },
);

function getUnits(chapter: PreviewChapter): PreviewUnit[] {
  return chapter.units;
}

function removeChapter(chapter: PreviewChapter) {
  chapterNodes.value = chapterNodes.value.filter((n) => n.id !== chapter.id);
}

function removeUnit(unit: PreviewUnit) {
  for (const ch of chapterNodes.value) {
    ch.units = ch.units.filter((u) => u.id !== unit.id);
  }
}

function addChapter() {
  chapterNodes.value.push({ id: nextId++, name: "", units: [] });
}

function addUnit(chapter: PreviewChapter) {
  chapter.units.push({ id: nextId++, name: "" });
}

async function confirm() {
  const nodes: ChapterTreeNode[] = [];
  for (const ch of chapterNodes.value) {
    if (ch.name.trim()) {
      nodes.push({ name: ch.name.trim(), level: "chapter", parentName: null });
      for (const unit of ch.units) {
        if (unit.name.trim()) {
          nodes.push({ name: unit.name.trim(), level: "unit", parentName: ch.name.trim() });
        }
      }
    }
  }
  if (nodes.length === 0) {
    window.siyuanAiStudy.showMessage("请至少填写一个章节名称", 4000, "error");
    return;
  }
  saving.value = true;
  try {
    const courseId = modalStore.chapterPreviewCourseId;
    const sourceMaterialId = modalStore.chapterPreviewSourceMaterialId;
    const res = await importChapterTree(courseId, nodes);
    let msg = `已生成目录：新增 ${res.created} 个章节`;
    if (res.linked > 0) msg += `，自动挂钩 ${res.linked} 个知识点`;
    if (res.stuck > 0) msg += `；${res.stuck} 个知识点无法自动挂钩（无标题或标题与章节名差异过大），可逐个「编辑」指定章节`;
    const autoExtract = sourceMaterialId !== null && res.created > 0;
    if (autoExtract) msg += "；知识点抽取已后台启动（进度见右上铃铛）";
    window.siyuanAiStudy.showMessage(msg);
    modalStore.notifyChapterImported();
    close();
    if (autoExtract) startExtractTask(sourceMaterialId, courseId);
  } catch (e) {
    console.error("生成目录失败:", e);
    window.siyuanAiStudy.showMessage(e instanceof Error ? e.message : "生成目录失败", 4000, "error");
  } finally {
    saving.value = false;
  }
}

function close() {
  modalStore.closeChapterPreview();
}
</script>
