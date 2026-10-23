<template>
  <div class="page">
    <div class="page-title"><h1>课程内容</h1><div class="desc">章节 · 单元 · 知识点 · 关联资料</div></div>

    <div v-if="archived" class="archived-banner" style="margin-bottom:14px">
      <span>🗄️ 课程已归档 · 内容只读，如需修改请先在「课程主页」取消归档</span>
    </div>

    <div class="two-col">
      <!-- 目录结构 -->
      <div class="card">
        <h3>目录结构
          <template v-if="!archived">
            <button class="btn sm ghost" :disabled="!currentCourseId() || reidentifying" @click="reidentifyChapters">
              {{ reidentifying ? "识别中…" : "🔄 重新识别目录" }}
            </button>
            <button v-if="!batchMode" class="btn sm ghost" :disabled="!currentCourseId() || chapters.length === 0" @click="enterBatchMode">☑ 批量删除</button>
            <button v-else class="btn sm ghost" @click="exitBatchMode">取消</button>
          </template>
          <button v-if="!archived" class="btn primary sm" :disabled="!currentCourseId()" @click="addTopChapter" style="margin-left:auto">＋ 添加章节</button>
        </h3>
        <div v-if="!currentCourseId()" class="empty-state" style="padding:24px 0">
          <span class="ico">📭</span> 请先选择课程
        </div>
        <div v-else-if="chapters.length === 0" class="empty-state" style="padding:24px 0">
          <span class="ico">🗂️</span> 暂无章节，点击「添加章节」搭建目录
        </div>
        <div v-else class="tree">
          <div v-for="ch in chapterTree" :key="ch.id" class="tree-node" :class="{ open: !collapsedChapters.has(ch.id) }">
            <div
              class="row"
              :class="[{ active: selectedChapterId === ch.id }, rowDropClass(ch.id)]"
              @click="batchMode ? toggleSelect(ch.id) : selectChapter(ch.id)"
              @dragover.prevent="onRowDragOver($event, 'chapter', ch.id)"
              @dragleave="onRowDragLeave(ch.id)"
              @drop="onRowDrop($event, 'chapter', ch.id)"
            >
              <input v-if="batchMode" type="checkbox" class="tp-check" :checked="selectedChapterIds.has(ch.id)" @click.stop @change="toggleSelect(ch.id)" />
              <span class="tgl" @click.stop="toggleChapter(ch.id)">▶</span>
              <span class="name">{{ ch.name }}</span>
              <span class="count">{{ kpCountOf(ch.id) }}</span>
              <template v-if="!archived && !batchMode">
                <span class="drag-handle" title="拖拽换序 / 移入小节" draggable="true" @click.stop @dragstart="onDragStart('chapter', ch.id)" @dragend="onDragEnd">⋮⋮</span>
                <button class="btn sm ghost" @click.stop="addUnit(ch)">＋小节</button>
                <button class="btn sm ghost" @click.stop="openReview(ch)">复盘</button>
                <button class="btn sm ghost" @click.stop="editChapter(ch)">编辑</button>
                <button class="btn sm ghost" @click.stop="delChapter(ch)">删除</button>
              </template>
            </div>
            <div class="tree-children">
              <div v-for="u in ch.units" :key="u.id" class="tree-node">
                <div
                  class="row"
                  :class="[{ active: selectedChapterId === u.id }, rowDropClass(u.id)]"
                  @click="batchMode ? toggleSelect(u.id) : selectChapter(u.id)"
                  @dragover.prevent="onRowDragOver($event, 'unit', u.id)"
                  @dragleave="onRowDragLeave(u.id)"
                  @drop="onRowDrop($event, 'unit', u.id)"
                >
                  <input v-if="batchMode" type="checkbox" class="tp-check" :checked="selectedChapterIds.has(u.id)" @click.stop @change="toggleSelect(u.id)" />
                  <span class="tgl" style="opacity:0">▶</span>
                  <span class="name">{{ u.name }}</span>
                  <span class="count">{{ kpCountOf(u.id) }}</span>
                  <template v-if="!archived && !batchMode">
                    <span class="drag-handle" title="拖拽换序 / 跨章移动" draggable="true" @click.stop @dragstart="onDragStart('unit', u.id)" @dragend="onDragEnd">⋮⋮</span>
                    <button class="btn sm ghost" @click.stop="editChapter(u)">编辑</button>
                    <button class="btn sm ghost" @click.stop="delChapter(u)">删除</button>
                  </template>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div v-if="batchMode && chapters.length > 0" class="batch-bar">
          <button class="btn sm ghost" @click="selectAll">全选</button>
          <span class="s" style="color:var(--as-text-faint)">已选 {{ selectedChapterIds.size }} 项</span>
          <button class="btn sm danger" :disabled="selectedChapterIds.size === 0" @click="batchDelete">删除选中</button>
        </div>
      </div>

      <!-- 知识点 -->
      <div class="card">
        <h3>知识点<span v-if="selectedChapterName"> · {{ selectedChapterName }}</span>
          <span v-if="unassignedCount > 0" class="up-chip" :class="{ active: showUnassigned }" @click="toggleUnassigned">未分配 {{ unassignedCount }}</span>
          <template v-if="!archived">
            <button v-if="unassignedCount > 0 && chapters.length > 0" class="btn sm ghost" :disabled="relinking" @click="autoRelink">
              {{ relinking ? "归位中…" : "⚡ 自动归位" }}
            </button>
            <button v-if="!kpBatchMode" class="btn sm ghost" :disabled="filteredKnowledgePoints.length === 0" @click="enterKpBatchMode">☑ 批量删除</button>
            <button v-else class="btn sm ghost" @click="exitKpBatchMode">取消</button>
          </template>
          <span style="margin-left:auto;font-size:11px;color:var(--as-text-faint)">共 {{ filteredKnowledgePoints.length }} 个</span>
        </h3>
        <input
          v-model="searchKeyword"
          class="search-input"
          type="text"
          placeholder="搜索知识点名称 / 内容…"
        />
        <div v-if="!currentCourseId()" class="empty-state" style="padding:24px 0">
          <span class="ico">📭</span> 请先选择课程
        </div>
        <div v-else-if="filteredKnowledgePoints.length === 0" class="empty-state" style="padding:24px 0">
          <span class="ico">🌱</span> {{ searchKeyword ? "未找到匹配的知识点" : "暂无知识点，上传资料后点击「抽取知识点」生成" }}
        </div>
        <div v-else class="kp-list">
          <div
            v-for="(kp, i) in pagedKnowledgePoints"
            :key="kp.id"
            class="kp-item clickable"
            :class="rowDropClass(kp.id)"
            @click="kpBatchMode ? toggleKpSelect(kp.id) : viewKp(kp)"
            @dragover.prevent="kpDragEnabled ? onRowDragOver($event, 'kp', kp.id) : undefined"
            @dragleave="onRowDragLeave(kp.id)"
            @drop="onRowDrop($event, 'kp', kp.id)"
          >
            <input v-if="kpBatchMode" type="checkbox" class="tp-check" :checked="selectedKpIds.has(kp.id)" @click.stop @change="toggleKpSelect(kp.id)" />
            <span class="idx">{{ String((currentPage - 1) * PAGE_SIZE + i + 1).padStart(2, "0") }}</span>
            <span class="nm">{{ kp.name }}</span>
            <span v-if="kp.tags && kp.tags.length" class="kp-tags">
              <span v-for="t in (kp.tags ?? []).slice(0, 2)" :key="t" class="tag-chip">{{ t }}</span>
              <span v-if="kp.tags.length > 2" class="tag-chip">+{{ kp.tags.length - 2 }}</span>
            </span>
            <span class="meta">{{ kpSources[kp.id]?.length || 0 }} 份资料</span>
            <span class="tag" :class="kp.mastery"><span class="d"></span>{{ masteryLabel(kp.mastery) }}</span>
            <span
              v-if="kpDragEnabled"
              class="drag-handle"
              title="拖拽换序，或拖到左侧章节改绑"
              draggable="true"
              @click.stop
              @dragstart="onDragStart('kp', kp.id)"
              @dragend="onDragEnd"
            >⋮⋮</span>
          </div>
        </div>
        <div v-if="totalPages > 1" class="pagination">
          <button class="btn sm ghost" :disabled="currentPage === 1" @click="currentPage--">‹ 上一页</button>
          <span class="pg-info">{{ currentPage }} / {{ totalPages }}</span>
          <button class="btn sm ghost" :disabled="currentPage === totalPages" @click="currentPage++">下一页 ›</button>
        </div>
        <div v-if="kpBatchMode && filteredKnowledgePoints.length > 0" class="batch-bar">
          <button class="btn sm ghost" @click="selectAllKps">全选</button>
          <button class="btn sm ghost" @click="selectPageKps">选本页</button>
          <span class="s" style="color:var(--as-text-faint)">已选 {{ selectedKpIds.size }} 项</span>
          <button class="btn sm danger" :disabled="selectedKpIds.size === 0 || deletingKps" @click="batchDeleteKps">删除选中</button>
        </div>
      </div>
    </div>

    <!-- 资料库 -->
    <div class="card" style="margin-top:14px">
      <h3>资料库
        <div style="margin-left:auto;display:flex;gap:6px">
          <button v-if="!archived && materials.length > 0" class="btn sm ghost" :disabled="fullExtracting" @click="fullReExtract">
            {{ fullExtractLabel }}
          </button>
          <button v-if="!archived" class="btn primary sm" :disabled="!currentCourseId() || fullExtracting" @click="openUpload">＋ 上传资料</button>
        </div>
      </h3>
      <div v-if="fullExtracting" class="s" style="color:var(--as-accent-strong);padding:8px 0 4px">{{ fullExtractLabel }}</div>
      <div v-if="materials.length === 0" class="empty-state" style="padding:24px 0">
        <span class="ico">📚</span> 暂无资料，点击右上「＋ 上传资料」导入讲义 / Word / PDF / PPT
      </div>
      <div v-else class="material-list">
        <div v-for="m in materials" :key="m.id" class="material-item">
          <div>
            <div class="m-name">
              {{ m.name }}
              <span class="src-tag">{{ materialSourceLabel(m) }}</span>
            </div>
            <div class="m-meta">.{{ m.fileType }} · {{ m.contentText.length }} 字 · {{ formatTime(m.createTime) }}</div>
            <div v-if="extractState[m.id]?.status === 'loading'" class="s" style="color:var(--as-accent-strong);margin-top:4px">
              {{ extractLoadingLabel(m.id) }}
            </div>
            <div v-else-if="extractState[m.id]?.status === 'done'" class="s" style="margin-top:4px">
              <span style="color:var(--as-green)">
                ✓ 抽取完成：新增 {{ extractState[m.id]!.newCount }} · 更新 {{ extractState[m.id]!.updateCount }} · 跳过 {{ extractState[m.id]!.duplicateCount }}
              </span>
              <span
                v-if="extractState[m.id]!.errors?.length"
                class="s"
                style="color:var(--as-red);margin-left:8px;cursor:pointer"
                @click="extractState[m.id]!.showErrors = !extractState[m.id]!.showErrors"
              >· {{ extractState[m.id]!.errors!.length }} 块失败（{{ extractState[m.id]!.showErrors ? "收起" : "查看详情" }}）</span>
              <div v-if="extractState[m.id]!.showErrors && extractState[m.id]!.errors?.length" class="s" style="color:var(--as-red);margin-top:4px;white-space:pre-line">
                {{ extractState[m.id]!.errors!.join("\n") }}
              </div>
            </div>
            <div v-else-if="extractState[m.id]?.status === 'error'" class="s" style="color:var(--as-red);margin-top:4px">
              ✗ {{ extractState[m.id]!.error }}
            </div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0">
            <button class="btn sm ghost" @click="previewMaterial = m">预览</button>
            <template v-if="!archived">
              <button class="btn sm ghost" :disabled="extractState[m.id]?.status === 'loading'" @click="extract(m)">
                {{ extractState[m.id]?.status === "loading" ? "抽取中…" : "抽取知识点" }}
              </button>
              <button class="btn sm ghost" @click="del(m)">删除</button>
            </template>
          </div>
        </div>
      </div>
    </div>

    <KnowledgePointDetailModal
      :open="detailKp !== null"
      :kp="detailKp"
      :chapter-name="detailChapterName"
      :source-names="detailSourceNames"
      :readonly="archived"
      @close="detailKp = null"
      @edit="editDetailKp"
      @delete="removeDetailKp"
    />
    <KnowledgePointEditModal :open="editingKp !== null" :knowledge-point="editingKp" @close="editingKp = null" @saved="loadKnowledgePoints" />
    <MaterialPreviewModal :open="previewMaterial !== null" :material="previewMaterial" @close="previewMaterial = null" />
    <ChapterEditModal
      :open="chapterModal !== null"
      :course-id="currentCourseId() ?? 0"
      :chapter="chapterModal === 'edit' ? editingChapter : null"
      :parent-id="chapterModal === 'unit' ? editingChapter?.id ?? null : null"
      @close="chapterModal = null"
      @saved="loadChapters"
    />
    <ChapterReviewModal
      :open="reviewChapter !== null"
      :chapter="reviewChapter"
      :kps="reviewChapterKps"
      :course-name="courseStore.currentCourse?.name ?? ''"
      @close="reviewChapter = null"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useCourseStore } from "../stores/course";
import { useModalStore } from "../stores/modal";
import {
  queryMaterials,
  deleteMaterial,
  reparseMaterial,
  extractKnowledgePoints,
  isExtractingMaterial,
  isFullExtracting,
  beginFullExtract,
  endFullExtract,
  queryKnowledgePoints,
  deleteKnowledgePoint,
  queryChapters,
  deleteChapter,
  deleteChapters,
  relinkUnassignedKps,
  deleteKnowledgePoints,
  correctTocWithAi,
  materialSourceLabel,
  applyChapterMoves,
  applyKnowledgePointSort,
  updateKnowledgePoint,
} from "../api";
import type { Material, KnowledgePoint, Mastery, Chapter } from "../api";
import type { ParsedHeading } from "../utils/documentParser";
import { computeChapterMove, type DropPos } from "../utils/chapterMove";
import { expandChapterNodeIds } from "../utils/chapterScope";
import KnowledgePointDetailModal from "../components/KnowledgePointDetailModal.vue";
import KnowledgePointEditModal from "../components/KnowledgePointEditModal.vue";
import ChapterEditModal from "../components/ChapterEditModal.vue";
import ChapterReviewModal from "../components/ChapterReviewModal.vue";
import MaterialPreviewModal from "../components/MaterialPreviewModal.vue";

const courseStore = useCourseStore();
const modalStore = useModalStore();
/** 课程归档后内容只读：隐藏全部写入口 */
const archived = computed(() => courseStore.currentCourse?.status === "archived");
const materials = ref<Material[]>([]);
const previewMaterial = ref<Material | null>(null);
const knowledgePoints = ref<KnowledgePoint[]>([]);
const editingKp = ref<KnowledgePoint | null>(null);
const detailKp = ref<KnowledgePoint | null>(null);
const chapters = ref<Chapter[]>([]);
const chapterModal = ref<"edit" | "top" | "unit" | null>(null);
const editingChapter = ref<Chapter | null>(null);
const collapsedChapters = ref<Set<number>>(new Set());
// 已应用「默认全收起」的课程 id（组件级：重进页面后重新默认全收起）
let collapseDefaultedFor: number | null = null;
const selectedChapterId = ref<number | null>(null);
const showUnassigned = ref(false);
const relinking = ref(false);
const kpBatchMode = ref(false);
const selectedKpIds = ref<Set<number>>(new Set());
const deletingKps = ref(false);
const reidentifying = ref(false);
const searchKeyword = ref("");
const currentPage = ref(1);
const PAGE_SIZE = 10;
const batchMode = ref(false);
const selectedChapterIds = ref<Set<number>>(new Set());

interface ChapterNode extends Chapter {
  units: Chapter[];
}

const chapterTree = computed<ChapterNode[]>(() => {
  const sorted = [...chapters.value].sort((a, b) => a.sort - b.sort);
  const chaptersOnly = sorted.filter((c) => c.level === "chapter");
  return chaptersOnly.map((ch) => ({
    ...ch,
    units: sorted.filter((c) => c.level === "unit" && c.parentId === ch.id),
  }));
});

const kpSources = computed<Record<number, string[]>>(() => {
  const map: Record<number, string[]> = {};
  for (const kp of knowledgePoints.value) {
    const ids = kp.sourceAssetIds.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
    map[kp.id] = ids
      .map((id) => materials.value.find((m) => m.id === id)?.name)
      .filter((n): n is string => Boolean(n));
  }
  return map;
});

// 选中章节下的知识点 id 集合（章包含其下小节）
function chapterKpIds(chapterId: number): Set<number> {
  return expandChapterNodeIds(chapters.value, chapterId);
}

// 章节复盘弹层
const reviewChapter = ref<Chapter | null>(null);
const reviewChapterKps = computed(() =>
  reviewChapter.value
    ? knowledgePoints.value.filter((k) => k.chapterId !== null && chapterKpIds(reviewChapter.value!.id).has(k.chapterId))
    : [],
);
function openReview(ch: Chapter) {
  reviewChapter.value = ch;
}

const unassignedCount = computed(() => knowledgePoints.value.filter((k) => k.chapterId === null).length);

const filteredKnowledgePoints = computed(() => {
  let list = knowledgePoints.value;
  if (showUnassigned.value) {
    list = list.filter((k) => k.chapterId === null);
  } else if (selectedChapterId.value !== null) {
    const ids = chapterKpIds(selectedChapterId.value);
    list = list.filter((k) => k.chapterId !== null && ids.has(k.chapterId));
  }
  const kw = searchKeyword.value.trim().toLowerCase();
  if (kw) {
    list = list.filter(
      (k) => k.name.toLowerCase().includes(kw) || k.content.toLowerCase().includes(kw),
    );
  }
  // 按 sort 展示（拖拽换序持久化的顺序）
  return [...list].sort((a, b) => a.sort - b.sort || a.id - b.id);
});

// ===== 拖拽：章节树换序/跨章移动 + 知识点换序/改绑 =====
interface DragPayload {
  kind: "chapter" | "unit" | "kp";
  id: number;
}
const dragPayload = ref<DragPayload | null>(null);
const dropHint = ref<{ id: number; pos: DropPos } | null>(null);

/** 知识点拖拽仅在无搜索词时可用（避免过滤子集内换序误导全局顺序） */
const kpDragEnabled = computed(() => !archived.value && !kpBatchMode.value && searchKeyword.value.trim() === "");

function onDragStart(kind: DragPayload["kind"], id: number) {
  dragPayload.value = { kind, id };
}

function onDragEnd() {
  dragPayload.value = null;
  dropHint.value = null;
}

/** 章节行三区间（上/下沿=前后插，中部=移入），小节/KP 行两区间 */
function posFromEvent(e: DragEvent, isChapterRow: boolean): DropPos {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const ratio = (e.clientY - rect.top) / rect.height;
  if (isChapterRow) {
    if (ratio < 0.3) return "before";
    if (ratio > 0.7) return "after";
    return "inside";
  }
  return ratio < 0.5 ? "before" : "after";
}

function dropValid(p: DragPayload, kind: "chapter" | "unit" | "kp", pos: DropPos): boolean {
  if (kind === "kp") return p.kind === "kp";
  if (p.kind === "kp") return true; // KP 落到章节/小节行 = 改绑（任意位置）
  if (kind === "unit") return p.kind === "unit";
  return pos === "inside" ? p.kind === "unit" : p.kind === "chapter";
}

function rowDropClass(id: number): string {
  if (!dropHint.value || dropHint.value.id !== id) return "";
  return "drop-" + dropHint.value.pos;
}

function onRowDragOver(e: DragEvent, kind: "chapter" | "unit" | "kp", id: number) {
  const dt = e.dataTransfer;
  const p = dragPayload.value;
  if (!dt || !p || p.id === id) {
    if (dt) dt.dropEffect = "none";
    return;
  }
  // KP 落章节/小节行统一按「移入」高亮（改绑语义，非插入位置）
  const pos = p.kind === "kp" && kind !== "kp" ? "inside" : posFromEvent(e, kind === "chapter");
  if (!dropValid(p, kind, pos)) {
    dropHint.value = null;
    dt.dropEffect = "none";
    return;
  }
  dropHint.value = { id, pos };
  dt.dropEffect = "move";
}

function onRowDragLeave(id: number) {
  if (dropHint.value?.id === id) {
    dropHint.value = null;
  }
}

async function onRowDrop(e: DragEvent, kind: "chapter" | "unit" | "kp", id: number) {
  e.preventDefault();
  const p = dragPayload.value;
  const hint = dropHint.value;
  dragPayload.value = null;
  dropHint.value = null;
  if (!p || !hint || hint.id !== id || p.id === id) return;
  try {
    if (p.kind === "kp" && kind === "kp") {
      await reorderKp(p.id, id, hint.pos === "before" ? "before" : "after");
    } else if (p.kind === "kp") {
      const kp = knowledgePoints.value.find((k) => k.id === p.id);
      if (!kp || kp.chapterId === id) return;
      await updateKnowledgePoint({ ...kp, chapterId: id });
      await loadKnowledgePoints();
      const node = chapters.value.find((c) => c.id === id);
      window.siyuanAiStudy.showMessage(`已归入「${node?.name ?? "章节"}」`);
    } else {
      await applyChapterDrop(p.id, id, hint.pos);
    }
  } catch (err) {
    console.error("拖拽操作失败:", err);
    window.siyuanAiStudy.showMessage(err instanceof Error ? err.message : "拖拽操作失败", 4000, "error");
  }
}

async function applyChapterDrop(dragId: number, targetId: number, pos: DropPos) {
  const moved = computeChapterMove(chapters.value, dragId, targetId, pos);
  if (!moved) return;
  const oldMap = new Map(chapters.value.map((c) => [c.id, c]));
  const moves = moved
    .filter((c) => {
      const o = oldMap.get(c.id);
      return o !== undefined && (o.sort !== c.sort || o.parentId !== c.parentId);
    })
    .map((c) => ({ id: c.id, parentId: c.parentId, sort: c.sort }));
  if (moves.length === 0) return;
  await applyChapterMoves(moves);
  await loadChapters();
}

/** 在当前筛选范围内换序（scope 内 sort 重排 1..N） */
async function reorderKp(dragId: number, targetId: number, pos: "before" | "after") {
  const list = filteredKnowledgePoints.value;
  const from = list.findIndex((k) => k.id === dragId);
  const to = list.findIndex((k) => k.id === targetId);
  if (from < 0 || to < 0) return;
  const order = [...list];
  const [d] = order.splice(from, 1);
  const insertAt = order.findIndex((k) => k.id === targetId) + (pos === "after" ? 1 : 0);
  order.splice(insertAt, 0, d);
  await applyKnowledgePointSort(order.map((k, i) => ({ id: k.id, sort: i + 1 })));
  await loadKnowledgePoints();
}

const totalPages = computed(() => Math.max(1, Math.ceil(filteredKnowledgePoints.value.length / PAGE_SIZE)));
const pagedKnowledgePoints = computed(() => {
  const start = (currentPage.value - 1) * PAGE_SIZE;
  return filteredKnowledgePoints.value.slice(start, start + PAGE_SIZE);
});

const selectedChapterName = computed(() => {
  if (selectedChapterId.value === null) return "";
  return chapters.value.find((c) => c.id === selectedChapterId.value)?.name ?? "";
});

const detailChapterName = computed(() => {
  if (!detailKp.value || detailKp.value.chapterId === null) return "";
  return chapters.value.find((c) => c.id === detailKp.value!.chapterId)?.name ?? "";
});

const detailSourceNames = computed(() => {
  if (!detailKp.value) return [];
  return kpSources.value[detailKp.value.id] ?? [];
});

interface ExtractState {
  status: "loading" | "done" | "error";
  newCount?: number;
  updateCount?: number;
  duplicateCount?: number;
  error?: string;
  progress?: { current: number; total: number; blockTitle: string };
  errors?: string[];
  showErrors?: boolean;
}
const extractState = reactive<Record<number, ExtractState>>({});

const currentCourseId = () => courseStore.currentCourseId;

const masteryLabel = (m: Mastery): string => {
  const map: Record<Mastery, string> = { unlearn: "未学习", known: "了解", mastered: "掌握", proficient: "精通" };
  return map[m];
};

function toggleChapter(id: number) {
  const s = new Set(collapsedChapters.value);
  if (s.has(id)) {
    s.delete(id);
  } else {
    s.add(id);
  }
  collapsedChapters.value = s;
}

function selectChapter(id: number) {
  selectedChapterId.value = selectedChapterId.value === id ? null : id;
  showUnassigned.value = false;
  currentPage.value = 1;
}

function toggleUnassigned() {
  showUnassigned.value = !showUnassigned.value;
  if (showUnassigned.value) {
    selectedChapterId.value = null;
  }
  currentPage.value = 1;
}

// 把未分配知识点按章节标题重新匹配归位（章节后建/改名后）
async function autoRelink() {
  const id = currentCourseId();
  if (!id) return;
  relinking.value = true;
  try {
    const res = await relinkUnassignedKps(id);
    window.siyuanAiStudy.showMessage(
      res.linked > 0
        ? res.stuck > 0
          ? `已自动归位 ${res.linked} 个知识点；${res.stuck} 个无法自动挂钩（无标题或与章节名差异过大），可逐个「编辑」指定章节`
          : `已自动归位 ${res.linked} 个知识点`
        : `${res.stuck} 个知识点无法自动挂钩，需逐个「编辑」手动指定章节`,
      4000,
      res.stuck > 0 ? "error" : "info",
    );
    await loadKnowledgePoints();
  } catch (e) {
    console.error("自动归位失败:", e);
    window.siyuanAiStudy.showMessage(e instanceof Error ? e.message : "自动归位失败", 4000, "error");
  } finally {
    relinking.value = false;
  }
}

// 统计某章/节下关联的知识点数量（章包含其下小节）
function kpCountOf(chapterId: number): number {
  const ids = chapterKpIds(chapterId);
  return knowledgePoints.value.filter((k) => k.chapterId !== null && ids.has(k.chapterId)).length;
}

async function loadMaterials() {
  if (!currentCourseId()) {
    materials.value = [];
    return;
  }
  materials.value = await queryMaterials(currentCourseId());
}

async function loadKnowledgePoints() {
  if (!currentCourseId()) {
    knowledgePoints.value = [];
    return;
  }
  knowledgePoints.value = await queryKnowledgePoints(currentCourseId());
}

async function loadChapters() {
  if (!currentCourseId()) {
    chapters.value = [];
    return;
  }
  chapters.value = await queryChapters(currentCourseId());
  const cid = currentCourseId();
  const existing = new Set(chapters.value.map((c) => c.id));
  if (collapseDefaultedFor !== cid) {
    // 首次进入 / 切换课程 / 重进页面：目录默认全部收起
    collapsedChapters.value = new Set(existing);
    collapseDefaultedFor = cid;
  } else {
    // 同会话内重载（拖拽、导入等）：保留用户展开/折叠状态，剪掉已删除的章节
    collapsedChapters.value = new Set([...collapsedChapters.value].filter((id) => existing.has(id)));
  }
}

async function load() {
  await Promise.all([loadMaterials(), loadKnowledgePoints(), loadChapters()]);
  // 恢复模块级抽取锁：组件重挂载后，仍在跑的抽取循环要让按钮保持禁用
  for (const m of materials.value) {
    if (isExtractingMaterial(m.id)) extractState[m.id] = { status: "loading" };
  }
  if (isFullExtracting()) fullExtracting.value = true;
}

function addTopChapter() {
  if (!currentCourseId()) return;
  editingChapter.value = null;
  chapterModal.value = "top";
}

// 聚合所有资料的标题结构，重新识别目录（后续资料多了可重新生成完整目录）
async function reidentifyChapters() {
  if (!currentCourseId() || reidentifying.value) return;
  reidentifying.value = true;
  try {
    // 先对有源文件的资料重新解析（用最新解析器更新 headings，避免旧资料标题乱序）
    const reparseList = materials.value.filter((m) => m.assetPath);
    for (const m of reparseList) {
      try {
        await reparseMaterial(m.id);
      } catch (e) {
        console.error("重新解析资料失败:", e);
      }
    }
    if (reparseList.length > 0) {
      await loadMaterials();
    }
    const allHeadings: ParsedHeading[] = [];
    for (const m of materials.value) {
      try {
        const hs = JSON.parse(m.headings || "[]") as Array<{ level: number; text: string }>;
        for (const h of hs) {
          if (h && typeof h.level === "number" && typeof h.text === "string" && h.text.trim()) {
            allHeadings.push({ level: h.level, text: h.text.trim() });
          }
        }
      } catch {
        // 忽略无法解析的 headings
      }
    }
    // 按「层级 + 标题」去重
    const seen = new Set<string>();
    const deduped = allHeadings.filter((h) => {
      const key = `${h.level}:${h.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (deduped.length === 0) {
      window.siyuanAiStudy.showMessage("未识别到标题结构，请先上传资料", 4000, "error");
      return;
    }
    // AI 矫正目录（未配置「recognize_toc」任务模型时跳过，失败时回退原列表并提示）
    const { headings: finalHeadings, corrected, failed } = await correctTocWithAi(deduped, currentCourseId());
    if (corrected) {
      window.siyuanAiStudy.showMessage("已用 AI 矫正目录，请在预览中核对后确认");
    } else if (failed) {
      window.siyuanAiStudy.showMessage("AI 目录矫正失败或结果不可用，已显示原始识别结果", 4000, "error");
    }
    modalStore.openChapterPreview(currentCourseId(), finalHeadings);
  } finally {
    reidentifying.value = false;
  }
}

function addUnit(ch: Chapter) {
  editingChapter.value = ch;
  chapterModal.value = "unit";
}

function editChapter(ch: Chapter) {
  editingChapter.value = ch;
  chapterModal.value = "edit";
}

async function delChapter(ch: Chapter) {
  if (!window.confirm(`确定删除章节「${ch.name}」？其下小节将一并删除，关联知识点归类改为「未分配」。`)) return;
  try {
    await deleteChapter(ch.id);
    await Promise.all([loadChapters(), loadKnowledgePoints()]);
  } catch (e) {
    console.error("删除章节失败:", e);
    window.siyuanAiStudy.showMessage(e instanceof Error ? e.message : "删除章节失败", 4000, "error");
  }
}

function enterBatchMode() {
  batchMode.value = true;
  selectedChapterIds.value = new Set();
}

function exitBatchMode() {
  batchMode.value = false;
  selectedChapterIds.value = new Set();
}

function toggleSelect(id: number) {
  const s = new Set(selectedChapterIds.value);
  if (s.has(id)) {
    s.delete(id);
  } else {
    s.add(id);
  }
  selectedChapterIds.value = s;
}

function selectAll() {
  const all = chapters.value.map((c) => c.id);
  if (selectedChapterIds.value.size === all.length) {
    selectedChapterIds.value = new Set();
  } else {
    selectedChapterIds.value = new Set(all);
  }
}

async function batchDelete() {
  const ids = [...selectedChapterIds.value];
  if (ids.length === 0) return;
  if (!window.confirm(`确定删除选中的 ${ids.length} 个章节？其下小节将一并删除，关联知识点归类改为「未分配」。`)) return;
  try {
    await deleteChapters(ids);
    exitBatchMode();
    await Promise.all([loadChapters(), loadKnowledgePoints()]);
    window.siyuanAiStudy.showMessage(`已删除 ${ids.length} 个章节`);
  } catch (e) {
    console.error("批量删除章节失败:", e);
    window.siyuanAiStudy.showMessage(e instanceof Error ? e.message : "批量删除章节失败", 4000, "error");
  }
}

function enterKpBatchMode() {
  kpBatchMode.value = true;
  selectedKpIds.value = new Set();
}

function exitKpBatchMode() {
  kpBatchMode.value = false;
  selectedKpIds.value = new Set();
}

function toggleKpSelect(id: number) {
  const s = new Set(selectedKpIds.value);
  if (s.has(id)) {
    s.delete(id);
  } else {
    s.add(id);
  }
  selectedKpIds.value = s;
}

// 全选当前筛选范围内的全部知识点（跨页）
function selectAllKps() {
  const all = filteredKnowledgePoints.value.map((k) => k.id);
  if (selectedKpIds.value.size === all.length && all.length > 0) {
    selectedKpIds.value = new Set();
  } else {
    selectedKpIds.value = new Set(all);
  }
}

// 选中当前页的知识点（并入已有选区，便于跨页逐页勾选）
function selectPageKps() {
  const s = new Set(selectedKpIds.value);
  for (const k of pagedKnowledgePoints.value) {
    s.add(k.id);
  }
  selectedKpIds.value = s;
}

async function batchDeleteKps() {
  const ids = [...selectedKpIds.value];
  if (ids.length === 0) return;
  if (!window.confirm(`确定删除选中的 ${ids.length} 个知识点？相关复习触点与讲解记录将一并清除。`)) return;
  deletingKps.value = true;
  try {
    await deleteKnowledgePoints(ids);
    exitKpBatchMode();
    await loadKnowledgePoints();
    window.siyuanAiStudy.showMessage(`已删除 ${ids.length} 个知识点`);
  } catch (e) {
    console.error("批量删除知识点失败:", e);
    window.siyuanAiStudy.showMessage(e instanceof Error ? e.message : "批量删除知识点失败", 4000, "error");
  } finally {
    deletingKps.value = false;
  }
}

function openUpload() {
  if (!currentCourseId()) return;
  modalStore.openUploadMaterial(currentCourseId());
}

async function del(m: Material) {
  if (!window.confirm(`确定删除资料「${m.name}」？`)) return;
  try {
    await deleteMaterial(m.id);
    delete extractState[m.id];
    await load();
  } catch (e) {
    console.error("删除资料失败:", e);
    window.siyuanAiStudy.showMessage(e instanceof Error ? e.message : "删除资料失败", 4000, "error");
  }
}

function extractLoadingLabel(materialId: number): string {
  const progress = extractState[materialId]?.progress;
  if (!progress) return "抽取中…";
  return `抽取中：第 ${progress.current}/${progress.total} 块 · ${progress.blockTitle || "文本片段"}`;
}

async function extract(m: Material) {
  extractState[m.id] = { status: "loading" };
  try {
    const result = await extractKnowledgePoints(m.id, {
      onProgress: (current, total, blockTitle) => {
        extractState[m.id] = { status: "loading", progress: { current, total, blockTitle } };
      },
    });
    extractState[m.id] = {
      status: "done",
      newCount: result.newCount,
      updateCount: result.updateCount,
      duplicateCount: result.duplicateCount,
      errors: result.errors.length > 0 ? result.errors : undefined,
    };
    await loadKnowledgePoints();
  } catch (e) {
    extractState[m.id] = {
      status: "error",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

const fullExtracting = ref(false);
const fullExtractProgress = ref<{ material: number; total: number; block: string } | null>(null);
const fullExtractLabel = computed(() => {
  if (!fullExtracting.value) return "全量重新抽取";
  const p = fullExtractProgress.value;
  if (!p) return "正在清除旧知识点…";
  return `正在重新抽取：资料 ${p.material}/${p.total}${p.block ? " · " + p.block : ""}…`;
});

// 全量重新抽取：清空本课程全部知识点（级联清理同步进行），再按资料顺序逐块抽取
async function fullReExtract() {
  const cid = currentCourseId();
  if (!cid || fullExtracting.value) return;
  const ids = knowledgePoints.value.map((k) => k.id);
  if (!window.confirm(`全量重新抽取将先清空本课程全部 ${ids.length} 个知识点（级联清理复习节点与讲解记录），再按资料顺序重新抽取。确定继续？`)) return;
  if (!beginFullExtract()) return;
  fullExtracting.value = true;
  fullExtractProgress.value = null;
  try {
    if (ids.length) await deleteKnowledgePoints(ids);
    await loadKnowledgePoints();
    const mats = [...materials.value];
    for (let i = 0; i < mats.length; i++) {
      fullExtractProgress.value = { material: i + 1, total: mats.length, block: "" };
      await extractKnowledgePoints(mats[i].id, {
        onProgress: (current, total, blockTitle) => {
          fullExtractProgress.value = { material: i + 1, total: mats.length, block: `第 ${current}/${total} 块 · ${blockTitle}` };
        },
      });
    }
    await loadKnowledgePoints();
    window.siyuanAiStudy.showMessage("全量重新抽取完成");
  } catch (e) {
    console.error("全量重新抽取失败:", e);
    window.siyuanAiStudy.showMessage(e instanceof Error ? e.message : "全量重新抽取失败", 4000, "error");
  } finally {
    endFullExtract();
    fullExtracting.value = false;
    fullExtractProgress.value = null;
  }
}

function viewKp(kp: KnowledgePoint) {
  detailKp.value = kp;
}

function editDetailKp() {
  editingKp.value = detailKp.value;
  detailKp.value = null;
}

async function removeDetailKp() {
  const kp = detailKp.value;
  if (!kp) return;
  if (!window.confirm(`确定删除知识点「${kp.name}」？`)) return;
  try {
    await deleteKnowledgePoint(kp.id);
    detailKp.value = null;
    await loadKnowledgePoints();
  } catch (e) {
    console.error("删除知识点失败:", e);
    window.siyuanAiStudy.showMessage(e instanceof Error ? e.message : "删除知识点失败", 4000, "error");
  }
}

function formatTime(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

watch(
  () => courseStore.currentCourseId,
  () => {
    selectedChapterId.value = null;
    showUnassigned.value = false;
    exitKpBatchMode();
    currentPage.value = 1;
    searchKeyword.value = "";
    load();
  },
);

// 搜索/章节变化时回到第一页
watch([searchKeyword, selectedChapterId], () => {
  currentPage.value = 1;
});

// 资料上传保存在 App 层 modal 完成，监听刷新信号更新资料列表
watch(
  () => modalStore.materialVersion,
  () => loadMaterials(),
);

// 目录预览确认导入章节后，监听刷新信号更新目录树与知识点归属
watch(
  () => modalStore.chapterVersion,
  () => {
    loadChapters();
    loadKnowledgePoints();
  },
);

onMounted(load);
</script>
