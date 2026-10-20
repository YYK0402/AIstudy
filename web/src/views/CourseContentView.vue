<template>
  <div class="page">
    <div class="page-title"><h1>课程内容</h1><div class="desc">章节 · 资料 · 知识点 · 关联题目</div></div>

    <div class="card">
      <h3>资料库
        <button class="btn primary sm" :disabled="!currentCourseId" @click="openUpload" style="margin-left:auto">
          ＋ 上传资料
        </button>
      </h3>
      <div v-if="!currentCourseId" class="empty-state" style="padding:24px 0">
        <span class="ico">📭</span> 请先在「课程主页」选择或创建一个课程
      </div>
      <div v-else-if="materials.length === 0" class="empty-state" style="padding:24px 0">
        <span class="ico">📚</span> 暂无资料，上传讲义 / Word / PDF / PPT 触发 AI 抽取
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

    <div class="card" style="margin-top:14px">
      <h3>章节目录
        <button class="btn primary sm" :disabled="!currentCourseId" @click="addTopChapter" style="margin-left:auto">
          ＋ 添加章节
        </button>
      </h3>
      <div v-if="!currentCourseId" class="empty-state" style="padding:24px 0">
        <span class="ico">📭</span> 请先选择课程
      </div>
      <div v-else-if="chapters.length === 0" class="empty-state" style="padding:24px 0">
        <span class="ico">🗂️</span> 暂无章节，手动添加章节后可在知识点编辑中调整归属
      </div>
      <div v-else class="chapter-list">
        <template v-for="ch in chapterTree" :key="ch.id">
          <div class="chapter-row">
            <span class="chapter-name">{{ ch.name }}</span>
            <span class="tag chapter">
              <span class="d"></span>{{ ch.level === "chapter" ? "章" : "节" }}
            </span>
            <span style="margin-left:auto"></span>
            <button v-if="ch.level === 'chapter'" class="btn sm ghost" @click="addUnit(ch)">＋小节</button>
            <button class="btn sm ghost" @click="editChapter(ch)">编辑</button>
            <button class="btn sm ghost" @click="delChapter(ch)">删除</button>
          </div>
          <div v-for="u in ch.units" :key="u.id" class="chapter-row unit">
            <span class="chapter-name">{{ u.name }}</span>
            <span class="tag chapter">
              <span class="d"></span>节
            </span>
            <div style="display:flex;gap:6px;flex-shrink:0;margin-left:auto">
              <button class="btn sm ghost" @click="editChapter(u)">编辑</button>
              <button class="btn sm ghost" @click="delChapter(u)">删除</button>
            </div>
          </div>
        </template>
      </div>
    </div>

    <div class="card" style="margin-top:14px">
      <h3>知识点
        <span style="margin-left:auto;font-size:11px;color:var(--as-text-faint)">共 {{ knowledgePoints.length }} 个</span>
      </h3>
      <div v-if="!currentCourseId" class="empty-state" style="padding:24px 0">
        <span class="ico">📭</span> 请先选择课程
      </div>
      <div v-else-if="knowledgePoints.length === 0" class="empty-state" style="padding:24px 0">
        <span class="ico">🌱</span> 暂无知识点，上传资料后点击「抽取知识点」生成
      </div>
      <div v-else class="kp-list">
        <div v-for="kp in knowledgePoints" :key="kp.id" class="kp-item-row">
          <div class="kp-main">
            <div class="kp-line">
              <span class="kp-name">{{ kp.name }}</span>
              <span class="tag" :class="kp.mastery"><span class="d"></span>{{ masteryLabel(kp.mastery) }}</span>
            </div>
            <div class="kp-desc">{{ truncate(kp.content, 80) }}</div>
            <div v-if="kpSources[kp.id]?.length" class="kp-meta">
              来源资料：{{ kpSources[kp.id]!.join("、") }}
            </div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0">
            <button class="btn sm ghost" @click="editKp(kp)">编辑</button>
            <button class="btn sm ghost" @click="delKp(kp)">删除</button>
          </div>
        </div>
      </div>
    </div>

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
import KnowledgePointEditModal from "../components/KnowledgePointEditModal.vue";
import ChapterEditModal from "../components/ChapterEditModal.vue";

const courseStore = useCourseStore();
const modalStore = useModalStore();
const materials = ref<Material[]>([]);
const knowledgePoints = ref<KnowledgePoint[]>([]);
const editingKp = ref<KnowledgePoint | null>(null);
const chapters = ref<Chapter[]>([]);
const chapterModal = ref<"edit" | "top" | "unit" | null>(null);
const editingChapter = ref<Chapter | null>(null);

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

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
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

async function load() {
  await Promise.all([loadMaterials(), loadKnowledgePoints(), loadChapters()]);
}

async function loadChapters() {
  if (!currentCourseId()) {
    chapters.value = [];
    return;
  }
  chapters.value = await queryChapters(currentCourseId());
}

function addTopChapter() {
  if (!currentCourseId()) return;
  editingChapter.value = null;
  chapterModal.value = "top";
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

function editKp(kp: KnowledgePoint) {
  editingKp.value = kp;
}

async function delKp(kp: KnowledgePoint) {
  if (!window.confirm(`确定删除知识点「${kp.name}」？`)) return;
  try {
    await deleteKnowledgePoint(kp.id);
    await loadKnowledgePoints();
  } catch (e) {
    console.error("删除知识点失败:", e);
  }
}

function formatTime(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

watch(
  () => courseStore.currentCourseId,
  () => load(),
);

onMounted(load);
</script>