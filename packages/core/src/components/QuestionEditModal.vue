<template>
  <Teleport to=".ai-study-app">
  <div class="modal-mask" :class="{ open }" @click.self="close">
    <div class="modal">
      <h2>编辑题目</h2>
      <div class="field">
        <label>题干 <span class="req">*</span></label>
        <textarea v-model="form.title" rows="3" aria-label="题干" placeholder="输入题干…" />
      </div>
      <div class="mode-grid">
        <div class="field" style="margin-bottom:0">
          <label>题型</label>
          <select v-model="form.qType" aria-label="题型" :disabled="saving" @change="onTypeChange">
            <option v-for="t in typeOptions" :key="t.key" :value="t.key">{{ t.label }}</option>
          </select>
        </div>
        <div class="field" style="margin-bottom:0">
          <label>难度</label>
          <select v-model="form.difficulty" aria-label="难度" :disabled="saving">
            <option v-for="(label, key) in QUESTION_DIFFICULTY_LABELS" :key="key" :value="key">{{ label }}</option>
          </select>
        </div>
      </div>

      <!-- 课程题型管理：内置扩展一键添加 + 自定义新建/改名/删除（课程绑定，非通用） -->
      <div class="field">
        <label>课程题型（本课程可用）</label>
        <div v-if="addableTypes.length > 0" class="qe-add-row">
          <span class="s">添加内置题型</span>
          <button v-for="t in addableTypes" :key="t.key" class="chip" :disabled="saving || typeBusy" @click="addBuiltinType(t.key)">{{ t.label }}</button>
        </div>
        <div class="qe-add-row">
          <input
            v-model="newTypeName"
            class="qe-new-name"
            placeholder="新建自定义题型（如 写作）"
            aria-label="新建题型名"
            :disabled="saving || typeBusy"
            @keyup.enter="addCustomType"
          />
          <select v-model="newTypeMode" aria-label="作答模式" :disabled="saving || typeBusy">
            <option value="single">单选式（选项卡选一正确）</option>
            <option value="multiple">多选式（选项卡多选）</option>
            <option value="essay">简答式（AI 阅卷）</option>
          </select>
          <button class="btn sm ghost" :disabled="saving || typeBusy" @click="addCustomType">＋ 创建</button>
        </div>
        <div v-for="t in extraTypes" :key="t.key" class="qe-manage-row">
          <span class="qe-extra-label">{{ t.label }}</span>
          <template v-if="t.builtin">
            <button class="qe-mini" :disabled="saving || typeBusy" @click="removeType(t.key)">移除</button>
          </template>
          <template v-else>
            <template v-if="renamingKey === t.key">
              <input v-model="renameValue" class="qe-new-name" aria-label="重命名" @keyup.enter="confirmRename(t.key)" />
              <button class="qe-mini" :disabled="typeBusy" @click="confirmRename(t.key)">保存</button>
              <button class="qe-mini" :disabled="typeBusy" @click="renamingKey = ''">取消</button>
            </template>
            <template v-else>
              <button class="qe-mini" :disabled="saving || typeBusy" @click="startRename(t.key)">改名</button>
            </template>
            <button class="qe-mini danger" :disabled="saving || typeBusy" @click="removeType(t.key)">删除</button>
          </template>
        </div>
        <div v-if="typeError" class="s t-danger" style="margin-top:4px">✗ {{ typeError }}</div>
      </div>

      <!-- 判断：固定两项，选答案（judge 为 single 模式，分支须先于选项式判定） -->
      <div v-if="form.qType === 'judge'" class="field">
        <label>正确答案 <span class="req">*</span></label>
        <select v-model.number="singleAnswerIdx" aria-label="正确答案" :disabled="saving">
          <option v-for="(opt, i) in form.options" :key="i" :value="i">{{ opt }}</option>
        </select>
      </div>

      <!-- 选项（单选式 / 多选式） -->
      <div v-else-if="formMode === 'single' || formMode === 'multiple'" class="field">
        <label>选项 <span class="req">*</span>（{{ formMode === "single" ? "单选其一为正确答案" : "可多选正确答案" }}）</label>
        <div class="qe-options">
          <div v-for="(opt, i) in form.options" :key="i" class="qe-opt">
            <input
              v-model="form.options[i]"
              placeholder="选项内容"
              :disabled="saving"
            />
            <button class="qe-opt-del" :disabled="saving || form.options.length <= 2" title="删除选项" @click="removeOption(i)">✕</button>
          </div>
          <button class="btn sm ghost" :disabled="saving || form.options.length >= 5" @click="addOption">＋ 添加选项</button>
        </div>
        <!-- 单选式：答案下拉 -->
        <div v-if="formMode === 'single'" class="qe-answer">
          <label class="qe-answer-label">正确答案</label>
          <select v-model.number="singleAnswerIdx" aria-label="正确答案" :disabled="saving">
            <option v-for="(opt, i) in form.options" :key="i" :value="i">{{ opt || "（未填写选项）" }}</option>
          </select>
        </div>
        <!-- 多选式：勾选答案 -->
        <div v-if="formMode === 'multiple'" class="qe-multi-answer">
          <label v-for="(opt, i) in form.options" :key="i" class="qe-check">
            <input type="checkbox" :checked="multiAnswerIdxs.includes(i)" :disabled="saving" @change="toggleMultiIdx(i)" />
            <span>{{ opt || "（未填写选项）" }}</span>
          </label>
        </div>
      </div>

      <!-- 简答式 / 翻译 / 文章题：参考答案（自由文本） -->
      <div v-else class="field">
        <label>参考答案 <span class="req">*</span></label>
        <textarea
          v-model="essayAnswer"
          rows="4"
          aria-label="参考答案"
          :placeholder="essayPlaceholder"
          :disabled="saving"
        />
        <div v-if="form.qType === 'banked'" class="s" style="margin-top:6px">选项词池以题干导入/AI 生成为准，此处不可编辑。</div>
        <div v-if="form.qType === 'cloze'" class="s" style="margin-top:6px">每空 4 选项以题干导入/AI 生成为准，此处不可编辑；答案字母对应选项位置（A-D）。</div>
      </div>

      <div class="field">
        <label>解析</label>
        <textarea v-model="form.analysis" rows="3" aria-label="答案解析" placeholder="答案解析（可选）" />
      </div>

      <div class="field">
        <label>绑定知识点（可多选）</label>
        <div v-if="knowledgePoints.length === 0" class="qe-empty">暂无知识点</div>
        <div class="kp-select">
          <button
            v-for="kp in knowledgePoints"
            :key="kp.id"
            class="chip chip--solid"
            :class="{ on: form.kpIds.includes(kp.id) }"
            :disabled="saving"
            @click="toggleKp(kp.id)"
          >{{ kp.name }}</button>
        </div>
      </div>

      <div v-if="error" class="s t-danger" style="margin-bottom:10px">✗ {{ error }}</div>

      <div class="modal-actions">
        <button class="btn ghost" @click="close">取消</button>
        <button class="btn primary" :disabled="saving" @click="save">{{ saving ? "保存中…" : "保存" }}</button>
      </div>
    </div>
  </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import {
  updateQuestion,
  parseQuestionKpIds,
  parseQuestionOptions,
  QUESTION_DIFFICULTY_LABELS,
  isPassageType,
  addCourseQuestionType,
  removeCourseQuestionType,
  renameCourseQuestionType,
} from "../api";
import type { KnowledgePoint, Question, QuestionDifficulty, QuestionTypeMode } from "../api";
import { parsePassageBlanks } from "../utils/passage";
import { addableBuiltinTypes, courseTypeList, typeLabelOf, typeModeOf } from "../utils/questionTypes";
import { useCourseStore } from "../stores/course";
import { useConfirm } from "../composables/useConfirm";

/** 解析题目选项 JSON（一维选项文本或完形二维数组），失败返回 null */
function safeParseOptions(raw: string | undefined): string[] | string[][] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return null;
    if (v.every((o) => typeof o === "string")) return v as string[];
    if (v.every((o) => Array.isArray(o) && o.every((x) => typeof x === "string"))) return v as string[][];
    return null;
  } catch {
    return null;
  }
}

const props = defineProps<{
  open: boolean;
  question: Question | null;
  knowledgePoints: KnowledgePoint[];
}>();

const emit = defineEmits<{ (e: "close"): void; (e: "saved", q: Question): void }>();

const courseStore = useCourseStore();
const { confirm } = useConfirm();
/** 当前课程（弹窗只在本课程语境打开）：题型清单/作答模式解析的课程上下文 */
const course = computed(() => courseStore.currentCourse);
const courseQTypes = computed(() => courseTypeList(course.value));
/** 题型下拉选项：课程清单 + 本题题型不在清单时的占位项（自定义类型被删/旧数据，防保存时 qType 被下拉静默改掉） */
const typeOptions = computed(() => {
  const list = courseQTypes.value;
  if (form.qType && !list.some((t) => t.key === form.qType)) {
    return [
      ...list,
      { key: form.qType, label: typeLabelOf(course.value, form.qType), mode: typeModeOf(course.value, form.qType), builtin: false, extra: true },
    ];
  }
  return list;
});
/** 本题当前题型的作答模式（single/multiple/essay/passage） */
const formMode = computed<QuestionTypeMode>(() => typeModeOf(course.value, form.qType));
const essayPlaceholder = computed(() => {
  if (form.qType === "translation") return "输入参考译文";
  if (isPassageType(form.qType)) return "输入各空答案（多空用 编号:值|编号:值 分隔）";
  return "输入参考答案要点（AI 阅卷依据）";
});

// ===== 课程题型管理（内置扩展一键添加 + 自定义新建/改名/删除） =====
const typeBusy = ref(false);
const typeError = ref("");
const addableTypes = computed(() => addableBuiltinTypes(course.value));
const extraTypes = computed(() => courseQTypes.value.filter((t) => t.extra));
const newTypeName = ref("");
const newTypeMode = ref<QuestionTypeMode>("essay");
const renamingKey = ref("");
const renameValue = ref("");

function typeContextId(): number | null {
  return course.value?.id ?? null;
}

async function addBuiltinType(key: string) {
  const id = typeContextId();
  if (id == null || typeBusy.value) return;
  typeBusy.value = true;
  typeError.value = "";
  try {
    const mode = typeModeOf(course.value, key);
    await addCourseQuestionType(id, { name: key, mode });
    await courseStore.refresh();
    form.qType = key;
    onTypeChange();
  } catch (e) {
    typeError.value = e instanceof Error ? e.message : String(e);
  } finally {
    typeBusy.value = false;
  }
}

async function addCustomType() {
  const id = typeContextId();
  if (id == null || typeBusy.value) return;
  const name = newTypeName.value.trim();
  const err = validateExtraTypeNameLocal(name);
  if (err) {
    typeError.value = err;
    return;
  }
  typeBusy.value = true;
  typeError.value = "";
  try {
    await addCourseQuestionType(id, { name, mode: newTypeMode.value });
    await courseStore.refresh();
    form.qType = name;
    onTypeChange();
    newTypeName.value = "";
  } catch (e) {
    typeError.value = e instanceof Error ? e.message : String(e);
  } finally {
    typeBusy.value = false;
  }
}

async function startRename(key: string) {
  renamingKey.value = key;
  renameValue.value = key;
}

async function confirmRename(key: string) {
  const id = typeContextId();
  const to = renameValue.value.trim();
  if (id == null || typeBusy.value || to === key) {
    renamingKey.value = "";
    return;
  }
  const err = validateExtraTypeNameLocal(to);
  if (err) {
    typeError.value = err;
    return;
  }
  typeBusy.value = true;
  typeError.value = "";
  try {
    await renameCourseQuestionType(id, key, to);
    await courseStore.refresh();
    if (form.qType === key) form.qType = to;
    renamingKey.value = "";
  } catch (e) {
    typeError.value = e instanceof Error ? e.message : String(e);
  } finally {
    typeBusy.value = false;
  }
}

async function removeType(key: string) {
  const id = typeContextId();
  if (id == null || typeBusy.value) return;
  const t = courseQTypes.value.find((x) => x.key === key);
  const ok = await confirm({
    message: t?.builtin
      ? `从本课程移除内置题型「${t.label}」？已有题目保留原题型，作答与判分不受影响。`
      : `删除自定义题型「${key}」？已有题目保留原题型名（按简答式作答），可后续重新创建同名题型。`,
    danger: true,
  });
  if (!ok) return;
  typeBusy.value = true;
  typeError.value = "";
  try {
    await removeCourseQuestionType(id, key);
    await courseStore.refresh();
    // 当前题正用被删题型：回落通用简答，避免悬空
    if (form.qType === key) {
      form.qType = "essay";
      onTypeChange();
    }
  } catch (e) {
    typeError.value = e instanceof Error ? e.message : String(e);
  } finally {
    typeBusy.value = false;
  }
}

const form = reactive({
  title: "",
  qType: "single",
  difficulty: "medium" as QuestionDifficulty,
  options: [] as string[],
  analysis: "",
  kpIds: [] as number[],
});
const singleAnswerIdx = ref(0);
const multiAnswerIdxs = ref<number[]>([]);
const essayAnswer = ref("");
const saving = ref(false);
const error = ref("");

const JUDGE_OPTIONS = ["正确", "错误"];

/** 题型名校验（与 api 侧同规则；课程上下文用当前 course） */
function validateExtraTypeNameLocal(name: string): string | null {
  const n = (name ?? "").trim();
  if (!n) return "题型名不能为空";
  if (n.length > 12) return "题型名最多 12 个字";
  if (["single", "multiple", "judge", "essay"].includes(n)) return "与通用题型重名";
  const builtinLabels = ["单选", "多选", "判断", "简答", "填空", "选择填空", "完形", "翻译"];
  if (builtinLabels.includes(n)) return "与内置题型名称重复";
  if ((course.value?.extraQuestionTypes ?? []).some((t) => (t.name ?? "").trim() === n)) return "本课程已有同名题型";
  return null;
}

function initFrom(q: Question) {
  form.title = q.title;
  form.qType = q.qType;
  form.difficulty = q.difficulty as QuestionDifficulty;
  form.analysis = q.analysis;
  form.kpIds = parseQuestionKpIds(q);
  // 全量重置答案状态，避免复用组件时残留上一题的勾选/选中
  singleAnswerIdx.value = 0;
  multiAnswerIdxs.value = [];
  essayAnswer.value = "";
  const opts = parseQuestionOptions(q);
  const mode = typeModeOf(course.value, q.qType);
  if (q.qType === "judge") {
    form.options = [...JUDGE_OPTIONS];
    singleAnswerIdx.value = JUDGE_OPTIONS.indexOf(q.answer) >= 0 ? JUDGE_OPTIONS.indexOf(q.answer) : 0;
  } else if (mode === "essay" || mode === "passage") {
    form.options = [];
    essayAnswer.value = q.answer;
  } else {
    form.options = opts.length >= 2 ? opts : ["正确", "错误"];
    if (mode === "multiple") {
      const right = q.answer.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
      multiAnswerIdxs.value = right
        .map((r) => form.options.findIndex((o) => o === r))
        .filter((i) => i >= 0);
      if (multiAnswerIdxs.value.length === 0) multiAnswerIdxs.value = [0];
    } else {
      const idx = form.options.findIndex((o) => o === q.answer);
      singleAnswerIdx.value = idx >= 0 ? idx : 0;
    }
  }
  error.value = "";
}

watch(
  () => props.question,
  (q) => {
    if (q) initFrom(q);
  },
  { immediate: true },
);

function onTypeChange() {
  const t = form.qType;
  const mode = typeModeOf(course.value, t);
  if (t === "judge") {
    form.options = [...JUDGE_OPTIONS];
    singleAnswerIdx.value = 0;
    multiAnswerIdxs.value = [];
  } else if (mode === "essay" || mode === "passage") {
    form.options = [];
    essayAnswer.value = "";
    singleAnswerIdx.value = 0;
    multiAnswerIdxs.value = [];
  } else {
    if (form.options.length < 2) {
      form.options = ["正确", "错误"];
    }
    singleAnswerIdx.value = Math.min(singleAnswerIdx.value, form.options.length - 1);
    if (mode === "multiple") {
      multiAnswerIdxs.value = multiAnswerIdxs.value.filter((i) => i < form.options.length);
      if (multiAnswerIdxs.value.length === 0 && singleAnswerIdx.value < form.options.length) {
        // 从单选/判断切来：继承当前选中的答案
        multiAnswerIdxs.value = [singleAnswerIdx.value];
      }
    } else {
      multiAnswerIdxs.value = [];
    }
  }
}

function addOption() {
  if (form.options.length >= 5) return;
  form.options.push("");
}

function removeOption(i: number) {
  if (form.options.length <= 2) return;
  form.options.splice(i, 1);
  if (form.qType === "single") {
    if (singleAnswerIdx.value === i) singleAnswerIdx.value = 0;
    else if (singleAnswerIdx.value > i) singleAnswerIdx.value -= 1;
  } else if (form.qType === "multiple") {
    multiAnswerIdxs.value = multiAnswerIdxs.value
      .filter((x) => x !== i)
      .map((x) => (x > i ? x - 1 : x));
  }
}

function toggleMultiIdx(i: number) {
  multiAnswerIdxs.value = multiAnswerIdxs.value.includes(i)
    ? multiAnswerIdxs.value.filter((x) => x !== i)
    : [...multiAnswerIdxs.value, i];
}

function toggleKp(id: number) {
  form.kpIds = form.kpIds.includes(id) ? form.kpIds.filter((x) => x !== id) : [...form.kpIds, id];
}

function validate(): string {
  if (!form.title.trim()) return "题干不能为空";
  if (formMode.value === "single" || formMode.value === "multiple") {
    const trimmed = form.options.map((o) => o.trim());
    if (trimmed.some((o) => !o)) return "选项内容不能为空";
    if (new Set(trimmed).size !== trimmed.length) return "选项内容不能重复";
  }
  if (formMode.value === "multiple" && multiAnswerIdxs.value.length === 0) return "请至少勾选一个正确答案";
  if ((formMode.value === "essay" || isPassageType(form.qType)) && !essayAnswer.value.trim()) return "参考答案不能为空";
  if (isPassageType(form.qType)) {
    const parsed = parsePassageBlanks(form.title);
    if ((form.qType === "banked" || form.qType === "cloze") && parsed.length === 0) {
      return "题干需包含空位标记（__41__ / ____ / __ (word)）";
    }
    if (form.qType === "cloze" && parsed.length > 0) {
      const rows = safeParseOptions(props.question?.options);
      if (Array.isArray(rows) && rows.length > 0 && rows.length !== parsed.length) {
        return `题干空位数（${parsed.length}）与选项行数（${rows.length}）不一致，请调整题干标记`;
      }
    }
  }
  return "";
}

async function save() {
  if (!props.question) return;
  const err = validate();
  if (err) {
    error.value = err;
    return;
  }
  saving.value = true;
  error.value = "";
  try {
    const isPassage = isPassageType(form.qType);
    const mode = formMode.value;
    // 文章题：选填词池/完形选项行原样保留，不在此编辑器内修改
    const passageOptions: string[] | string[][] = isPassage
      ? form.qType === "fill"
        ? []
        : safeParseOptions(props.question.options) ?? []
      : [];
    const trimmedOpts: string[] | string[][] =
      mode === "single" || mode === "multiple"
        ? form.options.map((o) => o.trim())
        : isPassage
          ? passageOptions
          : [];
    let answer = "";
    if (mode === "essay" || isPassage) {
      answer = essayAnswer.value.trim();
    } else if (mode === "multiple") {
      answer = [...multiAnswerIdxs.value]
        .sort((a, b) => a - b)
        .map((i) => trimmedOpts[i] as string)
        .join(",");
    } else {
      // 此分支仅单选式/判断（一维选项）
      answer = (trimmedOpts as string[])[singleAnswerIdx.value] ?? "";
    }
    const parsedBlanks = isPassage ? parsePassageBlanks(form.title.trim()) : [];
    const updated = await updateQuestion(props.question.id, {
      title: form.title.trim(),
      options: trimmedOpts,
      answer,
      analysis: form.analysis,
      qType: form.qType,
      difficulty: form.difficulty,
      kpIds: form.kpIds,
      blanks: isPassage && parsedBlanks.length > 0 ? JSON.stringify(parsedBlanks) : null,
    });
    emit("saved", updated);
    close();
  } catch (e) {
    console.error("保存题目失败:", e);
    error.value = e instanceof Error ? e.message : "保存题目失败";
  } finally {
    saving.value = false;
  }
}

function close() {
  emit("close");
}
</script>
