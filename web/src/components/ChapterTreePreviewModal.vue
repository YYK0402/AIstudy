<template>
  <div class="modal-mask" :class="{ open: modalStore.chapterPreviewOpen }" @click.self="close">
    <div class="modal tp-modal">
      <h2>目录预览</h2>
      <div class="s" style="color:var(--as-text-faint);margin-bottom:14px">识别到以下章节结构，可编辑后确认生成目录</div>
      <div class="tp-list">
        <div v-if="chapterNodes.length === 0" class="empty-state" style="padding:16px">
          未识别到标题结构，可手动「添加章节」
        </div>
        <div v-for="node in chapterNodes" :key="node.id" class="tp-node" :class="{ unit: node.level === 'unit' }">
          <span class="tp-tag" :class="node.level">{{ node.level === "chapter" ? "章" : "节" }}</span>
          <input v-model="node.name" class="tp-input" :placeholder="node.level === 'chapter' ? '章节名称' : '小节名称'" />
          <button v-if="node.level === 'chapter'" class="btn sm ghost" @click="addUnit(node)">＋节</button>
          <button class="btn sm ghost" @click="removeNode(node)">删除</button>
        </div>
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
import { ref, watch } from "vue";
import { useModalStore } from "../stores/modal";
import { importChapterTree, startExtractTask } from "../api";
import type { ChapterTreeNode } from "../api";

const modalStore = useModalStore();
const saving = ref(false);

interface PreviewNode {
  id: number;
  name: string;
  level: "chapter" | "unit";
  parentId: number | null;
}

const chapterNodes = ref<PreviewNode[]>([]);

function buildNodes(headings: Array<{ level: number; text: string }>): PreviewNode[] {
  const nodes: PreviewNode[] = [];
  let currentChapterId: number | null = null;
  let id = 1;
  for (const h of headings) {
    if (h.level === 1) {
      currentChapterId = id;
      nodes.push({ id: id++, name: h.text, level: "chapter", parentId: null });
    } else if (h.level === 2) {
      if (currentChapterId !== null) {
        nodes.push({ id: id++, name: h.text, level: "unit", parentId: currentChapterId });
      } else {
        currentChapterId = id;
        nodes.push({ id: id++, name: h.text, level: "chapter", parentId: null });
      }
    }
  }
  return nodes;
}

watch(
  () => modalStore.chapterPreviewOpen,
  (open) => {
    if (open) {
      chapterNodes.value = buildNodes(modalStore.chapterPreviewHeadings);
    }
  },
  { immediate: true },
);

function removeNode(node: PreviewNode) {
  const ids = new Set<number>([node.id]);
  // 级联删除子节点
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of chapterNodes.value) {
      if (n.parentId !== null && ids.has(n.parentId) && !ids.has(n.id)) {
        ids.add(n.id);
        grew = true;
      }
    }
  }
  chapterNodes.value = chapterNodes.value.filter((n) => !ids.has(n.id));
}

function addChapter() {
  const id = Math.max(0, ...chapterNodes.value.map((n) => n.id)) + 1;
  chapterNodes.value.push({ id, name: "", level: "chapter", parentId: null });
}

function addUnit(chapter: PreviewNode) {
  const id = Math.max(0, ...chapterNodes.value.map((n) => n.id)) + 1;
  chapterNodes.value.push({ id, name: "", level: "unit", parentId: chapter.id });
}

async function confirm() {
  const nodes: ChapterTreeNode[] = chapterNodes.value
    .filter((n) => n.name.trim())
    .map((n) => ({
      name: n.name.trim(),
      level: n.level,
      parentName:
        n.parentId !== null
          ? chapterNodes.value.find((x) => x.id === n.parentId)?.name.trim() ?? null
          : null,
    }));
  if (nodes.length === 0) {
    window.siyuanAiStudy.showMessage("请至少填写一个章节名称", 4000, "error");
    return;
  }
  saving.value = true;
  try {
    // 先取目录上下文：close() 会清空 store
    const courseId = modalStore.chapterPreviewCourseId;
    const sourceMaterialId = modalStore.chapterPreviewSourceMaterialId;
    const res = await importChapterTree(courseId, nodes);
    let msg = `已生成目录：新增 ${res.created} 个章节`;
    if (res.linked > 0) msg += `，自动挂钩 ${res.linked} 个知识点`;
    if (res.stuck > 0) msg += `；${res.stuck} 个知识点无法自动挂钩（无标题或标题与章节名差异过大），可逐个「编辑」指定章节`;
    // 第四步链路：目录确认且确有新增章节时，自动对来源资料启动知识点抽取（重复确认同一目录不重复抽）
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
