<template>
  <div class="modal-mask" :class="{ open: modalStore.uploadMaterialOpen }" @click.self="close">
    <div class="modal" style="width:560px">
      <h2>上传资料</h2>
      <div class="field">
        <label>选择文件（PDF / Word / PPT / TXT / Markdown）</label>
        <input ref="fileInput" type="file" accept=".pdf,.docx,.pptx,.txt,.md,.markdown" @change="onFile" />
        <div v-if="selectedFile" class="s" style="margin-top:6px">{{ selectedFile.name }}（{{ fileSize }}）</div>
      </div>
      <div class="field">
        <label>或粘贴文本</label>
        <textarea v-model="pastedText" rows="4" placeholder="直接粘贴讲义/笔记文本..."></textarea>
      </div>
      <div v-if="parsing" class="empty-state" style="padding:12px"><span class="muted">解析中…</span></div>
      <div v-else-if="result" class="card" style="padding:10px 12px;background:var(--as-bg-elev2)">
        <div class="s"><b>{{ result.name }}</b>（{{ result.fileType }}）</div>
        <div class="s" style="color:var(--as-text-faint);margin-top:4px">
          共 {{ result.contentText.length }} 字符 · 预览：{{ result.contentText.slice(0, 120) }}…
        </div>
      </div>
      <div v-if="error" class="s" style="color:var(--as-red)">{{ error }}</div>
      <div class="modal-actions">
        <button class="btn ghost" @click="close">取消</button>
        <button class="btn primary" :disabled="!canSave || saving" @click="save">
          {{ saving ? "保存中…" : "保存到资料库" }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useModalStore } from "../stores/modal";
import { createMaterial, getSettings, uploadAsset } from "../api";
import { parseDocument, parseTextInput, type ParsedDocument } from "../utils/documentParser";

const modalStore = useModalStore();
const fileInput = ref<HTMLInputElement | null>(null);
const selectedFile = ref<File | null>(null);
const pastedText = ref("");
const parsing = ref(false);
const saving = ref(false);
const result = ref<ParsedDocument | null>(null);
const error = ref("");

const fileSize = computed(() => {
  const f = selectedFile.value;
  if (!f) return "";
  const kb = Math.round(f.size / 1024);
  return kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;
});

const canSave = computed(() => result.value !== null && modalStore.uploadMaterialCourseId > 0);

function close() {
  reset();
  modalStore.closeUploadMaterial();
}

function reset() {
  selectedFile.value = null;
  pastedText.value = "";
  result.value = null;
  error.value = "";
  if (fileInput.value) fileInput.value.value = "";
}

async function onFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  selectedFile.value = file;
  pastedText.value = "";
  result.value = null;
  error.value = "";
  parsing.value = true;
  try {
    result.value = await parseDocument(file);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    parsing.value = false;
  }
}

async function save() {
  if (!canSave.value || !result.value) return;
  saving.value = true;
  try {
    const courseId = modalStore.uploadMaterialCourseId;
    // 有原始文件时上传到思源资源目录，便于后续「重新解析」
    let assetPath = "";
    if (selectedFile.value) {
      try {
        assetPath = await uploadAsset(selectedFile.value);
      } catch (e) {
        console.error("上传资源文件失败（不影响资料保存）:", e);
      }
    }
    await createMaterial({
      courseId,
      name: result.value.name,
      fileType: result.value.fileType,
      contentText: result.value.contentText,
      headings: JSON.stringify(result.value.headings),
      assetPath,
    });
    const headings = result.value.headings;
    close();
    modalStore.notifyMaterialSaved();
    // 自动模式下，识别到标题结构则弹出目录预览
    const settings = await getSettings();
    if (settings.chapterMode === "auto" && headings.length > 0) {
      modalStore.openChapterPreview(courseId, headings);
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    saving.value = false;
  }
}

watch(pastedText, async (text) => {
  if (!text.trim()) {
    result.value = null;
    return;
  }
  selectedFile.value = null;
  if (fileInput.value) fileInput.value.value = "";
  result.value = await parseTextInput(text);
});
</script>