<template>
  <div class="page">
    <div class="page-title"><h1>闪卡本</h1><div class="desc">双面闪卡 · AI 生成 · SM2 间隔复习</div></div>

    <div v-if="!currentCourseId()" class="card">
      <div class="empty-state"><span class="ico"><AppIcon name="folder" :size="28" /></span> 请先在「课程主页」选择或创建一个课程</div>
    </div>

    <template v-else>
      <!-- AI 生成 -->
      <div v-show="!archived" class="card">
        <h3>AI 生成闪卡
          <span style="margin-left:auto;font-size:11px;color:var(--as-text-faint)">每个知识点一张卡（正面问题 / 背面答案要点）</span>
        </h3>
        <div v-if="knowledgePoints.length === 0" class="empty-state" style="padding:20px 0">
          <span class="ico"><AppIcon name="spark" :size="28" /></span> 暂无知识点，请先上传资料并抽取知识点
        </div>
        <template v-else>
          <GenConfigBar
            :selected-count="selectedKpIds.length"
            :disabled="generating"
            :action-label="generating ? `生成中 ${genProgress}…` : '开始生成'"
            @select="genKpOpen = true"
            @action="generate"
          >
            <template #scope>
              <label class="s" style="color: var(--as-text-dim); cursor: pointer">
                <input type="checkbox" v-model="overwrite" :disabled="generating" /> 已有卡则覆盖
              </label>
            </template>
          </GenConfigBar>
          <div v-if="generating" class="s" style="margin-top:10px">
            <button class="btn sm ghost" @click="onCancelGenerate">取消生成（已完成部分保留）</button>
          </div>
          <div v-if="genError" class="s" style="color:var(--as-red);margin-top:10px">✗ {{ genError }}</div>
          <div v-else-if="genResult" class="s" style="color:var(--as-green);margin-top:10px">
            {{ genCancelled ? `已取消，保留新增 ${genResult.created} 张` : `✓ 生成完成：新增 ${genResult.created} 张${genResult.updated > 0 ? `、覆盖 ${genResult.updated} 张` : ""}${genResult.skipped > 0 ? `、跳过已有 ${genResult.skipped} 张` : ""}` }}
            <span v-if="genResult.parseSkipped > 0" style="color:var(--as-text-dim)">（{{ genResult.parseSkipped }} 个知识点输出异常未生成，可重新生成补齐）</span>
          </div>
        </template>
      </div>

      <!-- 卡片列表 -->
      <div class="card" style="margin-top:14px">
        <h3>卡片
          <span style="margin-left:auto;font-size:11px;color:var(--as-text-faint)">共 {{ cards.length }} 张</span>
          <button v-if="!archived" class="btn ghost sm" style="margin-left:12px" :disabled="knowledgePoints.length === 0" @click="editModalCard = null; editModalOpen = true">＋ 手动卡</button>
          <button class="btn primary sm" style="margin-left:8px" :disabled="dueCardCount === 0" @click="router.push('/review')">
            开始复习{{ dueCardCount > 0 ? `（${dueCardCount} 张到期）` : "" }}
          </button>
        </h3>
        <SkeletonList v-if="loading && cards.length === 0" :rows="4" />
        <LoadError v-else-if="error && cards.length === 0" :message="error" @retry="load" />
        <EmptyState
          v-else-if="cards.length === 0"
          compact
          icon="cards"
          text="暂无闪卡。&#10;选择知识点后点「开始生成」，或手动添加一张。"
        />
        <div v-else class="fc-list">
          <div v-for="c in cards" :key="c.id" class="fc-item">
            <div class="fc-front">{{ c.front }}</div>
            <div class="fc-foot">
              <span class="src-tag">{{ c.source === "ai" ? "AI 生成" : "手动" }}</span>
              <span class="kp-tag">{{ kpName(c.kpId) }}</span>
              <span class="s" style="color:var(--as-text-faint)">{{ c.createTime.slice(0, 10) }}</span>
              <span style="flex:1"></span>
              <button v-if="!archived" class="btn sm ghost" @click="editModalCard = c; editModalOpen = true">编辑</button>
              <button v-if="!archived" class="btn sm ghost danger" @click="delCard(c)">删除</button>
              <button class="btn sm ghost" @click="reviewNow(c)">去复习</button>
            </div>
          </div>
        </div>
      </div>

      <KpSelectModal
        :open="genKpOpen"
        :chapters="chapters"
        :kps="knowledgePoints"
        :initial-selected="selectedKpIds"
        @close="genKpOpen = false"
        @confirm="onGenKpConfirm"
      />
      <FlashcardEditModal
        :open="editModalOpen"
        :card="editModalCard"
        :course-id="currentCourseId() ?? 0"
        :kps="knowledgePoints"
        @close="editModalOpen = false"
        @saved="load"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import GenConfigBar from "../components/GenConfigBar.vue";
import AppIcon from "../components/AppIcon.vue";
import { computed, onMounted, ref, watch } from "vue";
import EmptyState from "../components/EmptyState.vue";
import SkeletonList from "../components/SkeletonList.vue";
import LoadError from "../components/LoadError.vue";
import { useLoad } from "../composables/useLoad";
import { useRouter } from "vue-router";
import { useCourseStore } from "../stores/course";
import {
  queryFlashCards,
  queryKnowledgePoints,
  queryChapters,
  queryDueReviews,
  deleteFlashCards,
  generateFlashcards,
  cancelAiCall,
} from "../api";
import type { Chapter, FlashCard, KnowledgePoint, GenerateFlashcardsResult } from "../api";
import KpSelectModal from "../components/KpSelectModal.vue";
import { useDataSavedRefresh } from "../composables/useDataSaved";
import FlashcardEditModal from "../components/FlashcardEditModal.vue";

const courseStore = useCourseStore();
const currentCourseId = () => courseStore.currentCourseId;
const archived = computed(() => courseStore.currentCourse?.status === "archived");
const router = useRouter();

const knowledgePoints = ref<KnowledgePoint[]>([]);
const chapters = ref<Chapter[]>([]);
const cards = ref<FlashCard[]>([]);
const dueCardCount = ref(0);

const genKpOpen = ref(false);
const selectedKpIds = ref<number[]>([]);
const overwrite = ref(false);
const generating = ref(false);
const genCancelled = ref(false);
const cancelFlag: { aborted: boolean } = { aborted: false };
const genProgress = ref("");
const genError = ref("");
const genResult = ref<GenerateFlashcardsResult | null>(null);

const editModalOpen = ref(false);
const editModalCard = ref<FlashCard | null>(null);

const kpName = (id: number): string => knowledgePoints.value.find((k) => k.id === id)?.name ?? "（知识点已删除）";

function onGenKpConfirm(ids: number[]) {
  selectedKpIds.value = ids;
  genKpOpen.value = false;
}

function onCancelGenerate() {
  const id = currentCourseId();
  cancelFlag.aborted = true;
  // 打断在途 AI 调用（forwardProxy 无网络层 abort：响应返回后丢弃）
  if (id != null) cancelAiCall("gen_flashcard", "course-" + id);
}

const { loading, error, load } = useLoad(async (ctx) => {
  if (!ctx.courseId) {
    cards.value = [];
    dueCardCount.value = 0;
    return;
  }
  const [cardList, kps, chs, due] = await Promise.all([
    queryFlashCards(ctx.courseId),
    queryKnowledgePoints(ctx.courseId),
    queryChapters(ctx.courseId),
    queryDueReviews(ctx.courseId),
  ]);
  if (ctx.isStale()) return;
  cards.value = cardList;
  knowledgePoints.value = kps;
  chapters.value = chs;
  dueCardCount.value = due.filter((i) => i.flashcard !== null).length;
});

async function generate() {
  const id = currentCourseId();
  if (!id || selectedKpIds.value.length === 0 || generating.value) return;
  generating.value = true;
  genError.value = "";
  genResult.value = null;
  genCancelled.value = false;
  cancelFlag.aborted = false;
  genProgress.value = `0 / ${selectedKpIds.value.length}`;
  try {
    const result = await generateFlashcards(id, selectedKpIds.value, {
      overwrite: overwrite.value,
      isAborted: () => cancelFlag.aborted,
      onProgress: (done, total) => {
        genProgress.value = `${done} / ${total}`;
      },
    });
    genCancelled.value = cancelFlag.aborted;
    genResult.value = result;
    if (result.errors.length > 0) {
      genError.value = result.errors.join("；");
    }
    if (result.created + result.updated > 0) {
      window.siyuanAiStudy.showMessage(`已生成 ${result.created + result.updated} 张闪卡`);
    }
    await load();
  } catch (e) {
    console.error("AI 生成闪卡失败:", e);
    genError.value = e instanceof Error ? e.message : String(e);
  } finally {
    generating.value = false;
  }
}

async function delCard(c: FlashCard) {
  if (!window.confirm(`删除闪卡「${c.front.slice(0, 20)}…」？其复习排期将一并删除`)) return;
  try {
    await deleteFlashCards([c.id]);
    await load();
  } catch (e) {
    console.error("删除闪卡失败:", e);
    window.siyuanAiStudy.showMessage(e instanceof Error ? e.message : "删除闪卡失败", 4000, "error");
  }
}

function reviewNow(c: FlashCard) {
  if (dueCardCount.value === 0) {
    window.siyuanAiStudy.showMessage("该闪卡尚未到期，到期后会出现在「复习计划」与今日任务中");
    return;
  }
  void c;
  router.push("/review");
}

watch(
  () => courseStore.currentCourseId,
  () => {
    selectedKpIds.value = [];
    genResult.value = null;
    genError.value = "";
    void load();
  },
);

useDataSavedRefresh(() => void load());

onMounted(() => {
  void load();
});
</script>
