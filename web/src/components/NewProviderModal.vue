<template>
  <div class="modal-mask" :class="{ open: modalStore.newProviderOpen }" @click.self="close">
    <div class="modal">
      <h2>新增服务商</h2>
      <div class="field">
        <label>服务商名称 <span class="req">*</span></label>
        <input v-model="form.name" placeholder="如：DeepSeek / OpenAI / 通义千问" />
      </div>
      <div class="field">
        <label>API 接口地址 <span class="req">*</span></label>
        <input v-model="form.baseUrl" placeholder="如：https://api.deepseek.com" />
      </div>
      <div class="field">
        <label>API Key <span class="req">*</span></label>
        <input v-model="form.apiKey" type="password" placeholder="sk-..." />
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
import { computed, reactive, ref } from "vue";
import { useModalStore } from "../stores/modal";
import { useProviderStore } from "../stores/provider";
import { createProvider } from "../api";

const emit = defineEmits<{ (e: "saved"): void }>();

const modalStore = useModalStore();
const providerStore = useProviderStore();
const saving = ref(false);

const form = reactive({
  name: "",
  baseUrl: "",
  apiKey: "",
  timeout: 60,
});

const valid = computed(() => form.name.trim() !== "" && form.baseUrl.trim() !== "" && form.apiKey.trim() !== "");

function close() {
  modalStore.closeNewProvider();
}

async function save() {
  if (!valid.value || saving.value) {
    return;
  }
  saving.value = true;
  try {
    await createProvider({
      name: form.name.trim(),
      baseUrl: form.baseUrl.trim(),
      apiKey: form.apiKey.trim(),
      timeout: Number(form.timeout) || 60,
    });
    close();
    form.name = "";
    form.baseUrl = "";
    form.apiKey = "";
    form.timeout = 60;
    await providerStore.load();
    emit("saved");
  } catch (error) {
    console.error("新增服务商失败:", error);
  } finally {
    saving.value = false;
  }
}
</script>
