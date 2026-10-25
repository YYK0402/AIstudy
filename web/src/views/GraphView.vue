<template>
  <div class="page">
    <div class="page-title"><h1>知识图谱</h1><div class="desc">前置关系 · 掌握度着色 · 点击查看详情</div></div>

    <div v-if="!currentCourseId()" class="card">
      <div class="empty-state"><span class="ico"><AppIcon name="folder" :size="28" /></span> 请先在「课程主页」选择或创建一个课程</div>
    </div>

    <template v-else>
      <div class="card graph-toolbar-card">
        <div class="graph-toolbar">
          <button class="btn sm primary" :disabled="inferring || knowledgePoints.length === 0" @click="infer">
            <AppIcon name="spark" :size="14" /> {{ inferring ? "推理中…" : "AI 推理关系" }}
          </button>
          <button class="btn sm ghost" :disabled="knowledgePoints.length < 2 || inferring" @click="toggleLink">
            {{ linking ? "取消连线" : "＋ 手动连线" }}
          </button>
          <button class="btn sm ghost" :disabled="knowledgePoints.length === 0" @click="relayout"><AppIcon name="refresh" :size="14" /> 自动布局</button>
          <button class="btn sm ghost" :disabled="knowledgePoints.length === 0" @click="graphRef?.fitView()"><AppIcon name="graph" :size="14" /> 适应画布</button>
          <button class="btn sm ghost" :disabled="writingDoc || edgeCount === 0" @click="writeDoc"><AppIcon name="book" :size="14" /> 写入思源文档</button>
          <input
            v-model="searchQuery"
            class="graph-search"
            type="search"
            placeholder="搜索知识点…"
            aria-label="搜索知识点"
            @keyup.enter="focusSearch"
          />
          <div class="graph-view-tabs">
            <button
              class="chip"
              :class="{ on: viewMode === 'relation' }"
              :disabled="edgeCount === 0"
              title="只显示有前置关系的知识点"
              @click="viewMode = 'relation'"
            >关系图</button>
            <button
              class="chip"
              :class="{ on: viewMode === 'all' }"
              title="显示全部知识点（含未连接）"
              @click="viewMode = 'all'"
            >全部节点</button>
          </div>
          <button class="btn sm ghost" @click="listOpen = true"><AppIcon name="layers" :size="14" /> 节点列表</button>
          <div class="graph-legend">
            <button
              v-for="m in MASTERY_LEGEND"
              :key="m.key"
              class="l"
              :class="{ on: masteryFilter === m.key }"
              :title="`筛选：${m.label}`"
              @click="masteryFilter = masteryFilter === m.key ? null : m.key"
            ><i :style="{ background: m.color }"></i>{{ m.label }}</button>
          </div>
        </div>
        <div v-if="linking" class="s link-hint">
          {{ linkSource === null ? "点击一个节点作为「前置知识点」" : `前置：${nameOf(linkSource)} — 再点一个节点作为「当前知识点」（Esc 取消）` }}
        </div>
        <div v-if="inferError" class="s" style="color:var(--as-red)">✗ {{ inferError }}</div>
        <div v-else-if="inferResult" class="s" style="color:var(--as-green)">✓ {{ inferResult }}</div>
      </div>

      <div class="card" style="margin-top:14px">
        <SkeletonList v-if="loading && knowledgePoints.length === 0" :rows="5" />
        <LoadError
          v-else-if="loadError && knowledgePoints.length === 0"
          :message="loadError"
          @retry="load"
        />
        <div v-else-if="knowledgePoints.length === 0" class="empty-state" style="padding:120px 20px">
          <span class="ico">🕸️</span>
          暂无知识点<br />上传资料并由 AI 解析出知识点后，图谱会展示它们之间的关联
        </div>
        <template v-else>
          <div v-if="edgeCount > 0 && viewMode === 'relation' && relationInfo.isolatedCount > 0" class="graph-isolated">
            <span>还有 {{ relationInfo.isolatedCount }} 个未连接知识点</span>
            <button class="link-btn" @click="viewMode = 'all'">查看全部</button>
          </div>
          <EmptyState
            v-if="edgeCount === 0 && !linking"
            compact
            icon="graph"
            text="暂无前置关系，图谱暂时只显示孤立知识点。&#10;可由 AI 推断依赖，或手动逐条连线。"
          >
            <button class="btn sm primary" :disabled="inferring || knowledgePoints.length === 0" @click="infer">
              <AppIcon name="spark" :size="14" /> {{ inferring ? "推理中…" : "AI 推理关系" }}
            </button>
            <button class="btn sm ghost" :disabled="knowledgePoints.length < 2 || inferring" @click="toggleLink">
              ＋ 手动连线
            </button>
          </EmptyState>
          <div class="graph-stage">
          <KnowledgeGraph
            ref="graphRef"
            :nodes="graphNodes"
            :edges="graphEdges"
            :saved-positions="savedPositions"
            :linking="linking"
            :link-source="linkSource"
            :selected-id="selectedKpId"
            @node-click="onNodeClick"
            @link-pick="onNodeClick"
            @drag-end="onDragEnd"
          />
          <div v-if="filteredKps.length === 0" class="graph-stage-empty">
            <span>当前筛选下没有知识点</span>
            <button class="link-btn" @click="masteryFilter = null">清除筛选</button>
          </div>
          </div>
        </template>
      </div>
    </template>

    <!-- 节点列表（键盘可达的图谱替代入口） -->
    <div class="modal-mask" :class="{ open: listOpen }" @click.self="listOpen = false">
      <div class="modal">
        <h2>知识点列表</h2>
        <input v-model="listQuery" class="kg-list-search" type="search" placeholder="筛选名称…" aria-label="筛选知识点" />
        <div class="kg-list">
          <button v-for="k in listItems" :key="k.id" class="kg-list-item" @click="focusFromList(k.id)">
            <span class="kg-list-name">{{ k.name }}</span>
            <span class="tag" :class="k.mastery"><span class="d"></span>{{ masteryLabel(k.mastery) }}</span>
          </button>
          <div v-if="listItems.length === 0" class="s" style="padding:16px 0;color:var(--as-text-faint)">没有匹配的知识点</div>
        </div>
        <div class="modal-actions">
          <button class="btn ghost" @click="listOpen = false">关闭</button>
        </div>
      </div>
    </div>

    <!-- 节点详情 -->
    <div v-if="selectedKp" class="modal-mask open" @click.self="selectedKpId = null">
      <div class="modal">
        <h2>{{ selectedKp.name }}</h2>
        <div class="kd-section" style="margin-bottom:12px">
          <span class="tag" :class="selectedKp.mastery"><span class="d"></span>{{ masteryLabel(selectedKp.mastery) }}</span>
        </div>
        <div class="kd-section">
          <div class="kd-label">描述</div>
          <div class="kd-content">{{ selectedKp.content || "暂无描述" }}</div>
        </div>
        <div class="kd-section">
          <div class="kd-label">前置知识点（先学这些再学它）</div>
          <div class="kd-text">
            <template v-if="prevOf(selectedKp).length > 0">
              <span v-for="p in prevOf(selectedKp)" :key="p.id" class="graph-kp-link" @click="selectedKpId = p.id">
                {{ p.name }}<i class="edge-del" title="移除该前置关系" @click.stop="delEdge(selectedKp, p)">✕</i>
              </span>
            </template>
            <template v-else>无</template>
          </div>
        </div>
        <div class="kd-section">
          <div class="kd-label">被前置（需要先学本知识点才能学）</div>
          <div class="kd-text">
            <template v-if="nextOf(selectedKp).length > 0">
              <span v-for="n in nextOf(selectedKp)" :key="n.id" class="graph-kp-link" @click="selectedKpId = n.id">
                {{ n.name }}<i class="edge-del" title="移除该前置关系" @click.stop="delEdge(n, selectedKp)">✕</i>
              </span>
            </template>
            <template v-else>无</template>
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn ghost" @click="selectedKpId = null">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import AppIcon from "../components/AppIcon.vue";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import EmptyState from "../components/EmptyState.vue";
import KnowledgeGraph from "../components/KnowledgeGraph.vue";
import { buildRelationView } from "../utils/graphLayout";
import { clearGraphPositions, loadGraphPositions, saveGraphPositions } from "../utils/graphPositions";
import SkeletonList from "../components/SkeletonList.vue";
import LoadError from "../components/LoadError.vue";
import { useCourseStore } from "../stores/course";
import {
  queryKnowledgePoints,
  inferGraphRelations,
  addKpEdge,
  removeKpEdge,
  writeGraphToSiyuan,
  parseKpPrevIds,
  DATA_SAVED_EVENT,
} from "../api";
import type { KnowledgePoint, Mastery } from "../api";

const courseStore = useCourseStore();
const currentCourseId = () => courseStore.currentCourseId;

const knowledgePoints = ref<KnowledgePoint[]>([]);
const selectedKpId = ref<number | null>(null);
const linking = ref(false);
const linkSource = ref<number | null>(null);
const inferring = ref(false);
const writingDoc = ref(false);
const inferError = ref("");
const inferResult = ref("");
const viewMode = ref<"relation" | "all">("relation");
const masteryFilter = ref<Mastery | null>(null);
const listOpen = ref(false);
const listQuery = ref("");

const MASTERY_LEGEND: Array<{ key: Mastery; label: string; color: string }> = [
  { key: "proficient", label: "精通", color: "var(--as-accent)" },
  { key: "mastered", label: "掌握", color: "var(--as-green)" },
  { key: "known", label: "了解", color: "var(--as-blue)" },
  { key: "unlearn", label: "未学习", color: "var(--as-text-faint)" },
];
const savedPositions = ref<Record<string, { x: number; y: number }>>({});

const relationInfo = computed(() => buildRelationView(knowledgePoints.value, edges.value));
/** 关系视图只渲染有前置关系的节点；无边/全部视图渲染全部 */
const visibleKps = computed(() => {
  if (edgeCount.value === 0 || viewMode.value === "all") return knowledgePoints.value;
  return knowledgePoints.value.filter((k) => relationInfo.value.visibleIds.has(k.id));
});

const selectedKp = computed<KnowledgePoint | null>(() =>
  selectedKpId.value !== null
    ? knowledgePoints.value.find((k) => k.id === selectedKpId.value) ?? null
    : null,
);

/** 课程内全部有效边（from=前置 → to=当前） */
const edges = computed(() => {
  const idSet = new Set(knowledgePoints.value.map((k) => k.id));
  const list: Array<{ from: number; to: number }> = [];
  for (const kp of knowledgePoints.value) {
    for (const pid of parseKpPrevIds(kp)) {
      if (pid !== kp.id && idSet.has(pid)) list.push({ from: pid, to: kp.id });
    }
  }
  return list;
});
const edgeCount = computed(() => edges.value.length);

const masteryLabel = (m: Mastery): string => {
  const map: Record<Mastery, string> = { unlearn: "未学习", known: "了解", mastered: "掌握", proficient: "精通" };
  return map[m];
};

function nameOf(id: number): string {
  return knowledgePoints.value.find((k) => k.id === id)?.name ?? "（已删除）";
}

function prevOf(kp: KnowledgePoint): KnowledgePoint[] {
  const map = new Map(knowledgePoints.value.map((k) => [k.id, k]));
  return parseKpPrevIds(kp)
    .map((id) => map.get(id))
    .filter((k): k is KnowledgePoint => Boolean(k));
}

function nextOf(kp: KnowledgePoint): KnowledgePoint[] {
  return knowledgePoints.value.filter((k) => parseKpPrevIds(k).includes(kp.id));
}

const loading = ref(true);
const loadError = ref("");

async function load() {
  loading.value = true;
  loadError.value = "";
  try {
  if (!currentCourseId()) {
    knowledgePoints.value = [];
    return;
  }
  knowledgePoints.value = await queryKnowledgePoints(currentCourseId());
  if (selectedKpId.value !== null && !knowledgePoints.value.some((k) => k.id === selectedKpId.value)) {
    selectedKpId.value = null;
  }
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : "加载知识图谱失败";
    console.error("加载图谱失败:", e);
  } finally {
    loading.value = false;
  }
}

async function infer() {
  const id = currentCourseId();
  if (!id || inferring.value) return;
  inferring.value = true;
  inferError.value = "";
  inferResult.value = "";
  try {
    const n = await inferGraphRelations(id);
    await load();
    inferResult.value = `推理完成，共 ${n} 条前置关系`;
  } catch (e) {
    inferError.value = e instanceof Error ? e.message : String(e);
  } finally {
    inferring.value = false;
  }
}

function toggleLink() {
  linking.value = !linking.value;
  linkSource.value = null;
}

function onNodeClick(id: number) {
  if (linking.value) {
    if (linkSource.value === null) {
      linkSource.value = id;
      return;
    }
    if (linkSource.value === id) {
      linkSource.value = null;
      return;
    }
    const prevId = linkSource.value;
    linkSource.value = null;
    void (async () => {
      inferError.value = "";
      try {
        await addKpEdge(id, prevId);
        await load();
      } catch (e) {
        inferError.value = e instanceof Error ? e.message : String(e);
      }
    })();
    return;
  }
  selectedKpId.value = id;
}

async function delEdge(kp: KnowledgePoint, prev: KnowledgePoint) {
  inferError.value = "";
  try {
    await removeKpEdge(kp.id, prev.id);
    await load();
  } catch (e) {
    inferError.value = e instanceof Error ? e.message : String(e);
  }
}

function relayout() {
  const cid = currentCourseId();
  if (cid) clearGraphPositions(cid);
  savedPositions.value = {};
  graphRef.value?.resetLayout();
}

// ===== 拖动结束：持久化坐标（localStorage，按课程隔离） =====
const graphRef = ref<{
  fitView: () => void;
  centerOn: (id: number, k?: number) => void;
  resetLayout: () => void;
} | null>(null);
const searchQuery = ref("");

const filteredKps = computed(() =>
  masteryFilter.value ? visibleKps.value.filter((k) => k.mastery === masteryFilter.value) : visibleKps.value,
);
const listItems = computed(() => {
  const q = listQuery.value.trim();
  const list = masteryFilter.value
    ? knowledgePoints.value.filter((k) => k.mastery === masteryFilter.value)
    : knowledgePoints.value;
  return q ? list.filter((k) => k.name.includes(q)) : list;
});

const graphNodes = computed(() =>
  filteredKps.value.map((k) => ({
    id: k.id,
    label: k.name.length > 9 ? k.name.slice(0, 9) + "…" : k.name,
    mastery: k.mastery,
  })),
);
const graphEdges = computed(() => edges.value);

function onDragEnd(id: number, x: number, y: number) {
  const next = { ...savedPositions.value, [String(id)]: { x, y } };
  savedPositions.value = next;
  const cid = currentCourseId();
  if (cid) saveGraphPositions(cid, next);
}

async function focusFromList(id: number) {
  listOpen.value = false;
  if (viewMode.value === "relation" && !relationInfo.value.visibleIds.has(id)) viewMode.value = "all";
  masteryFilter.value = null;
  await nextTick();
  graphRef.value?.centerOn(id, 1.6);
  selectedKpId.value = id;
}

async function focusSearch() {
  const q = searchQuery.value.trim();
  if (!q) return;
  const hit = knowledgePoints.value.find((k) => k.name.includes(q));
  if (!hit) {
    window.siyuanAiStudy.showMessage("未找到匹配的知识点", 3000);
    return;
  }
  if (viewMode.value === "relation" && !relationInfo.value.visibleIds.has(hit.id)) {
    viewMode.value = "all";
    await nextTick();
  }
  graphRef.value?.centerOn(hit.id, 1.6);
}

watch(
  () => currentCourseId(),
  (cid) => {
    savedPositions.value = cid ? loadGraphPositions(cid) : {};
    viewMode.value = "relation";
    masteryFilter.value = null;
  },
  { immediate: true },
);

async function writeDoc() {
  const id = currentCourseId();
  if (!id || writingDoc.value) return;
  writingDoc.value = true;
  try {
    const name = await writeGraphToSiyuan(id);
    window.siyuanAiStudy.showMessage(`知识图谱已写入思源文档「${name}」`);
  } catch (e) {
    window.siyuanAiStudy.showMessage(e instanceof Error ? e.message : "写入思源文档失败", 4000, "error");
  } finally {
    writingDoc.value = false;
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape" && linking.value) {
    linking.value = false;
    linkSource.value = null;
  }
}

function onDataSaved() {
  load().catch((e) => console.error("刷新图谱失败:", e));
}

watch(
  () => courseStore.currentCourseId,
  () => {
    selectedKpId.value = null;
    linking.value = false;
    linkSource.value = null;
    inferError.value = "";
    inferResult.value = "";
    load().catch((e) => console.error("加载图谱失败:", e));
  },
);

onMounted(() => {
  load().catch((e) => console.error("加载图谱失败:", e));
  window.addEventListener(DATA_SAVED_EVENT, onDataSaved);
  window.addEventListener("keydown", onKeydown);
});
onBeforeUnmount(() => {
  window.removeEventListener(DATA_SAVED_EVENT, onDataSaved);
  window.removeEventListener("keydown", onKeydown);
});
</script>
