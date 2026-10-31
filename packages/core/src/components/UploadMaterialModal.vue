<template>
  <div class="modal-mask" :class="{ open: modalStore.uploadMaterialOpen }" @click.self="close">
    <div class="modal" style="width:560px">
      <h2>上传资料</h2>
      <div class="field">
        <label>选择文件（PDF / Word / PPT / TXT / Markdown，可多选）</label>
        <input ref="fileInput" type="file" accept=".pdf,.docx,.pptx,.txt,.md,.markdown" multiple @change="onFile" />
        <div v-if="fileItems.length > 0" style="margin-top:6px">
          <div v-for="(it, i) in fileItems" :key="it.file.name + i" class="s">
            {{ it.file.name }}（{{ fmtSize(it.file.size) }}）
            <template v-if="it.doc"> · 共 {{ it.doc.contentText.length }} 字符</template>
            <template v-else-if="it.error"> · <span class="t-danger">{{ it.error }}</span></template>
            <template v-else> · 解析中…</template>
          </div>
        </div>
        <label class="s" style="display:flex;gap:6px;align-items:center;margin-top:8px;cursor:pointer">
          <input type="checkbox" v-model="useAiOrganize" :disabled="parsing || sySel !== null" />
          AI 梳理结构与识别章节（保存后后台运行：去页眉页脚水印、修复断行缺字、识别目录，进度见右上铃铛）
        </label>
      </div>
      <div class="field">
        <label>或粘贴文本</label>
        <textarea v-model="pastedText" rows="4" aria-label="粘贴资料文本" placeholder="直接粘贴讲义/笔记文本..."></textarea>
      </div>
      <div v-if="docsEnabled()" class="field">
        <label>或从思源选择文档（绑定已有文档，不复制副本）</label>
        <SiyuanDocPicker
          v-model="sySel"
          placeholder="选择思源已有文档，其 markdown 将作为资料内容（可跳转原文）"
        />
      </div>
      <div v-if="nasEnabled" class="field">
        <label>或从 NAS 选择（直接引用飞牛存储上的文件，不复制副本）</label>
        <button class="btn" :disabled="parsing || pickingNas" @click="pickNas">
          {{ pickingNas ? "正在选取并解析…" : "选择文件" }}
        </button>
      </div>
      <div v-if="parsing" class="empty-state" style="padding:12px"><span class="s">{{ ocrStatus || "解析中…" }}</span></div>
      <div v-else-if="result" class="card" style="padding:10px 12px;background:var(--as-bg-elev2)">
        <div class="s"><b>{{ result.name }}</b>（{{ result.fileType }}）</div>
        <div class="s t-faint" style="margin-top:4px">
          共 {{ result.contentText.length }} 字符 · 预览：{{ result.contentText.slice(0, 120) }}…
        </div>
      </div>
      <div v-if="ocrStatus && !parsing" class="s t-faint">{{ ocrStatus }}</div>
      <div v-if="error" class="s t-danger">{{ error }}</div>
      <div class="modal-actions">
        <button class="btn ghost" @click="close">取消</button>
        <button class="btn primary" :disabled="!canSave || saving" @click="save">
          {{ saving ? "保存中…" : canSave ? `保存到资料库${savedCount > 1 ? `（${savedCount} 份）` : ""}` : "保存到资料库" }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useModalStore } from "../stores/modal";
import {
  aggregateCourseToc,
  createMaterial,
  getSettings,
  uploadAsset,
  startOrganizeTask,
  docsEnabled,
  type Material,
  type SiyuanDocSelection,
} from "../api";
import { parseDocument, parseTextInput, type ParsedDocument } from "../utils/documentParser";
import { ocrPdfText } from "../utils/pdfOcr";
import SiyuanDocPicker from "./SiyuanDocPicker.vue";
import { getBridge } from "@/bridge";

interface FileItem {
  file: File;
  doc?: ParsedDocument;
  error?: string;
  /** NAS 文件引用 URL（存在时保存直接引用 NAS 原文件，跳过上传副本） */
  nasUrl?: string;
}

const modalStore = useModalStore();
const bridge = getBridge();
const nasEnabled = bridge.capabilities.nasFiles;
const fileInput = ref<HTMLInputElement | null>(null);
const fileItems = ref<FileItem[]>([]);
const pickingNas = ref(false);
const pastedText = ref("");
const parsing = ref(false);
const saving = ref(false);
const useAiOrganize = ref(false);
const ocrStatus = ref("");
const result = ref<ParsedDocument | null>(null);
const error = ref("");

// ===== 从思源选择文档（SiyuanDocPicker 提供） =====
const sySel = ref<SiyuanDocSelection | null>(null);

const parsedItems = computed(() => fileItems.value.filter((it) => it.doc));
const savedCount = computed(() => (sySel.value || pastedText.value.trim() ? 1 : parsedItems.value.length));

function fmtSize(bytes: number): string {
  const kb = Math.round(bytes / 1024);
  return kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;
}

const canSave = computed(() => (result.value !== null || parsedItems.value.length > 0) && modalStore.uploadMaterialCourseId > 0);

function close() {
  reset();
  modalStore.closeUploadMaterial();
}

function reset() {
  fileItems.value = [];
  pastedText.value = "";
  result.value = null;
  error.value = "";
  useAiOrganize.value = false;
  ocrStatus.value = "";
  sySel.value = null;
  if (fileInput.value) fileInput.value.value = "";
}

function clearFileSelection() {
  fileItems.value = [];
  if (fileInput.value) fileInput.value.value = "";
}

// 选中思源文档 → markdown 解析为资料内容
watch(sySel, async (sel) => {
  if (!sel) return;
  clearFileSelection();
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
    const ocrText = await ocrPdfText(file, (p, t) => (ocrStatus.value = `检测到扫描件，OCR 识别中：${file.name} 第 ${p}/${t} 页`));
    if (ocrText.trim()) {
      result.value = null;
      return { ...doc, contentText: ocrText.trim(), headings: [] };
    }
    ocrStatus.value = "OCR 未识别到文本，请检查扫描图片质量";
    return doc;
  } catch (e) {
    ocrStatus.value = `OCR 失败（当前思源环境可能不支持 OCR）：${e instanceof Error ? e.message : String(e)}`;
    return doc;
  }
}

// 解析文件（PDF 文字层不足时走扫描件 OCR 通道）
async function parseFileWithOcr(file: File): Promise<ParsedDocument> {
  let doc = await parseDocument(file);
  if (file.name.toLowerCase().endsWith(".pdf")) {
    if (doc.contentText.trim().length >= 100) {
      ocrStatus.value = `${file.name} 已有文字层，按文字层解析（无需 OCR）`;
    } else {
      doc = (await runOcr(file, doc)) as ParsedDocument;
    }
  }
  return doc;
}

async function onFile(e: Event) {
  const files = Array.from((e.target as HTMLInputElement).files ?? []);
  if (files.length === 0) return;
  sySel.value = null;
  pastedText.value = "";
  result.value = null;
  error.value = "";
  ocrStatus.value = "";
  fileItems.value = files.map((file) => ({ file }));
  parsing.value = true;
  let anyParsed = false;
  try {
    // 串行解析：OCR 等耗时操作逐个进行，状态提示不互相覆盖
    for (const item of fileItems.value) {
      try {
        item.doc = await parseFileWithOcr(item.file);
        anyParsed = true;
      } catch (err) {
        item.error = err instanceof Error ? err.message : String(err);
      }
    }
    // 第二步链路默认启用：AI 梳理去噪 + 识别章节（用户可取消）
    if (anyParsed) useAiOrganize.value = true;
  } finally {
    parsing.value = false;
  }
}

// 从 NAS 选取文件：系统选择器选完即自动授权，下载字节后走同一解析管线；保存时直接引用 NAS 路径
async function pickNas() {
  if (pickingNas.value) return;
  sySel.value = null;
  pastedText.value = "";
  result.value = null;
  error.value = "";
  ocrStatus.value = "";
  fileItems.value = [];
  pickingNas.value = true;
  parsing.value = true;
  let anyParsed = false;
  try {
    const refs = await bridge.pickNasFiles([".pdf", ".docx", ".pptx", ".txt", ".md", ".markdown"]);
    if (refs.length === 0) return;
    // 先整体赋值再迭代代理数组写入 doc/error，确保 parsedItems 计算属性正确失效
    fileItems.value = refs.map((ref) => ({ file: new File([], ref.name), nasUrl: ref.url }));
    for (const item of fileItems.value) {
      try {
        const res = await fetch(item.nasUrl!);
        if (!res.ok) throw new Error("读取 NAS 文件失败：HTTP " + res.status);
        const blob = await res.blob();
        const file = new File([blob], item.file.name, { type: blob.type });
        item.doc = await parseFileWithOcr(file);
        item.file = file;
        anyParsed = true;
      } catch (err) {
        item.error = err instanceof Error ? err.message : String(err);
      }
    }
    if (anyParsed) useAiOrganize.value = true;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    pickingNas.value = false;
    parsing.value = false;
  }
}

async function save() {
  if (!canSave.value || saving.value) return;
  saving.value = true;
  try {
    const courseId = modalStore.uploadMaterialCourseId;
    const aiOrganize = useAiOrganize.value;
    const created: { material: Material; organized: boolean }[] = [];
    if (parsedItems.value.length > 0) {
      for (const it of parsedItems.value) {
        const doc = it.doc!;
        // 本地上传：存副本到宿主资源存储，便于后续「重新解析」；NAS 引用：直接指向原文件
        let assetPath = it.nasUrl ?? "";
        if (!it.nasUrl) {
          try {
            assetPath = await uploadAsset(it.file);
          } catch (e) {
            console.error("上传资源文件失败（不影响资料保存）:", e);
          }
        }
        const material = await createMaterial({
          courseId,
          name: doc.name,
          fileType: doc.fileType,
          contentText: doc.contentText,
          headings: JSON.stringify(doc.headings),
          assetPath,
          source: it.nasUrl ? "nas" : "upload",
        });
        if (aiOrganize) startOrganizeTask(material.id, courseId, doc.contentText);
        created.push({ material, organized: aiOrganize });
      }
    } else if (result.value) {
      // 粘贴 / 思源文档通道（单份）
      let assetPath = "";
      const material = await createMaterial({
        courseId,
        name: result.value.name,
        fileType: result.value.fileType,
        contentText: result.value.contentText,
        headings: JSON.stringify(result.value.headings),
        assetPath,
        source: sySel.value ? "siyuan" : "paste",
        siyuanDocId: sySel.value?.docId,
      });
      if (aiOrganize) startOrganizeTask(material.id, courseId, result.value.contentText);
      created.push({ material, organized: aiOrganize });
    }
    // 资料已落库，但后续设置读取失败时保留 modal 展示错误，不静默关闭
    const settings = await getSettings();
    close();
    modalStore.notifyMaterialSaved();
    const n = created.length;
    if (created.some((c) => c.organized)) {
      // 第三步目录预览等全部梳理完成后再自动弹出（由 runOrganizeTask 聚合课程全部资料后弹出），见 runOrganizeTask
      const waitToc = settings.chapterMode === "auto" ? "，完成后自动弹目录预览" : "";
      getBridge().showMessage(
        n > 1 ? `已保存 ${n} 份资料，AI 梳理任务已后台启动（进度见右上铃铛${waitToc}）` : `已保存，AI 梳理任务已后台启动（进度见右上铃铛${waitToc}）`,
        4000,
      );
    } else if (settings.chapterMode === "auto") {
      // 未启用 AI 梳理时，立即弹目录预览（聚合课程全部资料的标题）
      const agg = await aggregateCourseToc(courseId);
      if (agg.headings.length > 0) modalStore.openChapterPreview(courseId, agg.headings, null, agg.materialCount);
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
    clearFileSelection();
    result.value = await parseTextInput(text);
    useAiOrganize.value = true;
});
</script>
