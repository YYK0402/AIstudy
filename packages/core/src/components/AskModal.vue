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
            <div v-if="t.role === 'assistant'" class="txt md-body" v-html="renderMarkdown(t.content)"></div>
            <div v-else class="txt">{{ t.content }}</div>
          </div>
          <div v-if="loading" class="ask-msg assistant">
            <div class="who">AI</div>
            <div class="txt">思考中…</div>
          </div>
        </div>
      </div>

      <div
        class="ask-resize"
        aria-label="拖动调整窗口宽度"
        @pointerdown="onResizeStart"
        @pointermove="onResizeMove"
        @pointerup="onResizeEnd"
        @pointercancel="onResizeEnd"
      ></div>

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
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import AppIcon from "./AppIcon.vue";
import { queryQuestionAsk, sendQuizAsk } from "../api";
import type { Question, AskTurn } from "../api";
import { clampDragOffset } from "../utils/modalDrag";
import { renderMarkdown } from "../utils/markdown";

const props = defineProps<{
  open: boolean;
  question: Question | null;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "asked", qId: number): void;
}>();

const POS_KEY = "ai-study.ask-pos";
const SIZE_KEY = "ai-study.ask-size";
const DEFAULT_W = 380;
const MIN_W = 280;

function loadSize(): number {
  try {
    const raw = localStorage.getItem(SIZE_KEY);
    if (!raw) return DEFAULT_W;
    const p = JSON.parse(raw) as { w?: number };
    return Number(p.w) || DEFAULT_W;
  } catch {
    return DEFAULT_W;
  }
}

const turns = ref<AskTurn[]>([]);
const loading = ref(false);
const askError = ref("");
const input = ref("");
const askWidth = ref(loadSize());

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
  width: `${askWidth.value}px`,
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
    // 受助口径：该题本轮用过 AI 问答，后续作答按「受助」计
    emit("asked", q.id);
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
// 基准位（偏移为零时窗口左上角）由 CSS right/bottom 定位决定。
// 只在「打开 / 按下 / 宽度变化完成渲染后」测量一次：拖动过程中 Vue 样式更新是异步的，
// 每帧从 rect 反推基准位会因样式滞后产生漂移，窗口会越拖越出界。
const origin = ref({ x: 0, y: 0 });

function measureOrigin() {
  const el = winRef.value;
  const root = el?.parentElement;
  if (!el || !root) return;
  const wr = el.getBoundingClientRect();
  const rr = root.getBoundingClientRect();
  origin.value = { x: wr.left - rr.left - dragPos.value.dx, y: wr.top - rr.top - dragPos.value.dy };
}

function clampPos() {
  const el = winRef.value;
  const root = el?.parentElement;
  if (!el || !root) return;
  dragPos.value = clampDragOffset(
    dragPos.value.dx,
    dragPos.value.dy,
    { w: el.offsetWidth, h: el.offsetHeight },
    { w: root.clientWidth, h: root.clientHeight },
    origin.value,
  );
}
watch(
  () => props.open,
  (v) => {
    if (v)
      requestAnimationFrame(() => {
        measureOrigin();
        clampPos();
      });
  },
);

function onDragStart(e: PointerEvent) {
  if (e.button !== 0) return;
  if ((e.target as HTMLElement).closest("button")) return;
  measureOrigin();
  dragStart = { x: e.clientX, y: e.clientY, dx: dragPos.value.dx, dy: dragPos.value.dy };
  headerRef.value?.setPointerCapture(e.pointerId);
}

function onDragMove(e: PointerEvent) {
  if (!dragStart || !winRef.value) return;
  dragPos.value = clampDragOffset(
    dragStart.dx + (e.clientX - dragStart.x),
    dragStart.dy + (e.clientY - dragStart.y),
    { w: winRef.value.offsetWidth, h: winRef.value.offsetHeight },
    { w: winRef.value.parentElement?.clientWidth ?? 0, h: winRef.value.parentElement?.clientHeight ?? 0 },
    origin.value,
  );
}

function onDragEnd() {
  if (dragStart) savePos();
  dragStart = null;
}

// ===== 右缘手柄：拖动调整宽度（记 localStorage；宽度变化后基准位随之移动，重新钳制位置） =====
let resizeStart: { x: number; w: number } | null = null;

function saveSize() {
  try {
    localStorage.setItem(SIZE_KEY, JSON.stringify({ w: askWidth.value }));
  } catch {
    /* 存储不可用时忽略 */
  }
}

function onResizeStart(e: PointerEvent) {
  if (e.button !== 0) return;
  const el = winRef.value;
  if (!el) return;
  measureOrigin();
  resizeStart = { x: e.clientX, w: el.getBoundingClientRect().width };
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}

async function onResizeMove(e: PointerEvent) {
  if (!resizeStart || !winRef.value) return;
  const root = winRef.value.parentElement;
  if (!root) return;
  const max = root.clientWidth - 40;
  const min = Math.min(MIN_W, max);
  askWidth.value = Math.round(Math.min(max, Math.max(min, resizeStart.w + (e.clientX - resizeStart.x))));
  // 等宽度样式应用后再测基准位（右锚定位：加宽时基准左移），然后重新钳制位置
  await nextTick();
  measureOrigin();
  clampPos();
}

function onResizeEnd() {
  if (!resizeStart) return;
  resizeStart = null;
  saveSize();
}
</script>
