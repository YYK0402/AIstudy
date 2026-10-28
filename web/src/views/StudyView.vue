<template>
  <div class="page">
    <div class="page-title"><h1>开始学习</h1><div class="desc">冯诺依曼输出式学习 · 讲解 → 评估 → 补强</div></div>

    <div v-if="!currentCourseId()" class="card">
      <div class="empty-state"><span class="ico"><AppIcon name="folder" :size="28" /></span> 请先在「课程主页」选择或创建一个课程</div>
    </div>

    <div v-else-if="loading && knowledgePoints.length === 0" class="card">
      <SkeletonList :rows="4" />
    </div>

    <LoadError
      v-else-if="error && knowledgePoints.length === 0"
      :message="error"
      @retry="load"
    />

    <div v-else-if="knowledgePoints.length === 0" class="card">
      <div class="empty-state">
        <span class="ico"><AppIcon name="spark" :size="28" /></span>
        暂无待学习的知识点<br />请先在「课程内容」中上传资料并生成知识点
      </div>
      <div style="display:flex;justify-content:center;margin-top:16px">
        <router-link to="/content" class="btn primary">前往课程内容</router-link>
      </div>
    </div>

    <template v-else>
      <div v-if="todayTasks.length && !fromKpLink" class="card">
        <h3>今日计划
          <span style="margin-left:auto;font-size:11px;color:var(--as-text-faint)">{{ todayDoneCount }}/{{ todayTasks.length }}</span>
        </h3>
        <div v-if="todayDoneCount === todayTasks.length" class="empty-state" style="padding:12px 0">
          <span class="ico"><AppIcon name="check" :size="28" /></span> 今日计划已完成
        </div>
        <div v-else class="today-plan-list">
          <StudyTaskRow
            v-for="t in todayTasks"
            :key="t.id"
            :title="t.title"
            :task-type="t.taskType"
            :done="t.status === 'done'"
            :checkable="false"
            :action="studyAction(t)"
            dense
            @click="onTodayPlanItem(t)"
          />
        </div>
      </div>

      <div v-if="pastSessions.length" class="card" style="margin-top:14px">
        <h3>过往学习会话<span style="margin-left:auto;font-size:11px;color:var(--as-text-faint)">全部讲解过的知识点 · 点击查看对话过程</span></h3>
        <div class="ps-list">
          <div
            v-for="s in pastSessions"
            :key="s.kpId"
            class="ps-item"
            :class="{ on: s.kpId === selectedKpId }"
            @click="openPastSession(s.kpId)"
          >
            <span class="ps-name">{{ s.kpName }}</span>
            <span class="ps-meta">{{ s.rounds }} 轮 · 最近 {{ s.lastScore }} 分</span>
            <span class="ps-time">{{ formatTime(s.lastTime) }}</span>
          </div>
        </div>
      </div>

      <div v-if="fromKpLink" class="s" style="margin:14px 0 0;color:var(--as-text-faint)">
        已定位到今日任务对应知识点 ·
        <button class="link-btn" @click="fromKpLink = false">查看今日计划</button>
      </div>
      <div ref="studySectionRef" class="study-section" style="margin-top:14px">
        <h3>
          本轮学习
          <span v-if="queue.length" class="s" style="color:var(--as-text-faint)">{{ queueIndex + 1 }}/{{ queue.length }}</span>
          <span style="margin-left:auto;display:flex;gap:6px">
            <button class="btn sm ghost" :disabled="queueIndex === 0" @click="prevKp">← 上一个</button>
            <button class="btn sm ghost" :disabled="queueIndex >= queue.length - 1" @click="nextKp">下一个 →</button>
            <button class="btn sm" @click="kpSelectOpen = true">选择知识点</button>
          </span>
        </h3>
        <div v-if="queue.length > 1" class="session-strip">
          <button
            v-for="(qid, i) in queue"
            :key="qid"
            class="ss-chip"
            :class="{ on: i === queueIndex, done: doneKpIds.has(qid) && i !== queueIndex }"
            :title="kpNameOf(qid)"
            @click="goTo(i)"
          >{{ kpNameOf(qid) }}</button>
        </div>

        <div class="study-layout">
          <div class="card read-panel">
            <template v-if="selectedKp">
              <div class="kp-title">{{ selectedKp.name }}</div>
              <div class="kp-meta">
                <span class="tag" :class="selectedKp.mastery"><span class="d"></span>{{ masteryLabel(selectedKp.mastery) }}</span>
                <span v-if="kpPath(selectedKp)" class="kp-path">{{ kpPath(selectedKp) }}</span>
              </div>
              <div v-if="selectedKp.content" class="kp-body"><p>{{ selectedKp.content }}</p></div>
              <div v-else class="s" style="color:var(--as-text-faint)">该知识点暂无参考描述</div>
              <div class="src">
                <AppIcon name="book" :size="13" /> 资料来源：{{ sourceNames(selectedKp) || "（未关联资料）" }}
                <button
                  v-if="selectedKp.blockId"
                  class="btn sm ghost"
                  style="margin-left:10px"
                  :disabled="openingOriginal"
                  @click="openOriginal"
                >{{ openingOriginal ? "打开中…" : "查看原文" }}</button>
              </div>
            </template>
            <div v-else class="empty-state" style="padding:40px 0">
              <span class="ico"><AppIcon name="book" :size="28" /></span>
              未选择知识点<br />
              <span class="s" style="color:var(--as-text-faint)">点击「选择知识点」按 章-节-知识点 自选（可多选、可选整节），或点击上方今日计划任务开始</span>
            </div>
          </div>

          <div class="card chat-panel">
            <div class="chat-head">
              <div class="ai-avatar">AI</div>
              <div class="chat-title">冯诺依曼输出练习</div>
              <span v-if="selectedKp" class="tag known" style="margin-left:auto"><span class="d"></span>第 {{ currentRoundNo }} 轮</span>
            </div>
            <div class="chat-body">
              <template v-if="selectedKp">
                <div v-for="(r, i) in [...historyShown].reverse()" :key="'h' + r.id" class="round-block">
                  <div class="round-sep"><span>第 {{ i + 1 }} 轮 · {{ formatTime(r.createTime) }}</span></div>
                  <div class="msg ai"><div class="who">AI 提问</div>{{ r.askPrompt || aiPrompt(selectedKp.name) }}</div>
                  <div class="msg me"><div class="who">我的讲解</div>{{ r.userContent }}</div>
                  <div class="msg ai">
                    <div class="who">AI 评估</div>
                    <span class="score" :class="Number(r.aiScore) >= 60 ? 'pass' : 'fail'">{{ r.aiScore }} 分</span>
                    <div class="fb">{{ r.aiFeedback || "（无点评）" }}</div>
                  </div>
                </div>
                <div class="round-block cur">
                  <div class="round-sep"><span>当前轮 · 第 {{ currentRoundNo }} 轮</span></div>
                  <div class="msg ai">
                    <div class="who">
                      AI 提问
                      <button
                        class="ask-reroll"
                        :disabled="askLoadingKpId != null"
                        @click="rerollAsk"
                      >{{ askLoadingKpId === selectedKp.id ? "生成中…" : "换个问法" }}</button>
                    </div>
                    <div v-if="askLoadingKpId === selectedKp.id" class="ask-loading">🤔 正在结合这个知识点的内容为你生成提问…</div>
                    <template v-else>{{ currentAskDisplay }}</template>
                  </div>
                  <div v-if="currentRoundExplain || lastResult" class="msg me"><div class="who">我的讲解</div>{{ currentRoundExplain }}</div>
                  <div v-if="evaluating" class="msg ai typing"><span class="dots"><i></i><i></i><i></i></span>AI 正在评卷，评估你的讲解…</div>
                  <div v-if="lastResult" class="msg ai">
                    <div class="who">AI 评估</div>
                    <span class="score" :class="lastResult.score >= 60 ? 'pass' : 'fail'">{{ lastResult.score }} 分</span>
                    <div class="fb">{{ lastResult.feedback || "AI 未给出具体点评" }}</div>
                    <div v-if="lastResult.masteryNotes.length" class="mastery-note up">↑ 掌握度提升：{{ lastResult.masteryNotes.join(" · ") }}</div>
                    <div v-if="lastResult.planNotes.length" class="plan-note">✓ 计划任务已自动勾选：{{ lastResult.planNotes.join("、") }}</div>
                    <div v-if="lastResult.score >= EXPLAIN_PASS_SCORE" class="msg-acts">
                      <router-link class="btn primary sm" :to="{ path: '/quiz', query: { kp: String(selectedKp.id) } }">去自测本知识点 →</router-link>
                      <button v-if="hasNext" class="btn sm" @click="nextKp">下一个知识点 →</button>
                    </div>
                  </div>
                </div>
              </template>
              <div v-else class="s" style="color:var(--as-text-faint);padding:16px 0">选择知识点后，这里开始输出式练习</div>
            </div>
            <div class="chat-input">
              <textarea
                v-model="explanation"
                :disabled="evaluating || !selectedKp"
                placeholder="用你自己的话讲解这个知识点：它是什么？怎么理解？举例说明…（Enter 发送，Shift+Enter 换行）"
                @keydown="onExplainKeydown"
              ></textarea>
              <button class="btn primary chat-submit" :disabled="!explanation.trim() || evaluating || !selectedKp" @click="submit">
                {{ evaluating ? "AI 评估中…" : "提交" }}
              </button>
            </div>
            <div v-if="explainError" class="s" style="color:var(--as-red);padding:8px 16px 12px">✗ {{ explainError }}</div>
          </div>
        </div>
      </div>
    </template>

    <KpSelectModal
      :open="kpSelectOpen"
      :chapters="chapters"
      :kps="knowledgePoints"
      @close="kpSelectOpen = false"
      @confirm="onKpConfirm"
    />
  </div>
</template>

<script setup lang="ts">
import AppIcon from "../components/AppIcon.vue";
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useCourseStore } from "../stores/course";
import {
  queryKnowledgePoints,
  queryChapters,
  queryMaterials,
  submitExplain,
  queryExplainRecords,
  queryExplainSummaries,
  queryTodayPlanTasks,
  syncExplainConversations,
  EXPLAIN_PASS_SCORE,
  openSiyuanDoc,
  generateKpAskPrompt,
  isAskPromptFresh,
} from "../api";
import StudyTaskRow from "../components/StudyTaskRow.vue";
import { taskAction } from "../constants/tasks";
import { capStudySec } from "../constants/study";
import type { KnowledgePoint, ExplainRecord, ExplainSummary, Mastery, ExplainResult, StudyTask, Chapter, Material } from "../api";
import KpSelectModal from "../components/KpSelectModal.vue";
import SkeletonList from "../components/SkeletonList.vue";
import LoadError from "../components/LoadError.vue";
import { useLoad } from "../composables/useLoad";

const courseStore = useCourseStore();
const currentCourseId = () => courseStore.currentCourseId;
const route = useRoute();
const router = useRouter();

const knowledgePoints = ref<KnowledgePoint[]>([]);
const chapters = ref<Chapter[]>([]);
const materials = ref<Material[]>([]);
const todayTasks = ref<StudyTask[]>([]);
const pastSessions = ref<ExplainSummary[]>([]);
const todayDoneCount = computed(() => todayTasks.value.filter((t) => t.status === "done").length);
const doneKpIds = computed(() => {
  const s = new Set<number>();
  for (const t of todayTasks.value) {
    if (t.status === "done" && t.kpId != null) s.add(t.kpId);
  }
  return s;
});
/** 学习页内「新知」由行点击打开，其余类型走各自页面 */
function studyAction(t: StudyTask) {
  return t.taskType === "learn" ? null : taskAction(t);
}

// ===== 会话队列：默认由今日计划驱动，也可弹窗自选（教材序） =====
const queue = ref<number[]>([]);
const queueIndex = ref(0);
const kpSelectOpen = ref(false);

const selectedKpId = computed<number | null>(() => queue.value[queueIndex.value] ?? null);
/** 从 ?kp= 深链进入：隐藏今日计划并滚到本轮学习，避免目标知识点被列表挤到首屏之外 */
const fromKpLink = ref(false);
const studySectionRef = ref<HTMLElement | null>(null);
const selectedKp = computed<KnowledgePoint | null>(() =>
  selectedKpId.value !== null
    ? knowledgePoints.value.find((k) => k.id === selectedKpId.value) ?? null
    : null,
);
const hasNext = computed(() => queueIndex.value < queue.value.length - 1);

function kpNameOf(id: number): string {
  return knowledgePoints.value.find((k) => k.id === id)?.name ?? `#${id}`;
}

/** 今日计划中未完成的新知任务对应 KP（保序去重）；复习/练习各有专属去处（/review?kp、/quiz?kp） */
function buildTodayQueue(): number[] {
  const ids: number[] = [];
  for (const t of todayTasks.value) {
    if (t.status !== "done" && t.kpId != null && t.taskType === "learn" && !ids.includes(t.kpId)) {
      ids.push(t.kpId);
    }
  }
  return ids;
}

function goTo(i: number) {
  if (i < 0 || i >= queue.value.length || i === queueIndex.value) return;
  queueIndex.value = i;
}
function nextKp() {
  goTo(queueIndex.value + 1);
}
function prevKp() {
  goTo(queueIndex.value - 1);
}

function onTodayPlanItem(t: StudyTask) {
  if (t.status === "done" || t.kpId == null || t.taskType !== "learn") return;
  const ids = buildTodayQueue();
  const idx = ids.indexOf(t.kpId);
  if (idx < 0) return;
  queue.value = ids;
  queueIndex.value = idx;
}

function onKpConfirm(ids: number[]) {
  if (ids.length === 0) return;
  queue.value = ids;
  queueIndex.value = 0;
  kpSelectOpen.value = false;
}

/** 过往学习会话卡片 → 单 KP 队列打开完整对话 */
function openPastSession(kpId: number) {
  if (kpId === selectedKpId.value) return;
  queue.value = [kpId];
  queueIndex.value = 0;
}

/** ?kp= 深链 → 单 KP 队列 */
function enterKpStudy() {
  const raw = route.query.kp;
  if (raw == null || raw === "") return;
  const kpId = Number(Array.isArray(raw) ? raw[0] : raw);
  const clearQuery = () => router.replace({ path: "/study" });
  if (!Number.isFinite(kpId) || kpId <= 0 || !knowledgePoints.value.some((k) => k.id === kpId)) {
    clearQuery();
    return;
  }
  queue.value = [kpId];
  queueIndex.value = 0;
  fromKpLink.value = true;
  clearQuery();
  void nextTick(() => {
    studySectionRef.value?.scrollIntoView({ block: "start", behavior: "smooth" });
  });
}

// ===== 选中 KP 的派生展示 =====
const explanation = ref("");
const evaluating = ref(false);
const explainError = ref("");
const lastResult = ref<ExplainResult | null>(null);
const history = ref<ExplainRecord[]>([]);
const openingOriginal = ref(false);
const kpStartAt = ref(0);
/** 本轮提交时实际使用的提问（提交后锁定，避免再点「换个问法」导致已提交轮次文本漂移） */
const currentRoundAsk = ref("");
/** 本轮提交时实际提交的讲解快照（提交后当前轮块展示已完成轮的内容） */
const currentRoundExplain = ref("");

/** 当前轮轮次号：已提交 → 刚完成的那一轮（history 最新条）；未提交 → 下一轮 */
const currentRoundNo = computed(() => (lastResult.value ? history.value.length : history.value.length + 1));
/** 历史轮展示：刚完成的一轮已由当前轮块呈现，剔除最新条避免重复（history 为降序，最新在前） */
const historyShown = computed(() => (lastResult.value ? history.value.slice(1) : history.value));

/** 当前轮提问展示：已提交 → 锁定快照；未提交 → 跟随 KP 缓存（可被重掷刷新） */
const currentAskDisplay = computed(() => {
  const kp = selectedKp.value;
  if (!kp) return "";
  if (lastResult.value) return currentRoundAsk.value || aiPrompt(kp.name);
  return kp.askPrompt || aiPrompt(kp.name);
});

// ===== 费曼提问：AI 按 KP 内容生成（缓存于 KP，懒生成，同刻只跑一次） =====
const askLoadingKpId = ref<number | null>(null);

async function refreshAskPrompt(kpId: number, force = false) {
  const kp = knowledgePoints.value.find((k) => k.id === kpId);
  if (!kp || askLoadingKpId.value != null) return;
  askLoadingKpId.value = kpId;
  try {
    const prompt = await generateKpAskPrompt(kp, force);
    const target = knowledgePoints.value.find((k) => k.id === kpId);
    if (target) {
      target.askPrompt = prompt;
      target.askPromptContent = `${target.name}|${target.content}`;
    }
  } catch (e) {
    // 静默回退固定提问，可用「换个问法」手动重试
    console.error("生成提问失败:", e);
  } finally {
    if (askLoadingKpId.value === kpId) askLoadingKpId.value = null;
  }
}

function rerollAsk() {
  const kp = selectedKp.value;
  if (!kp) return;
  void refreshAskPrompt(kp.id, true);
}

const masteryLabel = (m: Mastery): string => {
  const map: Record<Mastery, string> = { unlearn: "未学习", known: "了解", mastered: "掌握", proficient: "精通" };
  return map[m];
};

function formatTime(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** 章 · 节 路径（KP 现挂到节，回退章） */
function kpPath(kp: KnowledgePoint): string {
  if (kp.chapterId == null) return "";
  const node = chapters.value.find((c) => c.id === kp.chapterId);
  if (!node) return kp.chapterName || "";
  if (node.level === "chapter" || node.parentId == null) return node.name;
  const parent = chapters.value.find((c) => c.id === node.parentId);
  return parent ? `${parent.name} · ${node.name}` : node.name;
}

function sourceNames(kp: KnowledgePoint): string {
  const ids = kp.sourceAssetIds.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
  return ids.map((id) => materials.value.find((m) => m.id === id)?.name).filter((n): n is string => Boolean(n)).join("、");
}

/** 固定兜底提问（AI 生成提问不可用/生成中失败时展示） */
function aiPrompt(name: string): string {
  return `请你用自己的话讲讲「${name}」：它是什么？怎么理解？如果能举个例子或说明它用在什么场景，也一并说说。`;
}

async function openOriginal() {
  const id = selectedKp.value?.blockId;
  if (!id || openingOriginal.value) return;
  openingOriginal.value = true;
  try {
    await openSiyuanDoc(id);
  } catch (e) {
    console.error("打开原文失败:", e);
    window.siyuanAiStudy.showMessage(e instanceof Error ? e.message : "打开原文失败", 4000, "error");
  } finally {
    openingOriginal.value = false;
  }
}

// 切换 KP（队列内移动）时重置本轮会话状态并加载历史
watch(selectedKpId, async (id) => {
  explanation.value = "";
  lastResult.value = null;
  explainError.value = "";
  currentRoundAsk.value = "";
  currentRoundExplain.value = "";
  kpStartAt.value = Date.now();
  history.value = [];
  if (id == null) return;
  try {
    history.value = await queryExplainRecords(id);
  } catch (e) {
    console.error("加载讲解历史失败:", e);
    history.value = [];
  }
  // 无有效缓存（未生成过/内容已变化）→ 后台懒生成提问
  const kp = knowledgePoints.value.find((k) => k.id === id);
  if (kp && !isAskPromptFresh(kp)) void refreshAskPrompt(id);
});

const { loading, error, load } = useLoad(async (ctx) => {
  if (!ctx.courseId) {
    knowledgePoints.value = [];
    chapters.value = [];
    materials.value = [];
    todayTasks.value = [];
    pastSessions.value = [];
    queue.value = [];
    queueIndex.value = 0;
    return;
  }
  const [kps, chs, ms, tasks, past] = await Promise.all([
    queryKnowledgePoints(ctx.courseId),
    queryChapters(ctx.courseId),
    queryMaterials(ctx.courseId),
    queryTodayPlanTasks(ctx.courseId),
    queryExplainSummaries(ctx.courseId),
  ]);
  if (ctx.isStale()) return;
  knowledgePoints.value = kps;
  chapters.value = chs;
  materials.value = ms;
  todayTasks.value = tasks;
  pastSessions.value = past;
  // 队列失效（KP 被删）或首次进入 → 回到今日计划队列
  const valid = queue.value.filter((id) => kps.some((k) => k.id === id));
  if (valid.length === 0) {
    queue.value = buildTodayQueue();
    queueIndex.value = 0;
  } else {
    queue.value = valid;
    if (queueIndex.value >= queue.value.length) queueIndex.value = 0;
  }
});

/** 讲解输入框键盘：Enter 发送（中文输入法组合态除外），Shift+Enter 换行 */
function onExplainKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    void submit();
  }
}

async function submit() {
  const kp = selectedKp.value;
  const content = explanation.value.trim();
  if (!kp || !content || evaluating.value) return;
  evaluating.value = true;
  explainError.value = "";
  const durationSec = kpStartAt.value ? capStudySec((Date.now() - kpStartAt.value) / 1000) : 0;
  try {
    lastResult.value = await submitExplain(kp, content, durationSec);
    // 锁定本轮实际提问/讲解快照 + 清空输入框（失败时保留输入，由 catch 处理）
    currentRoundAsk.value = kp.askPrompt || "";
    currentRoundExplain.value = content;
    explanation.value = "";
    // 讲解对话落库对应章/节文档（fire-and-forget，持久化开启时生效）
    void syncExplainConversations(kp.courseId, kp.id);
    // 掌握度可能已自动变化、今日任务可能已自动勾选，重载数据即时刷新（队列保留）
    await load();
    history.value = await queryExplainRecords(kp.id);
  } catch (e) {
    explainError.value = e instanceof Error ? e.message : String(e);
  } finally {
    evaluating.value = false;
  }
}

watch(
  () => courseStore.currentCourseId,
  () => {
    queue.value = [];
    queueIndex.value = 0;
    explanation.value = "";
    lastResult.value = null;
    explainError.value = "";
    currentRoundAsk.value = "";
    history.value = [];
    kpStartAt.value = 0;
    void load();
  },
);

watch(
  () => route.query.kp,
  async (v) => {
    if (v == null || v === "") return;
    await load();
    // 深链处理必须在数据加载成功后执行，否则 KP 列表为空会误清 query
    if (error.value === "") enterKpStudy();
  },
);

onMounted(async () => {
  await load();
  if (error.value === "") enterKpStudy();
});
</script>
