<template>
  <div class="modal-mask" :class="{ open: modalStore.newCourseOpen }" @click.self="close">
    <div class="modal">
      <h2>新建课程</h2>
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
        <button class="btn ghost" @click="close">取消</button>
        <button class="btn primary" :disabled="!form.name.trim() || creating" @click="create">
          {{ creating ? "创建中…" : "创建课程" }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from "vue";
import { useModalStore } from "../stores/modal";
import { useCourseStore } from "../stores/course";
import { createCourse, queryCourses } from "../api";

const modalStore = useModalStore();
const courseStore = useCourseStore();

const creating = ref(false);

const form = reactive({
  name: "",
  description: "",
  target: "",
  totalCycle: "",
  mode: "manual" as "manual" | "ai",
});

function close() {
  modalStore.closeNewCourse();
}

async function create() {
  if (!form.name.trim() || creating.value) {
    return;
  }
  creating.value = true;
  try {
    await createCourse({
      name: form.name.trim(),
      description: form.description,
      target: form.target,
      totalCycle: form.totalCycle,
    });
    const courses = await queryCourses();
    courseStore.setCourses(courses);
    close();
    form.name = "";
    form.description = "";
    form.target = "";
    form.totalCycle = "";
    form.mode = "manual";
  } catch (error) {
    console.error("创建课程失败:", error);
    window.siyuanAiStudy.showMessage(error instanceof Error ? error.message : "创建课程失败");
  } finally {
    creating.value = false;
  }
}
</script>
