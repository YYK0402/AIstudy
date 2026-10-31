<template>
  <Teleport to=".ai-study-app">
    <!-- 无遮罩悬浮窗：与页面共存，不抢焦点，标题栏可拖，Esc 关闭 -->
    <div v-if="open" ref="winRef" class="ask-float" :style="winStyle">
      <!-- 标题栏即拖动把手 -->
      <div
        ref="headerRef"
        class="ask-header"
        @pointerdown="onDragStart"
        @pointermove="onDragMove"
        @pointerup="onDragEnd"
        @pointercancel="onDragEnd"
      >
        <span class="ask-drag-ico" aria-hidden="true">⋮⋮</span>
        <div class="ask-head-main">
          <div class="ask-title">AI 问答</div>
          <div v-if="question" class="ask-sub">{{ questionTitle }}</div>
        </div>
        <button class="ask-close" aria-label="关闭" @click.stop="close">
          <AppIcon name="x" :size="14" />
        </button>
      </div>

      <!-- 对话区 -->
      <div ref="chatRef" class="ask-chat">
        <div v-if="turns.length === 0 && !loading" class="s t-faint ask-empty">
          围绕题干、答案或关联知识点问点什么吧。
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
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import AppIcon from "./AppIcon.vue";
import { queryQuestionAsk, sendQuizAsk } from "../api";
import type { Question, AskTurn } from "../api";
import { clampDragOffset } from "../utils/modalDrag";

const props = defineProps<{
  open: boolean;
  question: Question | null;
}>();

const emit = defineEmits<{
  (e: "close"): void;
}>();

const POS_KEY = "ai-study.ask-pos";

const turns = ref<AskTurn[]>([]);
const loading = ref(false);
const askError = ref("");
const input = ref("");

const chatRef = ref<HTMLElement | null>(null);
const winRef = ref<HTMLElement | null>(null);
const headerRef = ref<HTMLElement | null>(null);
let dragStart: { x: number; y: number; dx: number; dy: number } | null = null;

function loadPos(): { dx: number; dy: number } {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return { dx: 0, dy: 0 };
    const p = JSON.parse(raw) as { dx?: number; dy?: number };
    return { dx: Number(p.dx) || 0, dy: Number(p.dy) || 0 };
  } catch {
    return { dx: 0, dy: 0 };
  }
}

const dragPos = ref(loadPos());

function savePos() {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify(dragPos.value));
  } catch {
    /* 存储不可用时忽略 */
  }
}

const questionTitle = computed(() => {
  const t = props.question?.title ?? "";
  const oneLine = t.replace(/\s+/g, " ").trim();
  return oneLine.length > 40 ? oneLine.slice(0, 40) + "…" : oneLine;
});
const winStyle = computed(() => ({
  transform: `translate(${dragPos.value.dx}px, ${dragPos.value.dy}px)`,
}));

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

// ===== Esc 关闭（悬浮窗不抢焦点，用捕获阶段监听，关闭时移除） =====
function onEsc(e: KeyboardEvent) {
  if (e.key === "Escape") close();
}
watch(
  () => props.open,
  (v) => {
    if (v) window.addEventListener("keydown", onEsc, true);
    else window.removeEventListener("keydown", onEsc, true);
  },
  { immediate: true },
);
onBeforeUnmount(() => window.removeEventListener("keydown", onEsc, true));

// ===== 标题栏拖动（位置记 localStorage，重开保持；打开时按当前容器夹回可视区） =====
function clampToContainer() {
  const el = winRef.value;
  if (!el) return;
  const root = el.parentElement;
  if (!root) return;
  const wr = el.getBoundingClientRect();
  const rr = root.getBoundingClientRect();
  dragPos.value = clampDragOffset(
    dragPos.value.dx,
    dragPos.value.dy,
    { w: wr.width, h: wr.height },
    { w: rr.width, h: rr.height },
  );
}
watch(
  () => props.open,
  (v) => {
    if (v) requestAnimationFrame(clampToContainer);
  },
);

function onDragStart(e: PointerEvent) {
  if (e.button !== 0) return;
  if ((e.target as HTMLElement).closest("button")) return;
  dragStart = { x: e.clientX, y: e.clientY, dx: dragPos.value.dx, dy: dragPos.value.dy };
  headerRef.value?.setPointerCapture(e.pointerId);
}

function onDragMove(e: PointerEvent) {
  if (!dragStart || !winRef.value) return;
  const root = winRef.value.parentElement;
  if (!root) return;
  const wr = winRef.value.getBoundingClientRect();
  const rr = root.getBoundingClientRect();
  dragPos.value = clampDragOffset(
    dragStart.dx + (e.clientX - dragStart.x),
    dragStart.dy + (e.clientY - dragStart.y),
    { w: wr.width, h: wr.height },
    { w: rr.width, h: rr.height },
  );
}

function onDragEnd() {
  if (dragStart) savePos();
  dragStart = null;
}
</script>
