<template>
  <div class="modal-mask" :class="{ open: modalStore.uploadMaterialOpen }" @click.self="close">
    <div class="modal" style="width:560px">
      <h2>上传资料</h2>
      <div class="field">
        <label>选择文件（PDF / Word / PPT / TXT / Markdown）</label>
        <input ref="fileInput" type="file" accept=".pdf,.docx,.pptx,.txt,.md,.markdown" @change="onFile" />
        <div v-if="selectedFile" class="s" style="margin-top:6px">{{ selectedFile.name }}（{{ fileSize }}）</div>
        <label v-if="isPdf" class="s" style="display:flex;gap:6px;align-items:center;margin-top:8px;cursor:pointer">
          <input type="checkbox" v-model="useOcr" :disabled="parsing" />
          OCR 识别扫描件（纯图片 PDF，耗时较长，使用思源内核 OCR）
        </label>
      </div>
      <div class="field">
        <label>或粘贴文本</label>
        <textarea v-model="pastedText" rows="4" placeholder="直接粘贴讲义/笔记文本..."></textarea>
      </div>
      <div class="field">
        <label>或从思源选择文档（绑定已有文档，不复制副本）</label>
        <SiyuanDocPicker
          v-model="sySel"
          placeholder="选择思源已有文档，其 markdown 将作为资料内容（可跳转原文）"
        />
      </div>
      <div v-if="parsing" class="empty-state" style="padding:12px"><span class="muted">{{ ocrStatus || "解析中…" }}</span></div>
      <div v-else-if="result" class="card" style="padding:10px 12px;background:var(--as-bg-elev2)">
        <div class="s"><b>{{ result.name }}</b>（{{ result.fileType }}）</div>
        <div class="s" style="color:var(--as-text-faint);margin-top:4px">
          共 {{ result.contentText.length }} 字符 · 预览：{{ result.contentText.slice(0, 120) }}…
        </div>
      </div>
      <div v-if="ocrStatus && !parsing" class="s" style="color:var(--as-text-faint)">{{ ocrStatus }}</div>
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
import {
  createMaterial,
  getSettings,
  uploadAsset,
  type SiyuanDocSelection,
} from "../api";
import { parseDocument, parseTextInput, type ParsedDocument } from "../utils/documentParser";
import { ocrPdfText } from "../utils/pdfOcr";
import SiyuanDocPicker from "./SiyuanDocPicker.vue";

const modalStore = useModalStore();
const fileInput = ref<HTMLInputElement | null>(null);
const selectedFile = ref<File | null>(null);
const pastedText = ref("");
const parsing = ref(false);
const saving = ref(false);
const useOcr = ref(false);
const ocrStatus = ref("");
const result = ref<ParsedDocument | null>(null);
const error = ref("");

// ===== 从思源选择文档（SiyuanDocPicker 提供） =====
const sySel = ref<SiyuanDocSelection | null>(null);

const isPdf = computed(() => (selectedFile.value?.name.toLowerCase().endsWith(".pdf") ?? false));

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
  useOcr.value = false;
  ocrStatus.value = "";
  sySel.value = null;
  if (fileInput.value) fileInput.value.value = "";
}

// 选中思源文档 → markdown 解析为资料内容
watch(sySel, async (sel) => {
  if (!sel) return;
  selectedFile.value = null;
  if (fileInput.value) fileInput.value.value = "";
  pastedText.value = "";
  parsing.value = true;
  error.value = "";
  try {
    const doc = await parseTextInput(sel.markdown ?? "");
    result.value = { ...doc, name: sel.docName, fileType: "md" };
  } catch (e) {
    error.value = e instanceof Error ? e.message : "读取文档失败";
  } finally {
    parsing.value = false;
  }
});

// 扫描件 OCR 通道：文字层已有足够文本时跳过；失败时保留原解析结果并提示
async function runOcr(file: File, doc: ParsedDocument) {
  if (doc.contentText.trim().length >= 100) {
    ocrStatus.value = "该 PDF 已有文字层，无需 OCR";
    return;
  }
  try {
    const ocrText = await ocrPdfText(file, (p, t) => (ocrStatus.value = `OCR 识别中：第 ${p}/${t} 页`));
    if (ocrText.trim()) {
      result.value = { ...doc, contentText: ocrText.trim(), headings: [] };
      ocrStatus.value = `OCR 完成：识别 ${ocrText.trim().length} 字符（未识别章节结构，目录需手动搭建）`;
    } else {
      ocrStatus.value = "OCR 未识别到文本，请检查扫描图片质量";
    }
  } catch (e) {
    ocrStatus.value = `OCR 失败（当前思源环境可能不支持 OCR）：${e instanceof Error ? e.message : String(e)}`;
  }
}

async function onFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  selectedFile.value = file;
  sySel.value = null;
  pastedText.value = "";
  result.value = null;
  error.value = "";
  ocrStatus.value = "";
  parsing.value = true;
  try {
    const doc = await parseDocument(file);
    result.value = doc;
    if (useOcr.value && isPdf.value) {
      await runOcr(file, doc);
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    parsing.value = false;
  }
}

// 选中文件后再勾选「OCR 识别扫描件」时补跑 OCR（文字层已充足时提示跳过）
watch(useOcr, async (on) => {
  const file = selectedFile.value;
  if (!on || !file || !isPdf.value || parsing.value || !result.value) return;
  if (result.value.contentText.trim().length >= 100) {
    ocrStatus.value = "该 PDF 已有文字层，无需 OCR";
    return;
  }
  parsing.value = true;
  try {
    await runOcr(file, result.value);
  } finally {
    parsing.value = false;
  }
});

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
      source: sySel.value ? "siyuan" : selectedFile.value ? "upload" : "paste",
      siyuanDocId: sySel.value?.docId,
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
    // 选择思源文档触发的清空（sySel 已置位）不取消绑定
    if (sySel.value) return;
    result.value = null;
    return;
  }
  sySel.value = null;
  selectedFile.value = null;
  if (fileInput.value) fileInput.value.value = "";
  result.value = await parseTextInput(text);
});
</script>
