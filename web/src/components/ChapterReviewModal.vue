<template>
  <Teleport to=".ai-study-app">
  <div class="modal-mask" :class="{ open }" @click.self="close">
    <div class="modal">
      <h2>章节复盘 · {{ chapter?.name }}</h2>
      <template v-if="chapter">
        <div class="cr-dist">
          <div v-for="d in distribution" :key="d.key" class="cr-dist-row">
            <span class="cr-dist-label">{{ d.label }}</span>
            <div class="cr-bar"><div class="cr-bar-fill" :class="d.key" :style="{ width: d.pct + '%' }"></div></div>
            <span class="cr-dist-num">{{ d.count }}</span>
          </div>
        </div>
        <div v-if="weakKps.length" class="cr-weak">
          <div class="s t-faint" style="margin-bottom:6px">未掌握知识点（{{ weakKps.length }}）：优先复述讲解 / 补做习题</div>
          <div class="cr-chips">
            <span v-for="kp in weakKps" :key="kp.id" class="tag-plain">{{ kp.name }}</span>
          </div>
        </div>
        <div v-else class="s t-success">本章知识点全部已掌握 ✓</div>
        <div class="cr-wrong" :style="{ marginTop: '14px' }">
          <span v-if="loading" class="t-faint">本章错题加载中…</span>
          <span v-else-if="loadError" class="t-danger">✗ 错题加载失败：{{ loadError }}</span>
          <template v-else>
            本章错题 <b>{{ wrongItems.length }}</b> 题
            <span class="t-faint" v-if="wrongItems.length === 0">（无）</span>
          </template>
        </div>
      </template>
      <div class="modal-actions">
        <button class="btn ghost" @click="close">关闭</button>
        <button class="btn ghost" :disabled="loading || loadError !== '' || wrongItems.length === 0 || exporting" @click="exportMd">
          {{ exporting ? "导出中…" : "📥 导出错题" }}
        </button>
        <button class="btn primary" :disabled="kps.length === 0" @click="goSet">📝 章节组卷</button>
      </div>
    </div>
  </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { queryWrongQuestions, parseQuestionKpIds, exportWrongQuestionsMarkdown } from "../api";
import type { Chapter, KnowledgePoint, Mastery, WrongQuestion, Question } from "../api";

const props = defineProps<{
  open: boolean;
  chapter: Chapter | null;
  /** 本章（含小节）知识点 */
  kps: KnowledgePoint[];
  courseName: string;
}>();

const emit = defineEmits<{ (e: "close"): void }>();
const router = useRouter();

const MASTERY_ORDER: Mastery[] = ["unlearn", "known", "mastered", "proficient"];
const MASTERY_LABELS: Record<Mastery, string> = { unlearn: "未学习", known: "了解", mastered: "掌握", proficient: "精通" };

const wrongItems = ref<Array<{ wrong: WrongQuestion; question: Question }>>([]);
const loading = ref(false);
const loadError = ref("");
const exporting = ref(false);

const distribution = computed(() => {
  const total = props.kps.length;
  return MASTERY_ORDER.map((key) => {
    const count = props.kps.filter((k) => k.mastery === key).length;
    return { key, label: MASTERY_LABELS[key], count, pct: total ? Math.round((count / total) * 100) : 0 };
  });
});

const weakKps = computed(() => props.kps.filter((k) => k.mastery === "unlearn" || k.mastery === "known"));

watch(
  () => props.open,
  async (v) => {
    if (!v || !props.chapter) return;
    loading.value = true;
    loadError.value = "";
    try {
      const all = await queryWrongQuestions(props.chapter.courseId);
      const kpIdSet = new Set(props.kps.map((k) => k.id));
      wrongItems.value = all.filter(({ question }) => parseQuestionKpIds(question).some((id) => kpIdSet.has(id)));
    } catch (e) {
      console.error("加载章节错题失败:", e);
      wrongItems.value = [];
      loadError.value = e instanceof Error ? e.message : "未知错误";
    } finally {
      loading.value = false;
    }
  },
);

function close() {
  emit("close");
}

/** 跳转刷题页组卷面板（预填本章知识点） */
function goSet() {
  if (!props.chapter) return;
  emit("close");
  router.push({ path: "/quiz", query: { set: String(props.chapter.id) } });
}

async function exportMd() {
  if (!props.chapter || wrongItems.value.length === 0 || exporting.value) return;
  exporting.value = true;
  try {
    const md = await exportWrongQuestionsMarkdown(wrongItems.value, props.kps, `${props.courseName} · ${props.chapter.name}`);
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    a.href = url;
    a.download = `错题-${props.chapter.name}-${stamp}.md`;
    a.click();
    URL.revokeObjectURL(url);
    window.siyuanAiStudy.showMessage("本章错题 Markdown 已导出");
  } catch (e) {
    console.error("导出本章错题失败:", e);
    window.siyuanAiStudy.showMessage(e instanceof Error ? e.message : "导出本章错题失败", 4000, "error");
  } finally {
    exporting.value = false;
  }
}
</script>
