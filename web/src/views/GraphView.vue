<template>
  <div class="page">
    <div class="page-title"><h1>知识图谱</h1><div class="desc">前置关系 · 掌握度着色 · 点击查看详情</div></div>

    <div v-if="!currentCourseId()" class="card">
      <div class="empty-state"><span class="ico">📭</span> 请先在「课程主页」选择或创建一个课程</div>
    </div>

    <template v-else>
      <div class="card graph-toolbar-card">
        <div class="graph-toolbar">
          <button class="btn sm primary" :disabled="inferring || knowledgePoints.length === 0" @click="infer">
            {{ inferring ? "推理中…" : "⚡ AI 推理关系" }}
          </button>
          <button class="btn sm ghost" :disabled="knowledgePoints.length < 2 || inferring" @click="toggleLink">
            {{ linking ? "取消连线" : "＋ 手动连线" }}
          </button>
          <button class="btn sm ghost" :disabled="knowledgePoints.length === 0" @click="relayout">⟳ 自动布局</button>
          <button class="btn sm ghost" :disabled="writingDoc || edgeCount === 0" @click="writeDoc">⤓ 写入思源文档</button>
          <div class="graph-legend">
            <span class="l"><i style="background:var(--as-accent)"></i>精通</span>
            <span class="l"><i style="background:var(--as-green)"></i>掌握</span>
            <span class="l"><i style="background:var(--as-blue)"></i>了解</span>
            <span class="l"><i style="background:var(--as-text-faint)"></i>未学习</span>
          </div>
        </div>
        <div v-if="linking" class="s link-hint">
          {{ linkSource === null ? "点击一个节点作为「前置知识点」" : `前置：${nameOf(linkSource)} — 再点一个节点作为「当前知识点」（Esc 取消）` }}
        </div>
        <div v-if="inferError" class="s" style="color:var(--as-red)">✗ {{ inferError }}</div>
        <div v-else-if="inferResult" class="s" style="color:var(--as-green)">✓ {{ inferResult }}</div>
      </div>

      <div class="card" style="margin-top:14px">
        <div v-if="knowledgePoints.length === 0" class="empty-state" style="padding:120px 20px">
          <span class="ico">🕸️</span>
          暂无知识点<br />上传资料并由 AI 解析出知识点后，图谱会展示它们之间的关联
        </div>
        <template v-else>
          <div v-if="edgeCount === 0" class="graph-hint">
            暂无前置关系，点击「⚡ AI 推理关系」由 AI 推断，或「＋ 手动连线」逐条添加
          </div>
          <svg
            class="graph-svg"
            :viewBox="`0 0 ${layout.width} ${layout.height}`"
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              <marker id="as-graph-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="var(--as-text-dim)" />
              </marker>
            </defs>
            <path v-for="e in layout.edges" :key="e.key" :d="e.d" class="graph-edge" marker-end="url(#as-graph-arrow)" />
            <g
              v-for="n in layout.nodes"
              :key="n.kp.id"
              class="graph-node"
              :class="{ linkable: linking, picked: linking && linkSource === n.kp.id, [`m-${n.kp.mastery}`]: true }"
              @click="onNodeClick(n.kp)"
            >
              <rect :x="n.x - NODE_W / 2" :y="n.y - NODE_H / 2" :width="NODE_W" :height="NODE_H" rx="8" />
              <text :x="n.x" :y="n.y + 4" text-anchor="middle">{{ n.label }}</text>
            </g>
          </svg>
        </template>
      </div>
    </template>

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
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
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

const NODE_W = 124;
const NODE_H = 34;
const GAP_X = 36;
const GAP_Y = 84;

const knowledgePoints = ref<KnowledgePoint[]>([]);
const selectedKpId = ref<number | null>(null);
const linking = ref(false);
const linkSource = ref<number | null>(null);
const inferring = ref(false);
const writingDoc = ref(false);
const inferError = ref("");
const inferResult = ref("");
const layoutKey = ref(0);

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

interface LaidNode {
  kp: KnowledgePoint;
  x: number;
  y: number;
  label: string;
}
interface LaidEdge {
  key: string;
  d: string;
}

/** 分层布局：层级 = 从根（无前置）出发的最长路径，环安全；同层水平居中 */
const layout = computed<{ nodes: LaidNode[]; edges: LaidEdge[]; width: number; height: number }>(() => {
  void layoutKey.value;
  const kps = knowledgePoints.value;
  const byId = new Map(kps.map((k) => [k.id, k]));
  const levelOf = new Map<number, number>();
  const computing = new Set<number>();
  const level = (id: number): number => {
    const cached = levelOf.get(id);
    if (cached !== undefined) return cached;
    if (computing.has(id)) return 0; // 环回边：按根处理
    computing.add(id);
    const prevs = parseKpPrevIds(byId.get(id)!).filter((pid) => byId.has(pid) && pid !== id);
    const lv = prevs.length > 0 ? 1 + Math.max(...prevs.map(level)) : 0;
    computing.delete(id);
    levelOf.set(id, lv);
    return lv;
  };
  for (const k of kps) level(k.id);
  const maxLevel = kps.length > 0 ? Math.max(...kps.map((k) => levelOf.get(k.id) ?? 0)) : 0;
  const levels: KnowledgePoint[][] = [];
  for (const k of kps) {
    const lv = levelOf.get(k.id) ?? 0;
    const row = levels[lv] ?? (levels[lv] = []);
    row.push(k);
  }
  const maxPerLevel = Math.max(1, ...levels.map((l) => l.length));
  const width = maxPerLevel * (NODE_W + GAP_X) + GAP_X;
  const height = (maxLevel + 1) * (NODE_H + GAP_Y) + GAP_Y;
  const pos = new Map<number, { x: number; y: number }>();
  levels.forEach((row, lv) => {
    const rowW = row.length * NODE_W + (row.length - 1) * GAP_X;
    const startX = (width - rowW) / 2 + NODE_W / 2;
    row.forEach((k, i) => {
      pos.set(k.id, {
        x: startX + i * (NODE_W + GAP_X),
        y: GAP_Y / 2 + lv * (NODE_H + GAP_Y) + NODE_H / 2,
      });
    });
  });
  const nodes: LaidNode[] = kps.map((k) => {
    const p = pos.get(k.id)!;
    return {
      kp: k,
      x: p.x,
      y: p.y,
      label: k.name.length > 8 ? k.name.slice(0, 8) + "…" : k.name,
    };
  });
  const laidEdges: LaidEdge[] = [];
  for (const e of edges.value) {
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (!a || !b) continue;
    const x1 = a.x;
    const y1 = a.y + NODE_H / 2;
    const x2 = b.x;
    const y2 = b.y - NODE_H / 2;
    const my = (y1 + y2) / 2;
    laidEdges.push({
      key: `${e.from}->${e.to}`,
      d: `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`,
    });
  }
  return { nodes, edges: laidEdges, width, height };
});

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

async function load() {
  if (!currentCourseId()) {
    knowledgePoints.value = [];
    return;
  }
  knowledgePoints.value = await queryKnowledgePoints(currentCourseId());
  if (selectedKpId.value !== null && !knowledgePoints.value.some((k) => k.id === selectedKpId.value)) {
    selectedKpId.value = null;
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

function onNodeClick(kp: KnowledgePoint) {
  if (linking.value) {
    if (linkSource.value === null) {
      linkSource.value = kp.id;
      return;
    }
    if (linkSource.value === kp.id) {
      linkSource.value = null;
      return;
    }
    const prevId = linkSource.value;
    linkSource.value = null;
    void (async () => {
      inferError.value = "";
      try {
        await addKpEdge(kp.id, prevId);
        await load();
      } catch (e) {
        inferError.value = e instanceof Error ? e.message : String(e);
      }
    })();
    return;
  }
  selectedKpId.value = kp.id;
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
  layoutKey.value++;
}

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
