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
      <h3>知识点</h3>
      <div class="empty-state" style="padding:24px 0">
        <span class="ico">🌱</span> 暂无知识点，上传资料后由 AI 抽取生成
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref, watch } from "vue";
import { useCourseStore } from "../stores/course";
import { useModalStore } from "../stores/modal";
import { queryMaterials, deleteMaterial, extractKnowledgePoints } from "../api";
import type { Material } from "../api";

const courseStore = useCourseStore();
const modalStore = useModalStore();
const materials = ref<Material[]>([]);

interface ExtractState {
  status: "loading" | "done" | "error";
  newCount?: number;
  updateCount?: number;
  duplicateCount?: number;
  error?: string;
}
const extractState = reactive<Record<number, ExtractState>>({});

const currentCourseId = () => courseStore.currentCourseId;

async function load() {
  if (!currentCourseId()) {
    materials.value = [];
    return;
  }
  materials.value = await queryMaterials(currentCourseId());
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
  } catch (e) {
    extractState[m.id] = {
      status: "error",
      error: e instanceof Error ? e.message : String(e),
    };
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