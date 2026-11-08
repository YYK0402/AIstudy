<template>
  <div class="modal-mask" :class="{ open: modalStore.chapterPreviewOpen }" @click.self="close">
    <div class="modal tp-modal">
      <h2>目录预览<template v-if="modalStore.chapterPreviewMaterialCount > 1">（全部 {{ modalStore.chapterPreviewMaterialCount }} 份资料）</template></h2>
      <div class="s t-faint" style="margin-bottom:14px">
        识别到以下章节结构（{{ levelCount }} 级，由 {{ modalStore.chapterPreviewMaterialCount }} 份资料语义合并），可编辑后确认生成目录
      </div>
      <div class="tp-list">
        <div v-if="tree.length === 0" class="empty-state" style="padding:16px">
          未识别到章节结构，可手动「添加章节」
        </div>
        <PreviewTreeNode
          v-for="n in tree"
          :key="n.id"
          :node="n"
          :depth="0"
          @add="addNode"
          @remove="removeNode"
        />
        <button class="btn sm ghost" style="align-self:flex-start" @click="addRoot">＋ 添加章节</button>
      </div>
      <div v-if="failedList.length > 0" class="tp-failed">
        <div class="tp-failed-title">以下 {{ failedList.length }} 份资料合并失败，其目录未进入上方结构</div>
        <div v-for="(f, i) in failedList" :key="i" class="tp-failed-item">
          <div class="tp-failed-name">{{ f.materialName }}：<span class="t-danger">{{ f.reason }}</span></div>
          <div v-if="f.outline.length > 0" class="tp-failed-outline">
            <div v-for="(h, j) in f.outline" :key="j">{{ h.text }}</div>
          </div>
          <div class="s t-faint">可确认后手工「＋子」补章</div>
        </div>
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
import { computed, ref, watch } from "vue";
import { useModalStore } from "../stores/modal";
import { importChapterTree, listUnextractedMaterials, startBatchExtractTask, queryMaterials } from "../api";
import type { ChapterTreeNode, Material, MergeResult } from "../api";
import { alignOutlineSpans, outlineOf } from "../utils/outline";
import PreviewTreeNode from "./PreviewTreeNode.vue";
import type { PreviewNode } from "./PreviewTreeNode.vue";
import { getBridge } from "@/bridge";

const modalStore = useModalStore();
const saving = ref(false);

const tree = ref<PreviewNode[]>([]);
/** 新增预览节点的 id 计数器（避开 MergeNode 0 基下标 id） */
let nextId = 0;

const levelCount = computed(() => {
  let max = 1;
  const walk = (list: PreviewNode[], depth: number): void => {
    for (const n of list) {
      if (depth + 1 > max) max = depth + 1;
      walk(n.children, depth + 1);
    }
  };
  walk(tree.value, 0);
  return max;
});

const failedList = computed(() => modalStore.chapterPreviewResult?.failed ?? []);

/** MergeNode[]（扁平）按 parent 建递归树；from=映射反查资料名，unlocated=对应资料 span 对齐复算 */
function buildPreviewTree(res: MergeResult, materials: Material[]): PreviewNode[] {
  // 每份资料预计算未定位 seq 集合（materialId → outline 内未定位节点序号）
  const unlocatedSeqByMat = new Map<number, Set<number>>();
  for (const mat of materials) {
    const outline = outlineOf(mat);
    if (outline.length === 0) continue;
    const { spans } = alignOutlineSpans(mat.contentText, outline);
    const bad = new Set<number>();
    for (const sp of spans) if (sp.start < 0) bad.add(sp.seq);
    unlocatedSeqByMat.set(mat.id, bad);
  }
  const nameById = new Map(materials.map((m) => [m.id, m.name]));
  const fromByNode = new Map<number, Set<string>>();
  const unlocatedByNode = new Map<number, boolean>();
  for (const rm of res.mappings) {
    const name = nameById.get(rm.materialId);
    if (name) {
      let s = fromByNode.get(rm.nodeId);
      if (!s) fromByNode.set(rm.nodeId, (s = new Set()));
      s.add(name);
    }
    if (unlocatedSeqByMat.get(rm.materialId)?.has(rm.materialSeq)) unlocatedByNode.set(rm.nodeId, true);
  }
  const nodes: PreviewNode[] = res.nodes.map((n) => ({
    id: n.id,
    name: n.name,
    variants: [...n.variants],
    from: [...(fromByNode.get(n.id) ?? [])],
    unlocated: unlocatedByNode.get(n.id) ?? false,
    chapterId: n.chapterId,
    children: [],
  }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const roots: PreviewNode[] = [];
  for (const m of res.nodes) {
    const n = byId.get(m.id);
    if (!n) continue;
    const parent = m.parent === null ? undefined : byId.get(m.parent);
    if (parent) parent.children.push(n);
    else roots.push(n); // parent 缺失理论上不会发生（parseMergeResponse 已校验悬空/成环）：提升根防丢失
  }
  return roots;
}

watch(
  () => modalStore.chapterPreviewOpen,
  async (open) => {
    if (!open) return;
    const res = modalStore.chapterPreviewResult;
    if (!res) {
      tree.value = [];
      return;
    }
    // 来源徽章资料名按资料 id 反查（RawMapping.materialId 是资料 id，与列表顺序无关）
    const materials = await queryMaterials(modalStore.chapterPreviewCourseId);
    // 异步间隙弹窗可能已关闭：丢弃本次构建
    if (!modalStore.chapterPreviewOpen) return;
    tree.value = buildPreviewTree(res, materials);
    let maxId = -1;
    for (const n of res.nodes) maxId = Math.max(maxId, n.id);
    nextId = maxId + 1;
  },
  { immediate: true },
);

function findNode(list: PreviewNode[], id: number): PreviewNode | null {
  for (const n of list) {
    if (n.id === id) return n;
    const hit = findNode(n.children, id);
    if (hit) return hit;
  }
  return null;
}

/** 「＋子」：在该节点 children 末尾追加空节点（事件自递归组件冒泡到顶） */
function addNode(parentId: number) {
  const parent = findNode(tree.value, parentId);
  if (!parent) return;
  parent.children.push({ id: nextId++, name: "", variants: [], from: [], unlocated: false, chapterId: null, children: [] });
}

/** 「＋ 添加章节」：根级追加空节点 */
function addRoot() {
  tree.value.push({ id: nextId++, name: "", variants: [], from: [], unlocated: false, chapterId: null, children: [] });
}

/** 删除节点连同其整棵子树 */
function removeNode(id: number) {
  const rec = (list: PreviewNode[]): void => {
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        list.splice(i, 1);
        i--;
      } else {
        rec(list[i].children);
      }
    }
  };
  rec(tree.value);
}

/**
 * PreviewNode[] → ChapterTreeNode[]（importChapterTree 入参）。
 * 关键契约：前段必须与 result.nodes 原序对齐直传（rm.nodeId 是该数组下标，错位=映射到错误章节）——
 * 用户删掉/留空名字的节点（连同其子树）以空名占位保下标（importChapterTree 跳过空名且不写映射）；
 * 用户手工新增的节点不参与 toc 映射，按文档序追加在末尾（父在子前）。
 */
function buildImportNodes(res: MergeResult): ChapterTreeNode[] {
  const previewById = new Map<number, PreviewNode>();
  const collect = (list: PreviewNode[]): void => {
    for (const n of list) {
      previewById.set(n.id, n);
      collect(n.children);
    }
  };
  collect(tree.value);
  const byMergeId = new Map(res.nodes.map((n) => [n.id, n]));
  // 有效 = 预览中存在且名字非空，且所有祖先有效（空名/被删节点连同子树跳过）
  const validCache = new Map<number, boolean>();
  const isValid = (id: number): boolean => {
    const cached = validCache.get(id);
    if (cached !== undefined) return cached;
    const pnode = previewById.get(id);
    const mnode = byMergeId.get(id);
    let ok = pnode !== undefined && mnode !== undefined && pnode.name.trim() !== "";
    if (ok && mnode !== undefined && mnode.parent !== null) ok = isValid(mnode.parent);
    validCache.set(id, ok);
    return ok;
  };
  const depthCache = new Map<number, number>();
  const depthOf = (id: number): number => {
    const cached = depthCache.get(id);
    if (cached !== undefined) return cached;
    const mnode = byMergeId.get(id)!;
    const d = mnode.parent === null ? 1 : depthOf(mnode.parent) + 1;
    depthCache.set(id, d);
    return d;
  };
  const nodes: ChapterTreeNode[] = res.nodes.map((m) => {
    const ok = isValid(m.id);
    const pnode = previewById.get(m.id);
    const parent = ok && m.parent !== null ? previewById.get(m.parent) : undefined;
    return {
      name: ok && pnode ? pnode.name.trim() : "",
      level: depthOf(m.id),
      parentName: parent ? parent.name.trim() : null,
    };
  });
  // 用户新增节点（不在 result.nodes 中）：父链有效且名字非空才入库，追加末尾
  const walkAdded = (n: PreviewNode, depth: number, parent: PreviewNode | null, parentValid: boolean): void => {
    const ok = parentValid && n.name.trim() !== "";
    if (ok && !byMergeId.has(n.id)) {
      nodes.push({ name: n.name.trim(), level: depth + 1, parentName: parent ? parent.name.trim() : null });
    }
    for (const c of n.children) walkAdded(c, depth + 1, ok ? n : null, ok);
  };
  for (const root of tree.value) walkAdded(root, 0, null, true);
  return nodes;
}

async function confirm() {
  const res = modalStore.chapterPreviewResult;
  if (!res) return;
  const nodes = buildImportNodes(res);
  if (!nodes.some((n) => n.name)) {
    getBridge().showMessage("请至少填写一个章节名称", 4000, "error");
    return;
  }
  saving.value = true;
  try {
    const courseId = modalStore.chapterPreviewCourseId;
    const r = await importChapterTree(courseId, nodes, { result: res });
    let msg = `已生成目录：新增 ${r.created} 个章节`;
    if (r.moved > 0) msg += `，${r.moved} 个章节调整到正确父章`;
    if (r.linked > 0) msg += `，自动挂钩 ${r.linked} 个知识点`;
    if (r.stuck > 0) msg += `；${r.stuck} 个知识点无法自动挂钩（无标题或标题与章节名差异过大），可逐个「编辑」指定章节`;
    // 目录确认后：所有尚无知识点的资料一起抽取（知识点基于完整目录分析，而非只抽触发本次预览的资料）
    const unextracted = await listUnextractedMaterials(courseId);
    if (unextracted.length > 0) {
      msg += unextracted.length > 1
        ? `；${unextracted.length} 份未抽资料知识点抽取已后台启动（进度见右上铃铛）`
        : "；知识点抽取已后台启动（进度见右上铃铛）";
    }
    getBridge().showMessage(msg);
    modalStore.notifyChapterImported();
    close();
    if (unextracted.length > 0) startBatchExtractTask(unextracted.map((m) => m.id), courseId);
  } catch (e) {
    console.error("生成目录失败:", e);
    getBridge().showMessage(e instanceof Error ? e.message : "生成目录失败", 4000, "error");
  } finally {
    saving.value = false;
  }
}

function close() {
  modalStore.closeChapterPreview();
}
</script>
