<template>
  <div class="modal-mask" :class="{ open: modalStore.newProviderOpen }" @click.self="close">
    <div class="modal">
      <h2>{{ isEdit ? "编辑服务商" : "新增服务商" }}</h2>
      <div class="field">
        <label>预设模板</label>
        <div class="preset-row">
          <button v-for="p in presets" :key="p.name" class="chip" @click="applyPreset(p)">{{ p.name }}</button>
        </div>
      </div>
      <div class="field">
        <label>服务商名称 <span class="req">*</span></label>
        <input v-model="form.name" placeholder="如：DeepSeek / OpenAI / 通义千问" />
      </div>
      <div class="field">
        <label>API 接口地址 <span class="req">*</span></label>
        <input v-model="form.baseUrl" placeholder="如：https://api.deepseek.com/v1" />
      </div>
      <div class="field">
        <label>API Key <span v-if="keyRequired" class="req">*</span><span v-else style="color:var(--as-text-faint)">{{ isEdit ? "（留空则不修改）" : "（本地服务可留空）" }}</span></label>
        <input v-model="form.apiKey" type="password" :placeholder="isEdit ? '留空保留原密钥' : keyRequired ? 'sk-...' : '本地服务可留空'" />
      </div>
      <div class="field">
        <label>请求超时时间（秒）</label>
        <input v-model="form.timeout" type="number" min="1" placeholder="60" />
      </div>
      <div class="modal-actions">
        <button class="btn ghost" @click="close">取消</button>
        <button class="btn primary" :disabled="!valid || saving" @click="save">
          {{ saving ? "保存中…" : "保存" }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useModalStore } from "../stores/modal";
import { useProviderStore } from "../stores/provider";
import { createProvider, updateProvider, PROVIDER_PRESETS } from "../api";

const modalStore = useModalStore();
const providerStore = useProviderStore();
const saving = ref(false);

const presets = PROVIDER_PRESETS;

const form = reactive({
  name: "",
  baseUrl: "",
  apiKey: "",
  timeout: 60,
});

const isEdit = computed(() => modalStore.editingProvider !== null);

/** 本地服务（Ollama 等）通常无需 API Key */
function isLocalUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0" || h === "::1" || h === "[::1]";
  } catch {
    return false;
  }
}

const keyRequired = computed(() => !isEdit.value && !isLocalUrl(form.baseUrl.trim()));

const valid = computed(() => {
  if (form.name.trim() === "" || form.baseUrl.trim() === "") {
    return false;
  }
  return isEdit.value || form.apiKey.trim() !== "" || isLocalUrl(form.baseUrl.trim());
});

function applyPreset(preset: { name: string; baseUrl: string }) {
  form.name = preset.name;
  form.baseUrl = preset.baseUrl;
}

function resetForm() {
  form.name = "";
  form.baseUrl = "";
  form.apiKey = "";
  form.timeout = 60;
}

watch(
  () => modalStore.newProviderOpen,
  (open) => {
    if (open) {
      const editing = modalStore.editingProvider;
      if (editing) {
        form.name = editing.name;
        form.baseUrl = editing.baseUrl;
        form.apiKey = "";
        form.timeout = editing.timeout;
      } else {
        resetForm();
      }
    }
  },
  { immediate: true },
);

function close() {
  modalStore.closeNewProvider();
}

async function save() {
  if (!valid.value || saving.value) {
    return;
  }
  saving.value = true;
  try {
    const editing = modalStore.editingProvider;
    if (editing) {
      await updateProvider({
        ...editing,
        name: form.name.trim(),
        baseUrl: form.baseUrl.trim(),
        apiKey: form.apiKey.trim() ? form.apiKey.trim() : editing.apiKey,
        timeout: Number(form.timeout) || 60,
      });
    } else {
      await createProvider({
        name: form.name.trim(),
        baseUrl: form.baseUrl.trim(),
        apiKey: form.apiKey.trim(),
        timeout: Number(form.timeout) || 60,
      });
    }
    close();
    resetForm();
    await providerStore.load();
  } catch (error) {
    console.error("保存服务商失败:", error);
    window.siyuanAiStudy.showMessage(error instanceof Error ? error.message : "保存服务商失败", 4000, "error");
  } finally {
    saving.value = false;
  }
}
</script>
