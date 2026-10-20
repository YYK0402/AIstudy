<template>
  <div class="page">
    <div class="page-title"><h1>课程内容</h1><div class="desc">章节 · 单元 · 知识点 · 关联资料</div></div>

    <div class="two-col">
      <!-- 目录结构 -->
      <div class="card">
        <h3>目录结构
          <button class="btn sm ghost" :disabled="!currentCourseId()" @click="reidentifyChapters">🔄 重新识别目录</button>
          <button class="btn primary sm" :disabled="!currentCourseId()" @click="addTopChapter" style="margin-left:auto">＋ 添加章节</button>
        </h3>
        <div v-if="!currentCourseId()" class="empty-state" style="padding:24px 0">
          <span class="ico">📭</span> 请先选择课程
        </div>
        <div v-else-if="chapters.length === 0" class="empty-state" style="padding:24px 0">
          <span class="ico">🗂️</span> 暂无章节，点击「添加章节」搭建目录
        </div>
        <div v-else class="tree">
          <div v-for="ch in chapterTree" :key="ch.id" class="tree-node" :class="{ open: !collapsedChapters.has(ch.id) }">
            <div class="row" :class="{ active: selectedChapterId === ch.id }" @click="selectChapter(ch.id)">
              <span class="tgl" @click.stop="toggleChapter(ch.id)">▶</span>
              <span class="name">{{ ch.name }}</span>
              <span class="count">{{ kpCountOf(ch.id) }}</span>
              <button class="btn sm ghost" @click.stop="addUnit(ch)">＋小节</button>
              <button class="btn sm ghost" @click.stop="editChapter(ch)">编辑</button>
              <button class="btn sm ghost" @click.stop="delChapter(ch)">删除</button>
            </div>
            <div class="tree-children">
              <div v-for="u in ch.units" :key="u.id" class="tree-node">
                <div class="row" :class="{ active: selectedChapterId === u.id }" @click="selectChapter(u.id)">
                  <span class="tgl" style="opacity:0">▶</span>
                  <span class="name">{{ u.name }}</span>
                  <span class="count">{{ kpCountOf(u.id) }}</span>
                  <button class="btn sm ghost" @click.stop="editChapter(u)">编辑</button>
                  <button class="btn sm ghost" @click.stop="delChapter(u)">删除</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 知识点 -->
      <div class="card">
        <h3>知识点<span v-if="selectedChapterName"> · {{ selectedChapterName }}</span>
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
            @click="viewKp(kp)"
          >
            <span class="idx">{{ String((currentPage - 1) * PAGE_SIZE + i + 1).padStart(2, "0") }}</span>
            <span class="nm">{{ kp.name }}</span>
            <span class="meta">{{ kpSources[kp.id]?.length || 0 }} 份资料</span>
            <span class="tag" :class="kp.mastery"><span class="d"></span>{{ masteryLabel(kp.mastery) }}</span>
          </div>
        </div>
        <div v-if="totalPages > 1" class="pagination">
          <button class="btn sm ghost" :disabled="currentPage === 1" @click="currentPage--">‹ 上一页</button>
          <span class="pg-info">{{ currentPage }} / {{ totalPages }}</span>
          <button class="btn sm ghost" :disabled="currentPage === totalPages" @click="currentPage++">下一页 ›</button>
        </div>
      </div>
    </div>

    <!-- 资料库 -->
    <div class="card" style="margin-top:14px">
      <h3>资料库
        <button class="btn primary sm" :disabled="!currentCourseId()" @click="openUpload" style="margin-left:auto">＋ 上传资料</button>
      </h3>
      <div v-if="materials.length === 0" class="empty-state" style="padding:24px 0">
        <span class="ico">📚</span> 暂无资料，点击右上「＋ 上传资料」导入讲义 / Word / PDF / PPT
      </div>
      <div v-else class="material-list">
        <div v-for="m in materials" :key="m.id" class="material-item">
          <div>
            <div class="m-name">{{ m.name }}</div>
            <div class="m-meta">.{{ m.fileType }} · {{ m.contentText.length }} 字 · {{ formatTime(m.createTime) }}</div>
            <div v-if="extractState[m.id]?.status === 'loading'" class="s" style="color:var(--as-accent-strong);margin-top:4px">抽取中…</div>
            <div v-else-if="extractState[m.id]?.status === 'done'" class="s" style="color:var(--as-green);margin-top:4px">
              ✓ 抽取完成：新增 {{ extractState[m.id]!.newCount }} · 更新 {{ extractState[m.id]!.updateCount }} · 跳过 {{ extractState[m.id]!.duplicateCount }}
            </div>
            <div v-else-if="extractState[m.id]?.status === 'error'" class="s" style="color:var(--as-red);margin-top:4px">
              ✗ {{ extractState[m.id]!.error }}
            </div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0">
            <button class="btn sm ghost" :disabled="extractState[m.id]?.status === 'loading'" @click="extract(m)">
              {{ extractState[m.id]?.status === 'loading' ? "抽取中…" : "抽取知识点" }}
            </button>
            <button class="btn sm ghost" @click="del(m)">删除</button>
          </div>
        </div>
      </div>
    </div>

    <KnowledgePointDetailModal
      :open="detailKp !== null"
      :kp="detailKp"
      :chapter-name="detailChapterName"
      :source-names="detailSourceNames"
      @close="detailKp = null"
      @edit="editDetailKp"
      @delete="removeDetailKp"
    />
    <KnowledgePointEditModal :open="editingKp !== null" :knowledge-point="editingKp" @close="editingKp = null" @saved="loadKnowledgePoints" />
    <ChapterEditModal
      :open="chapterModal !== null"
      :course-id="currentCourseId() ?? 0"
      :chapter="chapterModal === 'edit' ? editingChapter : null"
      :parent-id="chapterModal === 'unit' ? editingChapter?.id ?? null : null"
      @close="chapterModal = null"
      @saved="loadChapters"
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
  extractKnowledgePoints,
  queryKnowledgePoints,
  deleteKnowledgePoint,
  queryChapters,
  deleteChapter,
} from "../api";
import type { Material, KnowledgePoint, Mastery, Chapter } from "../api";
import type { ParsedHeading } from "../utils/documentParser";
import KnowledgePointDetailModal from "../components/KnowledgePointDetailModal.vue";
import KnowledgePointEditModal from "../components/KnowledgePointEditModal.vue";
import ChapterEditModal from "../components/ChapterEditModal.vue";

const courseStore = useCourseStore();
const modalStore = useModalStore();
const materials = ref<Material[]>([]);
const knowledgePoints = ref<KnowledgePoint[]>([]);
const editingKp = ref<KnowledgePoint | null>(null);
const detailKp = ref<KnowledgePoint | null>(null);
const chapters = ref<Chapter[]>([]);
const chapterModal = ref<"edit" | "top" | "unit" | null>(null);
const editingChapter = ref<Chapter | null>(null);
const collapsedChapters = ref<Set<number>>(new Set());
const selectedChapterId = ref<number | null>(null);
const searchKeyword = ref("");
const currentPage = ref(1);
const PAGE_SIZE = 10;

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
  const ch = chapters.value.find((c) => c.id === chapterId);
  if (!ch) return new Set();
  const ids = new Set<number>([ch.id]);
  if (ch.level === "chapter") {
    for (const u of chapters.value) {
      if (u.level === "unit" && u.parentId === ch.id) ids.add(u.id);
    }
  }
  return ids;
}

const filteredKnowledgePoints = computed(() => {
  let list = knowledgePoints.value;
  if (selectedChapterId.value !== null) {
    const ids = chapterKpIds(selectedChapterId.value);
    list = list.filter((k) => k.chapterId !== null && ids.has(k.chapterId));
  }
  const kw = searchKeyword.value.trim().toLowerCase();
  if (kw) {
    list = list.filter(
      (k) => k.name.toLowerCase().includes(kw) || k.content.toLowerCase().includes(kw),
    );
  }
  return list;
});

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
  currentPage.value = 1;
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
}

async function load() {
  await Promise.all([loadMaterials(), loadKnowledgePoints(), loadChapters()]);
}

function addTopChapter() {
  if (!currentCourseId()) return;
  editingChapter.value = null;
  chapterModal.value = "top";
}

// 聚合所有资料的标题结构，重新识别目录（后续资料多了可重新生成完整目录）
function reidentifyChapters() {
  if (!currentCourseId()) return;
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
    window.siyuanAiStudy.showMessage("未识别到标题结构，请先上传资料");
    return;
  }
  modalStore.openChapterPreview(currentCourseId(), deduped);
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
    window.siyuanAiStudy.showMessage(e instanceof Error ? e.message : "删除章节失败");
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
    window.siyuanAiStudy.showMessage(e instanceof Error ? e.message : "删除资料失败");
  }
}

async function extract(m: Material) {
  extractState[m.id] = { status: "loading" };
  try {
    const result = await extractKnowledgePoints(m.id);
    extractState[m.id] = {
      status: "done",
      newCount: result.newCount,
      updateCount: result.updateCount,
      duplicateCount: result.duplicateCount,
    };
    await loadKnowledgePoints();
  } catch (e) {
    extractState[m.id] = {
      status: "error",
      error: e instanceof Error ? e.message : String(e),
    };
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
    window.siyuanAiStudy.showMessage(e instanceof Error ? e.message : "删除知识点失败");
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

// 目录预览确认导入章节后，监听刷新信号更新目录树
watch(
  () => modalStore.chapterVersion,
  () => loadChapters(),
);

onMounted(load);
</script>
