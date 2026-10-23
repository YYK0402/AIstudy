<template>
  <div class="sy-picker">
    <div v-if="modelValue" class="sy-picked">
      <span class="sy-picked-ico">{{ modelValue.blockId ? "🧱" : "📄" }}</span>
      <span class="sy-picked-name" :title="modelValue.label">{{ modelValue.label }}</span>
      <span style="flex:1"></span>
      <button type="button" class="btn sm ghost" @click="showPicker = true">更换</button>
      <button v-if="allowUnbind" type="button" class="btn sm ghost" @click="$emit('update:modelValue', null)">取消绑定</button>
    </div>
    <template v-else>
      <div v-if="!showPicker" class="s" style="color:var(--as-text-faint)">
        {{ placeholder }}
        <button type="button" class="btn sm ghost" style="margin-left:8px" @click="openPicker">选择文档</button>
      </div>
      <div v-else>
        <select v-model="notebookId" :disabled="loading" @change="onNotebookChange">
          <option value="">选择笔记本…</option>
          <option v-for="nb in notebooks" :key="nb.id" :value="nb.id">{{ nb.name }}</option>
        </select>
        <div v-if="error" class="s" style="color:var(--as-red);margin-top:6px">{{ error }}</div>
        <div v-else-if="notebookId" class="sy-doc-list">
          <div class="sy-crumb">
            <span class="sy-crumb-item" @click="goRoot">{{ notebookName }}</span>
            <template v-for="(seg, i) in trail" :key="seg.path">
              <span> / </span>
              <span class="sy-crumb-item" @click="goSeg(i)">{{ seg.name }}</span>
            </template>
          </div>
          <div v-if="path !== '/'" class="sy-doc-row" @click="goUp">← 返回上级</div>
          <div v-if="loading" class="sy-doc-row muted">加载中…</div>
          <div
            v-for="f in files"
            :key="f.id"
            class="sy-doc-row"
            :title="f.subFileCount > 0 ? '点击打开子目录' : '点击选择该文档'"
            @click="pick(f)"
          >
            <span class="sy-dir-ico">{{ f.subFileCount > 0 ? "📁" : "📄" }}</span>
            <span class="sy-doc-name">{{ f.name }}</span>
          </div>
        </div>
      </div>
      <!-- 文档已选中、块模式：选择绑定范围 -->
      <div v-if="pendingDoc && showBlocks" class="sy-blocks">
        <div class="s" style="color:var(--as-text-faint);margin-bottom:6px">「{{ pendingDoc.name }}」绑定范围</div>
        <div class="sy-block-row" @click="confirmDoc">📄 整篇文档</div>
        <div v-if="blocksLoading" class="sy-doc-row muted">加载块列表…</div>
        <div v-for="b in blocks" :key="b.id" class="sy-block-row" :title="b.content" @click="confirmBlock(b)">
          <span class="sy-dir-ico">{{ b.type === "h" ? "＃" : "▪" }}</span>
          <span class="sy-doc-name">{{ blockLabel(b) }}</span>
        </div>
        <div v-if="!blocksLoading && blocks.length === 0" class="sy-doc-row muted">该文档暂无可绑定块，可选「整篇文档」</div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  listSiyuanNotebooks,
  listSiyuanDocs,
  listSiyuanBlocks,
  getSiyuanDocMarkdown,
  type SiyuanDocEntry,
  type SiyuanBlockEntry,
  type SiyuanDocSelection,
} from "../api";

const props = defineProps<{
  modelValue: SiyuanDocSelection | null;
  /** true = 选中文档后还可细化到块（知识点绑定）；false = 仅文档级（资料导入） */
  showBlocks?: boolean;
  allowUnbind?: boolean;
  placeholder?: string;
}>();
const emit = defineEmits<{ "update:modelValue": [v: SiyuanDocSelection | null] }>();

const notebooks = ref<Array<{ id: string; name: string }>>([]);
const notebookId = ref("");
const notebookName = computed(() => notebooks.value.find((n) => n.id === notebookId.value)?.name ?? "");
const showPicker = ref(false);
const path = ref("/");
interface TrailEntry { path: string; name: string }
const trail = ref<TrailEntry[]>([]);
const files = ref<SiyuanDocEntry[]>([]);
const loading = ref(false);
const error = ref("");
const pendingDoc = ref<{ id: string; name: string; markdown: string } | null>(null);
const blocks = ref<SiyuanBlockEntry[]>([]);
const blocksLoading = ref(false);

function stripFrontMatter(md: string): string {
  return md.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\s*\r?\n?/, "");
}

async function loadNotebooks() {
  try {
    notebooks.value = await listSiyuanNotebooks();
  } catch (e) {
    console.error("加载笔记本列表失败:", e);
    error.value = "加载笔记本列表失败";
  }
}

onMounted(loadNotebooks);

function openPicker() {
  showPicker.value = true;
}

function onNotebookChange() {
  path.value = "/";
  trail.value = [];
  files.value = [];
  pendingDoc.value = null;
  void loadDocs();
}

async function loadDocs() {
  if (!notebookId.value) return;
  loading.value = true;
  error.value = "";
  try {
    files.value = await listSiyuanDocs(notebookId.value, path.value);
  } catch (e) {
    files.value = [];
    error.value = e instanceof Error ? e.message : "加载文档列表失败";
  } finally {
    loading.value = false;
  }
}

function goRoot() {
  path.value = "/";
  trail.value = [];
  void loadDocs();
}

function goUp() {
  trail.value.pop();
  const last = trail.value[trail.value.length - 1];
  path.value = last ? last.path : "/";
  void loadDocs();
}

function goSeg(i: number) {
  trail.value = trail.value.slice(0, i + 1);
  path.value = trail.value[i].path;
  void loadDocs();
}

async function pick(f: SiyuanDocEntry) {
  if (f.subFileCount > 0) {
    path.value = f.path;
    trail.value = [...trail.value, { path: f.path, name: f.name }];
    void loadDocs();
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    const { content } = await getSiyuanDocMarkdown(f.id);
    const md = stripFrontMatter(content);
    if (props.showBlocks) {
      pendingDoc.value = { id: f.id, name: f.name, markdown: md };
      blocks.value = [];
      blocksLoading.value = true;
      try {
        blocks.value = await listSiyuanBlocks(f.id);
      } catch (e) {
        console.error("加载块列表失败:", e);
        blocks.value = [];
      } finally {
        blocksLoading.value = false;
      }
    } else {
      emit("update:modelValue", { docId: f.id, docName: f.name, markdown: md, blockId: null, label: f.name });
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : "读取文档失败";
  } finally {
    loading.value = false;
  }
}

function blockLabel(b: SiyuanBlockEntry): string {
  const t = (b.content || "").replace(/\s+/g, " ").trim();
  if (!t) return b.type === "h" ? "（空标题）" : "（空内容）";
  return t.length > 28 ? t.slice(0, 28) + "…" : t;
}

function confirmDoc() {
  if (!pendingDoc.value) return;
  emit("update:modelValue", {
    docId: pendingDoc.value.id,
    docName: pendingDoc.value.name,
    markdown: pendingDoc.value.markdown,
    blockId: null,
    label: pendingDoc.value.name,
  });
  pendingDoc.value = null;
  blocks.value = [];
}

function confirmBlock(b: SiyuanBlockEntry) {
  if (!pendingDoc.value) return;
  emit("update:modelValue", {
    docId: pendingDoc.value.id,
    docName: pendingDoc.value.name,
    markdown: pendingDoc.value.markdown,
    blockId: b.id,
    label: `${pendingDoc.value.name} › ${blockLabel(b)}`,
  });
  pendingDoc.value = null;
  blocks.value = [];
}
</script>

<style scoped>
.sy-picked {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--as-border);
  border-radius: var(--as-radius-sm);
  background: var(--as-bg-elev);
}
.sy-picked-ico { flex-shrink: 0; }
.sy-picked-name {
  flex: 1;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sy-doc-list {
  margin-top: 8px;
  border: 1px solid var(--as-border);
  border-radius: var(--as-radius-sm);
  max-height: 180px;
  overflow-y: auto;
  background: var(--as-bg-elev);
}
.sy-crumb {
  padding: 6px 10px;
  font-size: 12px;
  color: var(--as-text-dim);
  border-bottom: 1px solid var(--as-border);
  background: var(--as-bg-elev2);
  position: sticky;
  top: 0;
}
.sy-crumb-item { cursor: pointer; }
.sy-crumb-item:hover { color: var(--as-accent-strong); }
.sy-doc-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  font-size: 13px;
  cursor: pointer;
}
.sy-doc-row:hover { background: var(--as-bg-hover); }
.sy-dir-ico { width: 16px; text-align: center; flex-shrink: 0; }
.sy-doc-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sy-doc-row.muted { color: var(--as-text-faint); cursor: default; }
.sy-blocks { margin-top: 8px; }
.sy-block-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  font-size: 12.5px;
  cursor: pointer;
  border-radius: var(--as-radius-sm);
}
.sy-block-row:hover { background: var(--as-bg-hover); }
</style>
