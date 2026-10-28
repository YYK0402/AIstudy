<template>
  <div class="modal-mask" :class="{ open: modalStore.uploadMaterialOpen }" @click.self="close">
    <div class="modal" style="width:560px">
      <h2>上传资料</h2>
      <div class="field">
        <label>选择文件（PDF / Word / PPT / TXT / Markdown）</label>
        <input ref="fileInput" type="file" accept=".pdf,.docx,.pptx,.txt,.md,.markdown" @change="onFile" />
        <div v-if="selectedFile" class="s" style="margin-top:6px">{{ selectedFile.name }}（{{ fileSize }}）</div>
        <label class="s" style="display:flex;gap:6px;align-items:center;margin-top:8px;cursor:pointer">
          <input type="checkbox" v-model="useAiOrganize" :disabled="parsing || sySel !== null" />
          AI 梳理结构与识别章节（保存后后台运行：去页眉页脚水印、修复断行缺字、识别目录，进度见右上铃铛）
        </label>
      </div>
      <div class="field">
        <label>或粘贴文本</label>
        <textarea v-model="pastedText" rows="4" aria-label="粘贴资料文本" placeholder="直接粘贴讲义/笔记文本..."></textarea>
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
  startOrganizeTask,
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
const useAiOrganize = ref(false);
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
  useAiOrganize.value = false;
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
  useAiOrganize.value = false;
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

// 扫描件 OCR 通道：PDF 文字层不足时自动触发（onFile 决策）；失败时保留原解析结果并提示
async function runOcr(file: File, doc: ParsedDocument) {
  if (doc.contentText.trim().length >= 100) {
    ocrStatus.value = "该 PDF 已有文字层，无需 OCR";
    return;
  }
  try {
    const ocrText = await ocrPdfText(file, (p, t) => (ocrStatus.value = `检测到扫描件，OCR 识别中：第 ${p}/${t} 页`));
    if (ocrText.trim()) {
      result.value = { ...doc, contentText: ocrText.trim(), headings: [] };
      ocrStatus.value = `OCR 完成：识别 ${ocrText.trim().length} 字符，页眉页脚水印与章节结构将由 AI 梳理处理`;
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
      // 第二步链路默认启用：AI 梳理去噪 + 识别章节（用户可取消）
      useAiOrganize.value = true;
      // 第一步识别层自动决策：PDF 文字层充足直接用（无 OCR 误差且更快），不足（扫描件）自动转 OCR
      if (isPdf.value) {
        if (doc.contentText.trim().length >= 100) {
          ocrStatus.value = "PDF 已有文字层，按文字层解析（无需 OCR）";
        } else {
          await runOcr(file, doc);
        }
      }
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
    const material = await createMaterial({
      courseId,
      name: result.value.name,
      fileType: result.value.fileType,
      contentText: result.value.contentText,
      headings: JSON.stringify(result.value.headings),
      assetPath,
      source: sySel.value ? "siyuan" : selectedFile.value ? "upload" : "paste",
      siyuanDocId: sySel.value?.docId,
    });
    const aiOrganize = useAiOrganize.value;
    const contentText = result.value.contentText;
    const headings = result.value.headings;
    // 资料已落库，但后续设置读取失败时保留 modal 展示错误，不静默关闭
    const settings = await getSettings();
    close();
    modalStore.notifyMaterialSaved();
    if (aiOrganize) {
      // 第三步目录预览等梳理完成后再自动弹出（梳理后的标题更干净），见 runOrganizeTask
      startOrganizeTask(material.id, courseId, contentText);
      const waitToc = settings.chapterMode === "auto" ? "，完成后自动弹目录预览" : "";
      window.siyuanAiStudy.showMessage(`已保存，AI 梳理任务已后台启动（进度见右上铃铛${waitToc}）`, 4000);
    } else if (settings.chapterMode === "auto" && headings.length > 0) {
      // 未启用 AI 梳理时，用本地启发式标题立即弹目录预览
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
    useAiOrganize.value = true;
});
</script>
