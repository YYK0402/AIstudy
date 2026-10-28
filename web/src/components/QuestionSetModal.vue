<template>
  <Teleport to=".ai-study-app">
  <div class="modal-mask" :class="{ open }" @click.self="close">
    <div class="modal qset-modal">
      <div class="qset-scroll">
        <h2>组卷刷题</h2>
        <div v-if="preset?.title" class="s" style="margin-bottom:12px">
          <span class="tag single"><span class="d"></span>{{ preset.title }}</span>
        </div>
        <div v-if="questions.length === 0">
          <div class="empty-state" style="padding:20px 0">
            <span class="ico">✏️</span> 题库暂无题目，请先「开始出题」
          </div>
        </div>
        <template v-else>
          <div class="field">
            <label>题型</label>
            <div class="qset-row">
              <button class="chip" :class="{ on: qTypes.length === 0 }" @click="qTypes = []">全部</button>
              <button
                v-for="(label, key) in QUESTION_TYPE_LABELS"
                :key="key"
                class="chip"
                :class="{ on: qTypes.includes(key as QuestionType) }"
                @click="toggleQType(key as QuestionType)"
              >{{ label }}</button>
            </div>
          </div>
          <div class="field">
            <label>难度</label>
            <div class="qset-row">
              <button class="chip" :class="{ on: difficulties.length === 0 }" @click="difficulties = []">全部</button>
              <button
                v-for="(label, key) in QUESTION_DIFFICULTY_LABELS"
                :key="key"
                class="chip"
                :class="{ on: difficulties.includes(key as QuestionDifficulty) }"
                @click="toggleDiff(key as QuestionDifficulty)"
              >{{ label }}</button>
            </div>
          </div>
          <div class="field">
            <label>知识点范围（不勾选 = 整课程）</label>
            <div v-if="knowledgePoints.length === 0" class="qe-empty">暂无知识点</div>
            <KpTreePicker
              v-else
              inline
              :auto-expand="false"
              :chapters="chapters"
              :kps="knowledgePoints"
              v-model="kpIds"
            />
          </div>
          <div class="mode-grid">
            <div class="field" style="margin-bottom:0">
              <label>题目数量</label>
              <div class="qset-row" style="margin-bottom:8px">
                <button v-for="n in [5, 10, 20]" :key="n" class="chip" :class="{ on: !countAll && count === n }" @click="setCount(n)">{{ n }} 题</button>
                <button class="chip" :class="{ on: countAll }" @click="countAll = true">全部</button>
              </div>
              <input
                type="number"
                v-model.number="count"
                :disabled="countAll"
                :min="1"
                :max="Math.max(matched, 50)"
                @input="countAll = false"
              />
            </div>
            <div class="field" style="margin-bottom:0">
              <label>出题顺序</label>
              <div class="qset-row">
                <button class="chip" :class="{ on: random }" @click="random = true">随机</button>
                <button class="chip" :class="{ on: !random }" @click="random = false">顺序</button>
              </div>
            </div>
          </div>
          <div class="s qset-match" :class="{ warn: matched === 0 }">
            <template v-if="matched === 0">当前筛选无匹配题目，请调整条件</template>
            <template v-else>
              当前筛选匹配 <b>{{ matched }}</b> 题
              <template v-if="!countAll && count > matched">（不足所选数量，将全出 {{ matched }} 题）</template>
            </template>
          </div>
        </template>
      </div>
      <div class="modal-actions qset-actions">
        <button class="btn ghost" @click="close">取消</button>
        <button class="btn primary" :disabled="pool.length === 0" @click="confirm">
          开始刷题{{ pool.length > 0 ? `（${pool.length} 题）` : "" }}
        </button>
      </div>
    </div>
  </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  buildQuizList,
  QUESTION_TYPE_LABELS,
  QUESTION_DIFFICULTY_LABELS,
} from "../api";
import type { Chapter, KnowledgePoint, Question, QuestionType, QuestionDifficulty } from "../api";
import KpTreePicker from "./KpTreePicker.vue";

const props = defineProps<{
  open: boolean;
  questions: Question[];
  knowledgePoints: KnowledgePoint[];
  chapters: Chapter[];
  /** 预填入口（T2.16 章节复盘 / T2.17 结业模考）：知识点范围与标题 */
  preset?: { kpIds: number[]; title: string } | null;
}>();

const emit = defineEmits<{ (e: "close"): void; (e: "generated", list: Question[]): void }>();

const qTypes = ref<QuestionType[]>([]);
const difficulties = ref<QuestionDifficulty[]>([]);
const kpIds = ref<number[]>([]);
const count = ref(10);
const countAll = ref(false);
const random = ref(true);

// 打开时重置为默认（整课程），并按预填入口初始化知识点范围
watch(
  () => props.open,
  (v) => {
    if (!v) return;
    qTypes.value = [];
    difficulties.value = [];
    kpIds.value = props.preset ? [...props.preset.kpIds] : [];
    count.value = 10;
    countAll.value = false;
    random.value = true;
  },
);

/** 筛选命中题数（未截数量，用于上限提示） */
const matched = computed(
  () =>
    buildQuizList(props.questions, {
      qTypes: qTypes.value,
      difficulties: difficulties.value,
      kpIds: kpIds.value,
      count: 9999,
      random: false,
    }).length,
);

const pool = computed(() =>
  buildQuizList(props.questions, {
    qTypes: qTypes.value,
    difficulties: difficulties.value,
    kpIds: kpIds.value,
    count: countAll.value ? matched.value : count.value,
    random: random.value,
  }),
);

function toggleQType(t: QuestionType) {
  qTypes.value = qTypes.value.includes(t) ? qTypes.value.filter((x) => x !== t) : [...qTypes.value, t];
}

function toggleDiff(d: QuestionDifficulty) {
  difficulties.value = difficulties.value.includes(d)
    ? difficulties.value.filter((x) => x !== d)
    : [...difficulties.value, d];
}

function setCount(n: number) {
  countAll.value = false;
  count.value = n;
}

function close() {
  emit("close");
}

function confirm() {
  if (pool.value.length === 0) return;
  emit("generated", pool.value);
  close();
}
</script>
