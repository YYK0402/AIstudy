<template>
  <Teleport to=".ai-study-app">
    <div class="modal-mask" :class="{ open }" @click.self="close">
      <div ref="modalRef" class="modal ask-modal" :style="dragStyle">
        <!-- 标题栏即拖动把手 -->
        <div ref="headerRef" class="ask-header" @pointerdown="onDragStart" @pointermove="onDragMove" @pointerup="onDragEnd" @pointercancel="onDragEnd">
          <span class="ask-drag-ico" aria-hidden="true">⋮⋮</span>
          <div class="ask-head-main">
            <div class="ask-title">AI 问答</div>
            <div v-if="question" class="ask-sub">{{ questionTitle }}</div>
          </div>
          <button class="ask-close" aria-label="关闭" @click.stop="close">
            <AppIcon name="x" :size="14" />
          </button>
        </div>

        <!-- 本题上下文（可折叠） -->
        <div v-if="question" class="ask-ctx">
          <button class="ask-ctx-toggle" @click="ctxOpen = !ctxOpen">
            本题上下文
            <span class="chev" aria-hidden="true">{{ ctxOpen ? "▾" : "▸" }}</span>
          </button>
          <div v-if="ctxOpen" class="ask-ctx-body">
            <div class="ctx-title">{{ question.title }}</div>
            <div v-if="options.length > 0" class="ctx-opts">
              <div v-for="(o, i) in options" :key="o" class="ctx-opt" :class="{ right: isRightOpt(o) }">
                {{ String.fromCharCode(65 + i) }}. {{ o }}
              </div>
            </div>
            <div v-if="result" class="ctx-line">
              我的作答：{{ result.userAnswer || "（未作答）" }}
              <span :class="result.isCorrect ? 't-success' : 't-danger'">{{ result.isCorrect ? " ✓" : " ✗" }}</span>
            </div>
            <div v-if="result && question.qType === 'essay'" class="ctx-essay">
              <span class="score" :class="{ pass: result.isCorrect, fail: !result.isCorrect }">{{ result.score }} 分</span>
              <span v-if="result.feedback" class="fb">{{ result.feedback }}</span>
            </div>
            <div class="ctx-line">{{ getAnswerLabel() }}：{{ question.answer }}</div>
            <div v-if="question.analysis" class="ctx-line ctx-analysis">{{ question.analysis }}</div>
          </div>
        </div>

        <!-- 对话区 -->
        <div ref="chatRef" class="ask-chat">
          <div v-if="turns.length === 0 && !loading" class="s t-faint ask-empty">
            围绕题干、选项、答案或关联知识点问点什么吧。
          </div>
          <div v-else class="ask-list">
            <div v-for="(t, i) in turns" :key="i" class="ask-msg" :class="t.role">
              <div class="who">{{ t.role === "user" ? "我" : "AI" }}</div>
              <div class="txt">{{ t.content }}</div>
            </div>
            <div v-if="loading" class="ask-msg assistant">
              <div class="who">AI</div>
              <div class="txt">思考中…</div>
            </div>
          </div>
        </div>

        <div v-if="askError" class="s t-danger ask-error">✗ {{ askError }}</div>

        <div class="ask-input-row">
          <input
            v-model="input"
            class="ask-input"
            :disabled="loading || !question"
            placeholder="就这道题/知识点问点什么…"
            aria-label="向 AI 提问"
            @keydown.enter.prevent="send"
          />
          <button class="btn sm primary" :disabled="!input.trim() || loading || !question" @click="send">
            {{ loading ? "回答中…" : "发送" }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import AppIcon from "./AppIcon.vue";
import { queryQuestionAsk, sendQuizAsk, parseQuestionOptions } from "../api";
import type { Question, AskTurn } from "../api";
import { clampDragOffset } from "../utils/modalDrag";

interface AskResult {
  userAnswer: string;
  isCorrect: boolean;
  score: string;
  feedback: string;
}

const props = defineProps<{
  open: boolean;
  question: Question | null;
  /** 当前题的判分结果（回看模式传入；未作答为 null） */
  result: AskResult | null;
}>();

const emit = defineEmits<{
  (e: "close"): void;
}>();

const turns = ref<AskTurn[]>([]);
const loading = ref(false);
const askError = ref("");
const input = ref("");
const ctxOpen = ref(true);

const chatRef = ref<HTMLElement | null>(null);
const modalRef = ref<HTMLElement | null>(null);
const headerRef = ref<HTMLElement | null>(null);
const dragPos = ref({ dx: 0, dy: 0 });
let dragStart: { x: number; y: number; dx: number; dy: number } | null = null;

const options = computed(() => (props.question ? parseQuestionOptions(props.question) : []));
const questionTitle = computed(() => {
  const t = props.question?.title ?? "";
  const oneLine = t.replace(/\s+/g, " ").trim();
  return oneLine.length > 40 ? oneLine.slice(0, 40) + "…" : oneLine;
});
const dragStyle = computed(() => ({
  transform: `translate(${dragPos.value.dx}px, ${dragPos.value.dy}px)`,
}));

function isRightOpt(opt: string): boolean {
  const q = props.question;
  if (!q) return false;
  return q.answer.split(/[,，]/).map((s) => s.trim()).includes(opt);
}

function getAnswerLabel(): string {
  const t = props.question?.qType;
  return t === "essay" ? "参考答案" : "正确答案";
}

/** 打开 / 切换题目时载入该题的既有会话（续聊） */
watch(
  () => [props.open, props.question?.id] as const,
  async ([open, qId]) => {
    askError.value = "";
    input.value = "";
    if (!open || qId == null) {
      turns.value = [];
      return;
    }
    turns.value = [];
    const s = await queryQuestionAsk(qId);
    if (props.question?.id === qId) turns.value = s ? [...s.turns] : [];
    scrollToBottom();
  },
);

function scrollToBottom() {
  requestAnimationFrame(() => {
    const el = chatRef.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
}

async function send() {
  const q = props.question;
  const text = input.value.trim();
  if (!q || !text || loading.value) return;
  loading.value = true;
  askError.value = "";
  // 乐观追加 user 轮（sendQuizAsk 内部落库；失败时本地与存储一致，重问自然续上）
  turns.value.push({ role: "user", content: text, createTime: new Date().toISOString() });
  input.value = "";
  scrollToBottom();
  try {
    const reply = await sendQuizAsk(q.courseId, q.id, text);
    turns.value.push({ role: "assistant", content: reply, createTime: new Date().toISOString() });
  } catch (e) {
    console.error("回看问答失败:", e);
    askError.value = e instanceof Error ? e.message : "问答失败，请重试";
  } finally {
    loading.value = false;
    scrollToBottom();
  }
}

function close() {
  emit("close");
}

// ===== 标题栏拖动（位移存组件内，关闭重开保持位置） =====
function onDragStart(e: PointerEvent) {
  if (e.button !== 0) return;
  if ((e.target as HTMLElement).closest("button")) return;
  dragStart = { x: e.clientX, y: e.clientY, dx: dragPos.value.dx, dy: dragPos.value.dy };
  headerRef.value?.setPointerCapture(e.pointerId);
}

function onDragMove(e: PointerEvent) {
  if (!dragStart || !modalRef.value) return;
  const mask = modalRef.value.parentElement;
  if (!mask) return;
  const mr = modalRef.value.getBoundingClientRect();
  const cr = mask.getBoundingClientRect();
  dragPos.value = clampDragOffset(
    dragStart.dx + (e.clientX - dragStart.x),
    dragStart.dy + (e.clientY - dragStart.y),
    { w: mr.width, h: mr.height },
    { w: cr.width, h: cr.height },
  );
}

function onDragEnd() {
  dragStart = null;
}
</script>
