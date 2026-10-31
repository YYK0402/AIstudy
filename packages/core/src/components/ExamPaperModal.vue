<template>
  <Teleport to=".ai-study-app">
  <div class="modal-mask" :class="{ open }" @click.self="$emit('close')">
    <div class="modal modal--lg">
      <h2>历年真题</h2>
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <button class="btn ghost sm" @click="showCreate = true">+ 新建试卷</button>
        <button class="btn ghost" @click="$emit('close')">关闭</button>
      </div>
      <div v-if="showCreate" class="qimp-paper-create">
        <input v-model="newName" class="input" placeholder="试卷名称，如：2024考研政治真题" />
        <input v-model.number="newYear" class="input" type="number" placeholder="年份" style="width:100px" />
        <button class="btn ghost sm" :disabled="creating" @click="doCreate">{{ creating ? "创建中…" : "创建" }}</button>
        <button class="btn ghost sm" @click="showCreate = false">取消</button>
      </div>
      <div v-if="papers.length === 0" class="empty-state" style="padding:20px 0">
        暂无试卷，导入真题时会自动创建
      </div>
      <div v-else class="paper-list">
        <div v-for="p in papers" :key="p.id" class="paper-item">
          <div class="paper-info">
            <div class="paper-name">{{ p.name }}</div>
            <div class="paper-meta">{{ p.year }}年 · {{ p.questionCount }}题</div>
          </div>
          <div class="paper-actions">
            <button class="btn ghost sm" @click="startPractice(p)">刷题</button>
            <button class="btn ghost sm danger" @click="doDelete(p)">删除</button>
          </div>
        </div>
      </div>
    </div>
  </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { getExamPapers, createExamPaper, deleteExamPaper, getPaperQuestions } from "../api";
import type { ExamPaperWithQuestions, Question } from "../api";
import { useConfirm } from "../composables/useConfirm";

const props = defineProps<{
  open: boolean;
  courseId: number;
  onQuizStart: (questions: Question[]) => void;
}>();
const { confirm } = useConfirm();
const emit = defineEmits<{
  close: [];
}>();

const papers = ref<ExamPaperWithQuestions[]>([]);
const showCreate = ref(false);
const newName = ref("");
const newYear = ref<number | undefined>(undefined);
const creating = ref(false);
const deleting = ref(false);
const practicing = ref(false);

watch(
  () => props.open,
  async (v) => {
    if (!v) return;
    try {
      papers.value = await getExamPapers(props.courseId);
    } catch (e) {
      window.siyuanAiStudy.showMessage(e instanceof Error ? e.message : "加载试卷列表失败", 4000, "error");
      return;
    }
    showCreate.value = false;
    newName.value = "";
    newYear.value = undefined;
  },
);

async function doCreate() {
  if (!newName.value.trim() || creating.value) return;
  creating.value = true;
  try {
    await createExamPaper(props.courseId, newName.value.trim(), newYear.value ?? 2024);
    papers.value = await getExamPapers(props.courseId);
    showCreate.value = false;
  } catch (e) {
    window.siyuanAiStudy.showMessage(e instanceof Error ? e.message : "创建试卷失败", 4000, "error");
  } finally {
    creating.value = false;
  }
}

async function doDelete(p: ExamPaperWithQuestions) {
  if (deleting.value) return;
  if (!(await confirm({ message: `确定删除「${p.name}」？关联的 ${p.questionCount} 道题目将一并删除。`, danger: true, confirmText: "删除" }))) return;
  deleting.value = true;
  try {
    await deleteExamPaper(p.id);
    papers.value = await getExamPapers(props.courseId);
  } catch (e) {
    window.siyuanAiStudy.showMessage(e instanceof Error ? e.message : "删除试卷失败", 4000, "error");
  } finally {
    deleting.value = false;
  }
}

async function startPractice(p: ExamPaperWithQuestions) {
  if (practicing.value) return;
  practicing.value = true;
  try {
    const questions = await getPaperQuestions(p.id);
    if (questions.length === 0) {
      window.siyuanAiStudy.showMessage("该试卷暂无题目", 3000, "error");
      return;
    }
    emit("close");
    props.onQuizStart(questions);
  } catch (e) {
    window.siyuanAiStudy.showMessage(e instanceof Error ? e.message : "加载试卷题目失败", 4000, "error");
  } finally {
    practicing.value = false;
  }
}
</script>
