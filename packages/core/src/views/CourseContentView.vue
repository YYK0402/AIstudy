<template>
  <div class="page">
    <div class="page-title"><h1>课程内容</h1><div class="desc">章节 · 单元 · 知识点 · 关联资料</div></div>

    <div v-if="archived" class="archived-banner" style="margin-bottom:14px">
      <span>课程已归档 · 内容只读，如需修改请先在「课程主页」取消归档</span>
    </div>

    <SkeletonList v-if="loading && chapters.length === 0 && materials.length === 0" :rows="5" />
    <LoadError
      v-else-if="error && chapters.length === 0 && materials.length === 0"
      :message="error"
      @retry="load"
    />
    <div v-else class="two-col">
      <!-- 目录结构 -->
      <div class="card">
        <h3>目录结构
          <template v-if="!archived">
            <button class="btn sm ghost" :disabled="!currentCourseId()" @click="reidentifyChapters">
              <AppIcon name="refresh" :size="14" /> 重新识别目录
            </button>
            <button v-if="!batchMode" class="btn sm ghost" title="批量删除章节" :disabled="!currentCourseId() || chapters.length === 0" @click="enterBatchMode"><AppIcon name="check-square" :size="13" /><span>批量删除</span></button>
            <button v-else class="btn sm ghost" @click="exitBatchMode">取消</button>
          </template>
          <button v-if="!docsEnabled()" class="btn sm ghost" title="导出知识点树 Markdown（含掌握度/错题数选项）" :disabled="!currentCourseId()" @click="kpTreeExportOpen = true">导出知识点树</button>
          <button v-if="!archived && !docsEnabled()" class="btn sm ghost" title="导入导出过的知识点树 Markdown（编辑后更新课程）" :disabled="!currentCourseId()" @click="kpTreeImportOpen = true">导入知识点树</button>
          <button v-if="siyuanKpSyncVisible" class="btn sm ghost" title="读取在思源章文档中编辑的知识点（预览确认后更新）" @click="siyuanKpSyncOpen = true"><AppIcon name="refresh" :size="14" /> 从思源同步</button>
          <button v-if="!archived" class="btn primary sm" :disabled="!currentCourseId()" @click="addTopChapter" style="margin-left:auto">＋ 添加章节</button>
        </h3>
        <div v-if="!currentCourseId()" class="empty-state" style="padding:24px 0">
          <span class="ico"><AppIcon name="folder" :size="28" /></span> 请先选择课程
        </div>
        <div v-else-if="chapters.length === 0" class="empty-state" style="padding:24px 0">
          <AppIcon name="folder" :size="28" /> 暂无章节，点击「添加章节」搭建目录
        </div>
        <div v-else class="tree">
          <ChapterTreeRow
            v-for="n in chapterTree"
            :key="n.chapter.id"
            :node="n"
            :depth="0"
            @click="(nd) => (batchMode ? toggleSelect(nd.chapter.id) : selectChapter(nd.chapter.id))"
            @dragstart="onTreeDragStart"
            @dragover="(nd, pos) => onTreeDragOver(nd.chapter.id, pos)"
            @drop="(nd) => onTreeDrop(nd.chapter.id)"
            @menu="(nd) => toggleRowMenu(nd.chapter.id)"
          />
        </div>
        <div v-if="batchMode && chapters.length > 0" class="batch-bar">
          <button class="btn sm ghost" @click="selectAll">全选</button>
          <span class="s t-faint">已选 {{ selectedChapterIds.size }} 项</span>
          <button class="btn sm danger" :disabled="selectedChapterIds.size === 0" @click="batchDelete">删除选中</button>
        </div>
      </div>

      <!-- 知识点 -->
      <div class="card">
        <h3 class="kp-head">
          <span class="kp-head-title">
            知识点<span
              v-if="selectedChapterName"
              class="kp-chapter-name"
              :title="selectedChapterName"
            > · {{ selectedChapterName }}</span>
          </span>
          <span class="kp-head-actions">
            <span v-if="unassignedCount > 0" class="up-chip" :class="{ active: showUnassigned }" @click="toggleUnassigned">未分配 {{ unassignedCount }}</span>
            <template v-if="!archived">
              <button v-if="unassignedCount > 0 && chapters.length > 0" class="btn sm ghost" :disabled="relinking" @click="autoRelink">
                <AppIcon name="spark" :size="14" /> {{ relinking ? "归位中…" : "自动归位" }}
              </button>
              <button v-if="!kpBatchMode" class="btn sm ghost" title="批量删除知识点" :disabled="filteredKnowledgePoints.length === 0" @click="enterKpBatchMode"><AppIcon name="check-square" :size="13" /><span>批量删除</span></button>
              <button v-else class="btn sm ghost" @click="exitKpBatchMode">取消</button>
            </template>
            <span class="kp-count">共 {{ filteredKnowledgePoints.length }} 个</span>
          </span>
        </h3>
        <input
          v-model="searchKeyword"
          class="search-input"
          type="text"
          aria-label="搜索知识点名称或内容"
          placeholder="搜索知识点名称 / 内容…"
        />
        <div v-if="!currentCourseId()" class="empty-state" style="padding:24px 0">
          <span class="ico"><AppIcon name="folder" :size="28" /></span> 请先选择课程
        </div>
        <div v-else-if="filteredKnowledgePoints.length === 0" class="empty-state" style="padding:24px 0">
          <span class="ico"><AppIcon name="spark" :size="28" /></span> {{ searchKeyword ? "未找到匹配的知识点" : "暂无知识点，上传资料后点击「抽取知识点」生成" }}
        </div>
        <div v-else class="kp-list">
          <div
            v-for="(kp, i) in pagedKnowledgePoints"
            :key="kp.id"
            class="kp-item clickable"
            role="button"
            tabindex="0"
            :class="rowDropClass(kp.id)"
            @click="kpBatchMode ? toggleKpSelect(kp.id) : viewKp(kp)"
            @keydown.enter.prevent="kpBatchMode ? toggleKpSelect(kp.id) : viewKp(kp)"
            @keydown.space.prevent="kpBatchMode ? toggleKpSelect(kp.id) : viewKp(kp)"
            @dragover.prevent="kpDragEnabled ? onRowDragOver($event, kp.id) : undefined"
            @dragleave="onRowDragLeave(kp.id)"
            @drop="onRowDrop($event, kp.id)"
          >
            <input v-if="kpBatchMode" type="checkbox" class="tp-check" :checked="selectedKpIds.has(kp.id)" @click.stop @change="toggleKpSelect(kp.id)" />
            <span class="idx">{{ String((currentPage - 1) * PAGE_SIZE + i + 1).padStart(2, "0") }}</span>
            <span class="nm">{{ kp.name }}<span v-if="searchKeyword.trim()" class="kp-path">{{ kpChapterPath(kp) }}</span></span>
            <span v-if="kp.tags && kp.tags.length" class="kp-tags">
              <span v-for="t in (kp.tags ?? []).slice(0, 2)" :key="t" class="tag-plain">{{ t }}</span>
              <span v-if="kp.tags.length> 2" class="tag-plain">+{{ kp.tags.length - 2 }}</span>
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
          <span class="s t-faint">已选 {{ selectedKpIds.size }} 项</span>
          <button class="btn sm danger" :disabled="selectedKpIds.size === 0 || deletingKps" @click="batchDeleteKps">删除选中</button>
        </div>
      </div>
    </div>

    <!-- 资料库 -->
    <div class="card">
      <h3>资料库
        <div style="margin-left:auto;display:flex;gap:6px">
          <button v-if="!archived && materials.length > 0" class="btn sm ghost" :disabled="fullExtracting" @click="fullReExtract">
            {{ fullExtractLabel }}
          </button>
          <button v-if="!archived" class="btn primary sm" :disabled="!currentCourseId() || fullExtracting" @click="openUpload">＋ 上传资料</button>
        </div>
      </h3>
      <div v-if="fullExtracting" class="s t-accent" style="padding:8px 0 4px">{{ fullExtractLabel }}</div>
      <EmptyState
        v-if="materials.length === 0"
        compact
        icon="folder"
        text="暂无资料。&#10;点击右上「＋ 上传资料」导入讲义 / Word / PDF / PPT。"
      />
      <div v-else class="material-list">
        <div v-for="m in materials" :key="m.id" class="material-item">
          <div>
            <div class="m-name">
              {{ m.name }}
              <span class="src-tag">{{ materialSourceLabel(m) }}</span>
            </div>
            <div class="m-meta">.{{ m.fileType }} · {{ m.contentText.length }} 字 · {{ formatTime(m.createTime) }}</div>
            <div v-if="orgTaskOf(m)" class="s" style="margin-top:4px">
              <span class="t-accent" v-if="orgTaskOf(m)!.status === 'running'">
                <AppIcon name="refresh" :size="12" /> {{ orgTaskOf(m)!.message }}
              </span>
              <span class="t-success" v-else-if="orgTaskOf(m)!.status === 'done'">✓ {{ orgTaskOf(m)!.message }}</span>
              <span class="t-danger" v-else-if="orgTaskOf(m)!.status === 'failed'">✗ {{ orgTaskOf(m)!.message }}</span>
              <span v-else class="s">{{ orgTaskOf(m)!.message }}</span>
            </div>
            <div v-if="extractTaskOf(m)" class="s" style="margin-top:4px">
              <span class="t-accent" v-if="extractTaskOf(m)!.status === 'running'">
                <AppIcon name="refresh" :size="12" /> {{ extractTaskOf(m)!.message }}
              </span>
              <span class="t-success" v-else-if="extractTaskOf(m)!.status === 'done'">✓ {{ extractTaskOf(m)!.message }}</span>
              <span class="t-danger" v-else-if="extractTaskOf(m)!.status === 'failed'">✗ {{ extractTaskOf(m)!.message }}</span>
              <span v-else class="s">{{ extractTaskOf(m)!.message }}</span>
            </div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0">
            <button class="btn sm ghost" @click="previewMaterial = m">预览</button>
            <template v-if="!archived">
              <button class="btn sm ghost" :disabled="orgTaskOf(m)?.status === 'running'" @click="startOrganize(m)">
                {{ orgTaskOf(m)?.status === "running" ? "梳理中…" : "🤖 AI 梳理" }}
              </button>
              <button class="btn sm ghost" :disabled="extractTaskOf(m)?.status === 'running'" @click="extract(m)">
                {{ extractTaskOf(m)?.status === "running" ? "抽取中…" : "抽取知识点" }}
              </button>
              <button class="btn sm ghost" @click="del(m)">删除</button>
              <span class="row-more">
                <button class="btn sm ghost row-more-btn" title="更多操作" @click.stop="materialMenuId = materialMenuId === m.id ? null : m.id">⋯</button>
                <div v-if="materialMenuId === m.id" class="row-menu" @click.stop>
                  <button @click.stop="materialMenuId = null; void reidentifyStructure(m)">重新识别结构</button>
                </div>
              </span>
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
      :parent="chapterModal === 'child' ? editingChapter : null"
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
    <KpTreeExportModal
      :open="kpTreeExportOpen"
      :course-id="currentCourseId() ?? 0"
      :course-name="courseStore.currentCourse?.name ?? ''"
      @close="kpTreeExportOpen = false"
    />
    <KpTreeImportModal
      :open="kpTreeImportOpen"
      :course-id="currentCourseId() ?? 0"
      :course-name="courseStore.currentCourse?.name ?? ''"
      @close="kpTreeImportOpen = false"
      @saved="onKpTreeImported"
    />
    <SiyuanKpSyncModal
      :open="siyuanKpSyncOpen"
      :course-id="currentCourseId() ?? 0"
      :course-name="courseStore.currentCourse?.name ?? ''"
      @close="siyuanKpSyncOpen = false"
      @saved="onKpTreeImported"
    />
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: "CourseContentView" });

// keep-alive 停用（切到其他页签）时关闭本地弹层，避免 teleport modal 残留在其他页面上方
onDeactivated(() => {
    detailKp.value = null;
    editingKp.value = null;
    previewMaterial.value = null;
    chapterModal.value = null;
    reviewChapter.value = null;
    kpTreeImportOpen.value = false;
    siyuanKpSyncOpen.value = false;
});
import AppIcon from "../components/AppIcon.vue";
import { onDeactivated, computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from "vue";
import SkeletonList from "../components/SkeletonList.vue";
import LoadError from "../components/LoadError.vue";
import { useLoad } from "../composables/useLoad";
import EmptyState from "../components/EmptyState.vue";
import { useRoute, useRouter } from "vue-router";
import { useCourseStore } from "../stores/course";
import { useDataSavedRefresh } from "../composables/useDataSaved";
import { useModalStore } from "../stores/modal";
import {
  TOC_MERGED_EVENT,
  startTocMergeTask,
  queryMaterials,
  deleteMaterial,
  extractKnowledgePoints,
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
  materialSourceLabel,
  applyChapterMoves,
  applyKnowledgePointSort,
  updateKnowledgePoint,
  startOrganizeTask,
  startExtractTask,
  docsEnabled,
  getSettings,
  getData,
  saveData,
} from "../api";
import type { Material, KnowledgePoint, Mastery, Chapter, MergeResult } from "../api";
import { useNotifyStore, materialTaskId } from "../stores/notify";
import { computeChapterMove, type DropPos } from "../utils/chapterMove";
import { expandChapterNodeIds, kpCountByNode } from "../utils/chapterScope";
import { buildChapterTree, chapterPathText, type NestedChapter } from "../utils/outline";
import ChapterTreeRow from "../components/ChapterTreeRow.vue";
import { chapterTreeCtxKey } from "../components/chapterTreeCtx";
import KnowledgePointDetailModal from "../components/KnowledgePointDetailModal.vue";
import KnowledgePointEditModal from "../components/KnowledgePointEditModal.vue";
import ChapterEditModal from "../components/ChapterEditModal.vue";
import ChapterReviewModal from "../components/ChapterReviewModal.vue";
import MaterialPreviewModal from "../components/MaterialPreviewModal.vue";
import KpTreeExportModal from "../components/KpTreeExportModal.vue";
import KpTreeImportModal from "../components/KpTreeImportModal.vue";
import SiyuanKpSyncModal from "../components/SiyuanKpSyncModal.vue";
import { useConfirm } from "../composables/useConfirm";
import { getBridge } from "@/bridge";

const courseStore = useCourseStore();
const modalStore = useModalStore();
const { confirm } = useConfirm();
const notifyStore = useNotifyStore();

// 资料后台任务状态（AI 梳理 / 知识点抽取，进度见右上铃铛）
function orgTaskOf(m: Material) {
  return notifyStore.taskOf(materialTaskId(m.id, "organize"));
}
function extractTaskOf(m: Material) {
  return notifyStore.taskOf(materialTaskId(m.id, "extract"));
}
function startOrganize(m: Material) {
  if (!currentCourseId()) return;
  startOrganizeTask(m.id, currentCourseId()!);
}
/** 课程归档后内容只读：隐藏全部写入口 */
const archived = computed(() => courseStore.currentCourse?.status === "archived");
const materials = ref<Material[]>([]);
const previewMaterial = ref<Material | null>(null);
const kpTreeExportOpen = ref(false);
const kpTreeImportOpen = ref(false);
/** 知识点树导入落盘后刷新目录树与知识点列表 */
async function onKpTreeImported() {
  await Promise.all([loadChapters(), loadKnowledgePoints()]);
}
// 从思源同步（读回）：按钮显隐 = 未归档 && 思源文档能力开启 && 开启持久化到思源 && 有当前课程
const siyuanKpSyncOpen = ref(false);
const siyuanPersistOn = ref(false);
const siyuanKpSyncVisible = computed(
  () => !archived.value && docsEnabled() && siyuanPersistOn.value && !!currentCourseId(),
);
async function refreshSiyuanPersist() {
  siyuanPersistOn.value = (await getSettings()).persistToSiyuan;
}
const knowledgePoints = ref<KnowledgePoint[]>([]);
const editingKp = ref<KnowledgePoint | null>(null);
const detailKp = ref<KnowledgePoint | null>(null);
const route = useRoute();
const router = useRouter();
const chapters = ref<Chapter[]>([]);
const chapterModal = ref<"edit" | "top" | "child" | null>(null);
const editingChapter = ref<Chapter | null>(null);
/** 资料行「⋯」菜单：同一时间只开一个（与章节行 rowMenuId 独立，id 空间不同） */
const materialMenuId = ref<number | null>(null);
// 展开的章节 id 集合（空 = 全部收起；重进页面/切换课程后自然回到默认全收起）
const expandedChapters = ref<Set<number>>(new Set());
const selectedChapterId = ref<number | null>(null);
/** 章/节行「⋯」菜单：同一时间只开一个 */
const rowMenuId = ref<number | null>(null);

function toggleRowMenu(id: number) {
  rowMenuId.value = rowMenuId.value === id ? null : id;
}
function closeRowMenu() {
  rowMenuId.value = null;
}
const showUnassigned = ref(false);
const relinking = ref(false);
const kpBatchMode = ref(false);
const selectedKpIds = ref<Set<number>>(new Set());
const deletingKps = ref(false);
const searchKeyword = ref("");
const currentPage = ref(1);
const PAGE_SIZE = 10;
const batchMode = ref(false);
const selectedChapterIds = ref<Set<number>>(new Set());

// N 级章节树：flat → 嵌套（同级按 sort；孤儿 parentId 提升顶层防丢失）
const chapterTree = computed<NestedChapter[]>(() => {
  const cid = currentCourseId();
  if (cid === null) return [];
  return buildChapterTree(chapters.value.filter((c) => c.courseId === cid), cid);
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

/** 知识点所属章节完整路径（N 级，搜索结果展示归属用） */
function kpChapterPath(kp: KnowledgePoint): string {
  if (kp.chapterId == null) return "未分配";
  return chapterPathText(chapters.value, kp.chapterId);
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

// ===== 拖拽：章节树换序/跨父移动（N 级，行内三区间）+ 知识点换序/改绑 =====
interface DragPayload {
  kind: "chapter" | "kp";
  id: number;
}
const dragPayload = ref<DragPayload | null>(null);
const dropHint = ref<{ id: number; pos: DropPos } | null>(null);

/** 知识点拖拽仅在无搜索词时可用（避免过滤子集内换序误导全局顺序） */
const kpDragEnabled = computed(() => !archived.value && !kpBatchMode.value && searchKeyword.value.trim() === "");

function onDragStart(kind: DragPayload["kind"], id: number) {
  dragPayload.value = { kind, id };
}

/** 章节树行拖拽开始（N 级任意深度节点统一 kind=chapter） */
function onTreeDragStart(id: number) {
  onDragStart("chapter", id);
}

function onDragEnd() {
  dragPayload.value = null;
  dropHint.value = null;
}

/** KP 行两区间（上/下沿=前后插）；章节树行三区间在 ChapterTreeRow 内计算 */
function posFromEvent(e: DragEvent): DropPos {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const ratio = (e.clientY - rect.top) / rect.height;
  return ratio < 0.5 ? "before" : "after";
}

function rowDropClass(id: number): string {
  if (!dropHint.value || dropHint.value.id !== id) return "";
  return "drop-" + dropHint.value.pos;
}

/** 章节树行拖悬停（pos 由行组件按行内三区间算好） */
function onTreeDragOver(targetId: number, pos: DropPos) {
  const p = dragPayload.value;
  if (!p) return;
  // KP 落章节行统一按「移入」高亮（改绑语义，非插入位置）
  dropHint.value = { id: targetId, pos: p.kind === "kp" ? "inside" : pos };
}

async function onTreeDrop(targetId: number) {
  const p = dragPayload.value;
  const hint = dropHint.value;
  dragPayload.value = null;
  dropHint.value = null;
  if (!p || !hint || hint.id !== targetId || p.id === targetId) return;
  try {
    if (p.kind === "kp") {
      const kp = knowledgePoints.value.find((k) => k.id === p.id);
      if (!kp || kp.chapterId === targetId) return;
      await updateKnowledgePoint({ ...kp, chapterId: targetId });
      await loadKnowledgePoints();
      const node = chapters.value.find((c) => c.id === targetId);
      getBridge().showMessage(`已归入「${node?.name ?? "章节"}」`);
    } else {
      await applyChapterDrop(p.id, targetId, hint.pos);
    }
  } catch (err) {
    console.error("拖拽操作失败:", err);
    getBridge().showMessage(err instanceof Error ? err.message : "拖拽操作失败", 4000, "error");
  }
}

/** KP 行拖悬停：仅 KP 拖拽可落（换序）；章节节点拖过 KP 行不显示指示、dropEffect=none（旧守卫语义） */
function onRowDragOver(e: DragEvent, id: number) {
  const dt = e.dataTransfer;
  const p = dragPayload.value;
  if (!dt || !p || p.id === id) {
    if (dt) dt.dropEffect = "none";
    return;
  }
  if (p.kind !== "kp") {
    dropHint.value = null;
    dt.dropEffect = "none";
    return;
  }
  dropHint.value = { id, pos: posFromEvent(e) };
  dt.dropEffect = "move";
}

function onRowDragLeave(id: number) {
  if (dropHint.value?.id === id) {
    dropHint.value = null;
  }
}

async function onRowDrop(e: DragEvent, id: number) {
  e.preventDefault();
  const p = dragPayload.value;
  const hint = dropHint.value;
  dragPayload.value = null;
  dropHint.value = null;
  if (!p || p.kind !== "kp" || !hint || hint.id !== id || p.id === id) return;
  try {
    await reorderKp(p.id, id, hint.pos === "before" ? "before" : "after");
  } catch (err) {
    console.error("拖拽操作失败:", err);
    getBridge().showMessage(err instanceof Error ? err.message : "拖拽操作失败", 4000, "error");
  }
}

async function applyChapterDrop(dragId: number, targetId: number, pos: DropPos) {
  const moved = computeChapterMove(chapters.value, dragId, targetId, pos);
  if (!moved) return;
  const oldMap = new Map(chapters.value.map((c) => [c.id, c]));
  const moves = moved
    .filter((c) => {
      const o = oldMap.get(c.id);
      // level 也计入变更：拖拽子树下沉/升入时，仅 level 变化的后代节点同样要落库
      return o !== undefined && (o.sort !== c.sort || o.parentId !== c.parentId || o.level !== c.level);
    })
    .map((c) => ({ id: c.id, parentId: c.parentId, sort: c.sort, level: c.level }));
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

const currentCourseId = () => courseStore.currentCourseId;

const masteryLabel = (m: Mastery): string => {
  const map: Record<Mastery, string> = { unlearn: "未学习", known: "了解", mastered: "掌握", proficient: "精通" };
  return map[m];
};

function toggleChapter(id: number) {
  const s = new Set(expandedChapters.value);
  if (s.has(id)) {
    s.delete(id);
  } else {
    s.add(id);
  }
  expandedChapters.value = s;
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
    getBridge().showMessage(
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
    getBridge().showMessage(e instanceof Error ? e.message : "自动归位失败", 4000, "error");
  } finally {
    relinking.value = false;
  }
}

// 每节点知识点数量预计算（O(chapters+kps)），模板行级 O(1) 读取
const kpCountByNodeId = computed(() => kpCountByNode(chapters.value, knowledgePoints.value));

function kpCountOf(chapterId: number): number {
  return kpCountByNodeId.value.get(chapterId) ?? 0;
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
  // 只保留仍存在的章节：重进页面/切换课程时展开集合自然清空（默认全收起），同会话重载保留用户状态
  const existing = new Set(chapters.value.map((c) => c.id));
  expandedChapters.value = new Set([...expandedChapters.value].filter((id) => existing.has(id)));
}

const { loading, error, load } = useLoad(async (ctx) => {
  if (!ctx.courseId) {
    materials.value = [];
    knowledgePoints.value = [];
    chapters.value = [];
    return;
  }
  const [ms, kps, chs] = await Promise.all([
    queryMaterials(ctx.courseId),
    queryKnowledgePoints(ctx.courseId),
    queryChapters(ctx.courseId),
  ]);
  if (ctx.isStale()) return;
  materials.value = ms;
  knowledgePoints.value = kps;
  chapters.value = chs;
  // 只保留仍存在的章节：重进页面/切换课程时展开集合自然清空（默认全收起），同会话重载保留用户状态
  const existing = new Set(chs.map((c) => c.id));
  expandedChapters.value = new Set([...expandedChapters.value].filter((id) => existing.has(id)));
  // 抽取任务状态来自 notify store（localStorage 持久化），组件重挂载后自然恢复
  if (isFullExtracting()) fullExtracting.value = true;
  focusChapterFromQuery();
});

/** 报告热力图 → ?chapter=<id>：展开父章、选中并滚动到该行，然后清掉 query */
function focusChapterFromQuery() {
  const raw = route.query.chapter;
  if (raw == null || raw === "") return;
  const id = Number(Array.isArray(raw) ? raw[0] : raw);
  const node = Number.isFinite(id) ? chapters.value.find((c) => c.id === id) : undefined;
  if (node) {
    // N 级：展开全部祖先链，节点行才可见
    let pid = node.parentId;
    while (pid != null) {
      expandedChapters.value.add(pid);
      pid = chapters.value.find((c) => c.id === pid)?.parentId ?? null;
    }
    expandedChapters.value.add(node.id);
    selectedChapterId.value = node.id;
    void nextTick(() => {
      document.querySelector<HTMLElement>(`[data-chapter-id="${id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }
  router.replace({ path: "/content" });
}

watch(() => route.query.chapter, focusChapterFromQuery);

function addTopChapter() {
  if (!currentCourseId()) return;
  editingChapter.value = null;
  chapterModal.value = "top";
}

// 重新识别目录：触发结构识别 + 语义合并（后台任务，进度见铃铛；完成后由 toc-merged 事件统一弹预览）
function reidentifyChapters() {
  if (!currentCourseId()) return;
  startTocMergeTask(currentCourseId());
}

// 资料行「重新识别结构」= 先清目标资料 outline 再合并：merge 内部对无 outline 资料自动补跑阶段②（单入口）
async function reidentifyStructure(m: Material) {
  const cid = currentCourseId();
  if (!cid) return;
  if (!(await confirm({ message: `将重新识别资料「${m.name}」结构并合并目录。确定继续？` }))) return;
  // 清 outline 落库后，补跑②才会发生（有 outline 资料 merge 只走合并，不会重跑结构识别）
  const data = await getData();
  const target = data.materials.find((x) => x.id === m.id);
  if (target) {
    target.outline = "";
    target.outlineStatus = "none";
    await saveData(data);
  }
  startTocMergeTask(cid, [m.id]);
}

// 目录合并完成（后台任务）→ 命中当前课程时打开目录预览（重新识别/顶栏查看目录/梳理完成自动触发，统一走这里）
function onTocMerged(e: Event) {
  const detail = (e as CustomEvent<{ courseId: number; result: MergeResult }>).detail;
  if (detail.courseId === currentCourseId()) {
    modalStore.openChapterPreview(detail.courseId, detail.result, null, materials.value.length);
  }
}

/** 在被点节点（任意深度）下新建子级：parentId = 该节点 id，level = parent.level + 1 */
function addChapterChild(ch: Chapter) {
  editingChapter.value = ch;
  chapterModal.value = "child";
}

function editChapter(ch: Chapter) {
  editingChapter.value = ch;
  chapterModal.value = "edit";
}

async function delChapter(ch: Chapter) {
  if (!(await confirm({ message: `确定删除章节「${ch.name}」？其下子级将一并删除，关联知识点归类改为「未分配」。`, danger: true, confirmText: "删除" }))) return;
  try {
    await deleteChapter(ch.id);
    await Promise.all([loadChapters(), loadKnowledgePoints()]);
  } catch (e) {
    console.error("删除章节失败:", e);
    getBridge().showMessage(e instanceof Error ? e.message : "删除章节失败", 4000, "error");
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
  if (!(await confirm({ message: `确定删除选中的 ${ids.length} 个章节？其下子级将一并删除，关联知识点归类改为「未分配」。`, danger: true, confirmText: "删除" }))) return;
  try {
    await deleteChapters(ids);
    exitBatchMode();
    await Promise.all([loadChapters(), loadKnowledgePoints()]);
    getBridge().showMessage(`已删除 ${ids.length} 个章节`);
  } catch (e) {
    console.error("批量删除章节失败:", e);
    getBridge().showMessage(e instanceof Error ? e.message : "批量删除章节失败", 4000, "error");
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
  if (!(await confirm({ message: `确定删除选中的 ${ids.length} 个知识点？相关复习触点与讲解记录将一并清除。`, danger: true, confirmText: "删除" }))) return;
  deletingKps.value = true;
  try {
    await deleteKnowledgePoints(ids);
    exitKpBatchMode();
    await loadKnowledgePoints();
    getBridge().showMessage(`已删除 ${ids.length} 个知识点`);
  } catch (e) {
    console.error("批量删除知识点失败:", e);
    getBridge().showMessage(e instanceof Error ? e.message : "批量删除知识点失败", 4000, "error");
  } finally {
    deletingKps.value = false;
  }
}

function openUpload() {
  if (!currentCourseId()) return;
  modalStore.openUploadMaterial(currentCourseId());
}

async function del(m: Material) {
  if (!(await confirm({ message: `确定删除资料「${m.name}」？其关联的知识点不会被删除，源文件在无其他引用时会一并清理。`, danger: true, confirmText: "删除" }))) return;
  try {
    await deleteMaterial(m.id);
    await load();
  } catch (e) {
    console.error("删除资料失败:", e);
    getBridge().showMessage(e instanceof Error ? e.message : "删除资料失败", 4000, "error");
  }
}

// 知识点抽取：后台任务（进度/取消见右上铃铛，切页不丢）；抽取完成后资料库自动刷新
function extract(m: Material) {
  if (!currentCourseId()) return;
  startExtractTask(m.id, currentCourseId()!);
}

const fullExtracting = ref(false);
// 进度按节点单位（Task 7 起）：block=当前节点路径，空=该资料准备中；null=清除旧知识点阶段
const fullExtractProgress = ref<{ material: number; total: number; block: string } | null>(null);
const fullExtractLabel = computed(() => {
  if (!fullExtracting.value) return "全量重新抽取";
  const p = fullExtractProgress.value;
  if (!p) return "正在清除旧知识点…";
  return p.block ? `正在重新抽取：节点 ${p.block}…` : `正在重新抽取：资料 ${p.material}/${p.total}…`;
});

// 全量重新抽取：清空本课程全部知识点（级联清理同步进行），再按资料顺序逐块抽取
async function fullReExtract() {
  const cid = currentCourseId();
  if (!cid || fullExtracting.value) return;
  const ids = knowledgePoints.value.map((k) => k.id);
  if (!(await confirm({ message: `全量重新抽取将先清空本课程全部 ${ids.length} 个知识点（级联清理复习节点与讲解记录），再按资料顺序重新抽取。确定继续？`, danger: true, confirmText: "重新抽取" }))) return;
  if (!beginFullExtract()) return;
  fullExtracting.value = true;
  fullExtractProgress.value = null;
  try {
    if (ids.length) await deleteKnowledgePoints(ids);
    await loadKnowledgePoints();
    const mats = [...materials.value];
    let skipped = 0;
    for (let i = 0; i < mats.length; i++) {
      fullExtractProgress.value = { material: i + 1, total: mats.length, block: "" };
      try {
        await extractKnowledgePoints(mats[i].id, {
          onProgress: (_current, _total, blockTitle) => {
            fullExtractProgress.value = { material: i + 1, total: mats.length, block: blockTitle };
          },
        });
      } catch (e) {
        // 单资料并发冲突跳过并计数，不打断全量流程；其他错误仍整体中止
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("正在抽取中")) {
          skipped++;
          console.warn(`全量重抽跳过资料「${mats[i].name}」：`, e);
          continue;
        }
        throw e;
      }
    }
    await loadKnowledgePoints();
    getBridge().showMessage(skipped > 0 ? `全量重新抽取完成，${skipped} 个资料冲突已跳过` : "全量重新抽取完成");
  } catch (e) {
    console.error("全量重新抽取失败:", e);
    getBridge().showMessage(e instanceof Error ? e.message : "全量重新抽取失败", 4000, "error");
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
  if (!(await confirm({ message: `确定删除知识点「${kp.name}」？`, danger: true, confirmText: "删除" }))) return;
  try {
    await deleteKnowledgePoint(kp.id);
    detailKp.value = null;
    await loadKnowledgePoints();
  } catch (e) {
    console.error("删除知识点失败:", e);
    getBridge().showMessage(e instanceof Error ? e.message : "删除知识点失败", 4000, "error");
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
    void load();
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

// 后台 AI 梳理/知识点抽取任务完成回写数据 → 刷新资料与知识点展示
useDataSavedRefresh(() => {
  loadMaterials();
  loadKnowledgePoints();
  // 设置页改动（persistToSiyuan）会触发 global 保存事件，刷新「从思源同步」按钮显隐
  void refreshSiyuanPersist();
});
// 章节树行上下文：provide 给递归 ChapterTreeRow（行内状态/动作免 props 逐层透传）
provide(chapterTreeCtxKey, {
  isArchived: () => archived.value,
  isBatchMode: () => batchMode.value,
  isSelected: (nid) => selectedChapterId.value === nid,
  isBatchChecked: (nid) => selectedChapterIds.value.has(nid),
  isExpanded: (nid) => expandedChapters.value.has(nid),
  isRowMenuOpen: (nid) => rowMenuId.value === nid,
  dropPos: (nid) => (dropHint.value && dropHint.value.id === nid ? dropHint.value.pos : null),
  draggingId: () => dragPayload.value?.id ?? null,
  toggleExpand: toggleChapter,
  toggleSelect,
  closeRowMenu,
  kpCountOf,
  addChapterChild,
  openReview,
  editChapter,
  delChapter,
  onRowDragLeave,
  onDragEnd,
});

function closeAllRowMenus() {
  closeRowMenu();
  materialMenuId.value = null;
}
onMounted(() => {
  document.addEventListener("click", closeAllRowMenus);
  window.addEventListener(TOC_MERGED_EVENT, onTocMerged);
  void load();
  void refreshSiyuanPersist();
});
onBeforeUnmount(() => {
  document.removeEventListener("click", closeAllRowMenus);
  window.removeEventListener(TOC_MERGED_EVENT, onTocMerged);
});
</script>
