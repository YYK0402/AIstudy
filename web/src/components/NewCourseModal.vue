<template>
  <div class="modal-mask" :class="{ open: modalStore.newCourseOpen }" @click.self="close">
    <div class="modal">
      <h2>{{ isEdit ? "编辑课程" : "新建课程" }}</h2>
      <div class="field">
        <label>课程名称 <span class="req">*</span></label>
        <input v-model="form.name" placeholder="如：高等数学（上）" />
      </div>
      <div class="field">
        <label>简介</label>
        <textarea v-model="form.description" rows="2" placeholder="一句话说明这门课程…"></textarea>
      </div>
      <div class="field">
        <label>学习目标</label>
        <textarea v-model="form.target" rows="2" placeholder="如：期末 90+ / 通过考研初试"></textarea>
      </div>
      <div class="field">
        <label>预计总周期</label>
        <input v-model="form.totalCycle" placeholder="如：12 周 / 3 个月" />
      </div>
      <div class="field">
        <label>本课程指定模型</label>
        <select v-model.number="form.modelId">
          <option :value="null">跟随任务分配（模型配置页）</option>
          <option v-for="m in providerStore.models" :key="m.id" :value="m.id">{{ m.displayName }}</option>
        </select>
        <div class="s" style="color:var(--as-text-faint);margin-top:4px">
          指定后，本课程的全部 AI 任务（抽取/出题/评估/报告等）优先用该模型；留空则按「模型配置」页的任务分配执行。
        </div>
      </div>
      <div v-if="!isEdit" class="field">
        <label>目录构建模式</label>
        <div class="mode-grid">
          <div class="mode-card" :class="{ sel: form.mode === 'manual' }" @click="form.mode = 'manual'">
            <div class="t">✍️ 手动模式</div>
            <div class="d">先手动搭建章节/单元目录，再上传资料绑定对应章节</div>
          </div>
          <div class="mode-card" :class="{ sel: form.mode === 'ai' }" @click="form.mode = 'ai'">
            <div class="t">🤖 AI 自动模式</div>
            <div class="d">上传资料后由 AI 识别结构，自动生成章节/单元树</div>
          </div>
        </div>
      </div>
      <div class="modal-actions">
        <button v-if="isEdit" class="btn ghost danger" style="margin-right:auto" :disabled="creating" @click="remove">
          删除课程
        </button>
        <button class="btn ghost" @click="close">取消</button>
        <button class="btn primary" :disabled="!form.name.trim() || creating" @click="save">
          {{ creating ? (isEdit ? "保存中…" : "创建中…") : (isEdit ? "保存" : "创建课程") }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useModalStore } from "../stores/modal";
import { useCourseStore } from "../stores/course";
import { useProviderStore } from "../stores/provider";
import { createCourse, updateCourse, queryCourses, deleteCourse } from "../api";

const modalStore = useModalStore();
const courseStore = useCourseStore();
const providerStore = useProviderStore();

const creating = ref(false);

const form = reactive({
  name: "",
  description: "",
  target: "",
  totalCycle: "",
  modelId: null as number | null,
  mode: "manual" as "manual" | "ai",
});

onMounted(() => {
  void providerStore.load();
});

const isEdit = computed(() => modalStore.editingCourse !== null);

watch(
  () => modalStore.newCourseOpen,
  (open) => {
    if (!open) return;
    const editing = modalStore.editingCourse;
    if (editing) {
      form.name = editing.name;
      form.description = editing.description;
      form.target = editing.target;
      form.totalCycle = editing.totalCycle;
      form.modelId = editing.modelId ?? null;
      form.mode = "manual";
    } else {
      form.name = "";
      form.description = "";
      form.target = "";
      form.totalCycle = "";
      form.modelId = null;
      form.mode = "manual";
    }
  },
  { immediate: true },
);

function close() {
  modalStore.closeNewCourse();
}

async function save() {
  if (!form.name.trim() || creating.value) {
    return;
  }
  creating.value = true;
  try {
    const editing = modalStore.editingCourse;
    if (editing) {
      await updateCourse(editing.id, {
        name: form.name.trim(),
        description: form.description,
        target: form.target,
        totalCycle: form.totalCycle,
        modelId: form.modelId,
      });
    } else {
      await createCourse({
        name: form.name.trim(),
        description: form.description,
        target: form.target,
        totalCycle: form.totalCycle,
        modelId: form.modelId,
      });
    }
    const courses = await queryCourses();
    courseStore.setCourses(courses);
    close();
    form.name = "";
    form.description = "";
    form.target = "";
    form.totalCycle = "";
    form.modelId = null;
    form.mode = "manual";
  } catch (error) {
    console.error("保存课程失败:", error);
    window.siyuanAiStudy.showMessage(error instanceof Error ? error.message : "保存课程失败", 4000, "error");
  } finally {
    creating.value = false;
  }
}

async function remove() {
  const editing = modalStore.editingCourse;
  if (!editing || creating.value) return;
  if (!window.confirm(`确定删除课程「${editing.name}」？其下章节、知识点、资料、题目与全部学习记录将一并删除，且已落库思源的文档会同步删除。此操作不可恢复。`)) {
    return;
  }
  creating.value = true;
  try {
    await deleteCourse(editing.id);
    const courses = await queryCourses();
    courseStore.setCourses(courses);
    close();
    window.siyuanAiStudy.showMessage(`课程「${editing.name}」已删除`);
  } catch (error) {
    console.error("删除课程失败:", error);
    window.siyuanAiStudy.showMessage(error instanceof Error ? error.message : "删除课程失败", 4000, "error");
  } finally {
    creating.value = false;
  }
}
</script>
