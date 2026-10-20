<template>
  <div class="page">
    <div class="page-title"><h1>模型配置</h1><div class="desc">服务商 · 模型 · 任务分配 · 调用日志</div></div>
    <div class="two-col" style="grid-template-columns:1fr 1fr">
      <div class="card">
        <h3>服务商 <button class="btn sm ghost" style="margin-left:auto" @click="modalStore.openNewProvider()">＋ 新增服务商</button></h3>
        <div v-if="providerStore.providers.length === 0" class="empty-state" style="padding:24px 0">
          <span class="ico">🔌</span>
          暂无服务商，新增 OpenAI 兼容接口的大模型服务
        </div>
        <div v-else class="provider-list">
          <div v-for="p in providerStore.providers" :key="p.id" class="provider-wrap">
            <div class="provider-item" :class="{ expanded: expandedId === p.id }">
              <span class="expand-tgl" @click="toggleExpand(p.id)">▶</span>
              <div class="logo" style="background:var(--as-accent-soft);color:var(--as-accent-strong)">{{ p.name.slice(0, 2) }}</div>
              <div class="info">
                <div class="n">{{ p.name }}</div>
                <div class="s">{{ p.baseUrl }}</div>
                <div v-if="testResults[p.id]" class="s" :style="{ color: testResults[p.id].ok ? 'var(--as-green)' : 'var(--as-red)' }">{{ testResults[p.id].message }}</div>
              </div>
              <button class="btn sm ghost" :disabled="testingId === p.id" @click="handleTest(p)">{{ testingId === p.id ? "测试中…" : "测试" }}</button>
              <span class="p-action" title="编辑" @click="handleEdit(p)">✎</span>
              <span class="p-action danger" title="删除" @click="handleDelete(p)">✕</span>
              <div class="switch" :class="{ on: p.enabled }" @click="toggleProvider(p)"></div>
            </div>
            <div v-if="expandedId === p.id" class="provider-models">
              <div class="model-list">
                <div v-if="modelsOf(p.id).length === 0" class="s" style="color:var(--as-text-faint)">暂无模型</div>
                <div v-for="m in modelsOf(p.id)" :key="m.id" class="model-item">
                  <span class="m-name">{{ m.displayName }}</span>
                  <span class="m-id">{{ m.modelId }}</span>
                  <span v-if="m.maxContext" class="m-id">{{ m.maxContext }} ctx</span>
                  <span class="m-del" @click="removeModel(m)">✕</span>
                </div>
                <div v-if="fetchingModels" class="s" style="color:var(--as-text-faint)">获取模型列表中…</div>
                <template v-else-if="addingModelId === p.id && !modelUseManual">
                  <div class="model-item">
                    <select v-model="newModel.modelId" @change="pickModel(newModel.modelId)" style="flex:1">
                      <option value="">选择模型</option>
                      <option v-for="id in availableModels(p.id)" :key="id" :value="id">{{ id }}</option>
                    </select>
                    <input v-model="newModel.displayName" placeholder="显示名（自动预填）" style="flex:0.8" />
                    <input v-model="newModel.maxContext" placeholder="上下文" type="number" style="width:70px" />
                    <button class="btn sm" :disabled="!newModel.modelId" @click="addModel(p.id)">确定</button>
                  </div>
                  <button class="btn sm ghost" @click="useManualInput()">手动输入模型 ID</button>
                </template>
                <template v-else-if="addingModelId === p.id">
                  <div v-if="modelFetchError" class="s" style="color:var(--as-red);margin:2px 6px">自动获取失败：{{ modelFetchError }}</div>
                  <div class="model-item">
                    <input v-model="newModel.modelId" placeholder="模型 ID" />
                    <input v-model="newModel.displayName" placeholder="显示名" />
                    <input v-model="newModel.maxContext" placeholder="上下文" type="number" />
                    <button class="btn sm" @click="addModel(p.id)">确定</button>
                  </div>
                  <button class="btn sm ghost" @click="retryFetch(p.id)">重试自动获取</button>
                </template>
                <button v-else class="btn sm ghost" @click="startAddModel(p.id)">＋ 添加模型</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="card">
        <h3>AI 任务模型分配</h3>
        <div class="task-assign">
          <div class="ta-row">
            <span class="t">全局默认模型</span>
            <select :value="taskModelMap[GLOBAL_DEFAULT_KEY] ?? ''" @change="onTaskModelChange(GLOBAL_DEFAULT_KEY, $event)">
              <option value="">（未设置）</option>
              <option v-for="m in providerStore.models" :key="m.id" :value="m.id">{{ m.displayName }}</option>
            </select>
          </div>
          <div v-for="t in tasks" :key="t.key" class="ta-row">
            <span class="t">{{ t.name }}</span>
            <select :value="taskModelMap[t.key] ?? ''" @change="onTaskModelChange(t.key, $event)">
              <option value="">全局默认</option>
              <option v-for="m in providerStore.models" :key="m.id" :value="m.id">{{ m.displayName }}</option>
            </select>
          </div>
        </div>
      </div>
    </div>
    <div class="card" style="margin-top:14px">
      <h3>最近调用日志</h3>
      <div v-if="providerStore.logs.length === 0" class="empty-state" style="padding:24px 0">
        <span class="ico">📜</span>
        暂无调用记录
      </div>
      <table v-else class="log-table">
        <tr><th>任务</th><th>模型</th><th>Token</th><th>状态</th><th>时间</th></tr>
        <tr v-for="log in providerStore.logs" :key="log.id">
          <td>{{ log.taskKey }}</td>
          <td class="mono">{{ log.modelName }}</td>
          <td class="mono">{{ log.tokenIn + log.tokenOut }}</td>
          <td><span class="status-dot" :class="log.status === 'success' ? 'ok' : 'bad'"></span> {{ log.status }}</td>
          <td class="mono">{{ formatTime(log.createTime) }}</td>
        </tr>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useModalStore } from "../stores/modal";
import { useProviderStore } from "../stores/provider";
import {
  updateProvider,
  deleteProvider,
  testProvider as testProviderApi,
  fetchProviderModels,
  createModel,
  deleteModel,
  saveTaskModel,
  AI_TASKS,
  GLOBAL_DEFAULT_KEY,
} from "../api";
import type { AiProvider, AiModel } from "../api";

const modalStore = useModalStore();
const providerStore = useProviderStore();

const testingId = ref<number | null>(null);
const testResults = reactive<Record<number, { ok: boolean; message: string }>>({});
const expandedId = ref<number | null>(null);
const addingModelId = ref<number | null>(null);
const newModel = reactive({
  modelId: "",
  displayName: "",
  maxContext: "",
  /** 自动获取到的服务商模型 id 列表 */
  fetched: [] as string[],
});
const fetchingModels = ref(false);
const modelFetchError = ref("");
/** true = /models 获取失败，回退手动输入 */
const modelUseManual = ref(true);

const tasks = AI_TASKS;
const taskModelMap = computed(() => providerStore.taskModelMap);

const modelsOf = (providerId: number): AiModel[] => providerStore.models.filter((m) => m.providerId === providerId);

function toggleExpand(id: number) {
  expandedId.value = expandedId.value === id ? null : id;
  addingModelId.value = null;
}

async function toggleProvider(provider: AiProvider) {
  provider.enabled = !provider.enabled;
  try {
    await updateProvider(provider);
  } catch (error) {
    console.error("更新服务商状态失败:", error);
  }
}

async function handleTest(provider: AiProvider) {
  testingId.value = provider.id;
  try {
    const result = await testProviderApi(provider.id);
    testResults[provider.id] = { ok: result.ok, message: result.message };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    testResults[provider.id] = { ok: false, message };
  } finally {
    testingId.value = null;
  }
}

function handleEdit(provider: AiProvider) {
  modalStore.openEditProvider(provider);
}

async function handleDelete(provider: AiProvider) {
  if (!window.confirm(`确定删除服务商「${provider.name}」？其下的模型也会一并删除。`)) {
    return;
  }
  try {
    await deleteProvider(provider.id);
    await providerStore.load();
  } catch (error) {
    console.error("删除服务商失败:", error);
  }
}

function startAddModel(providerId: number) {
  addingModelId.value = providerId;
  newModel.modelId = "";
  newModel.displayName = "";
  newModel.maxContext = "";
  void fetchModelList(providerId);
}

/** 自动获取服务商可用模型；失败回退手动输入。 */
async function fetchModelList(providerId: number) {
  fetchingModels.value = true;
  modelFetchError.value = "";
  modelUseManual.value = false;
  newModel.fetched = [];
  try {
    const { ok, message, models } = await fetchProviderModels(providerId);
    if (ok && models.length) {
      newModel.fetched = models;
    } else {
      modelUseManual.value = true;
      if (message) {
        modelFetchError.value = message;
      }
    }
  } catch (error) {
    modelUseManual.value = true;
    console.error("获取模型列表失败:", error);
  } finally {
    fetchingModels.value = false;
  }
}

/** 已添加过的 modelId 不再出现在下拉里 */
function availableModels(providerId: number): string[] {
  const added = new Set(modelsOf(providerId).map((m) => m.modelId));
  return newModel.fetched.filter((id) => !added.has(id));
}

function pickModel(id: string) {
  newModel.modelId = id;
  if (!newModel.displayName.trim()) {
    newModel.displayName = id;
  }
}

function retryFetch(providerId: number) {
  void fetchModelList(providerId);
}

function useManualInput() {
  modelUseManual.value = true;
}

async function addModel(providerId: number) {
  if (!newModel.modelId.trim() || !newModel.displayName.trim()) {
    return;
  }
  try {
    await createModel({
      providerId,
      modelId: newModel.modelId.trim(),
      displayName: newModel.displayName.trim(),
      maxContext: Number(newModel.maxContext) || null,
    });
    addingModelId.value = null;
    await providerStore.load();
  } catch (error) {
    console.error("添加模型失败:", error);
  }
}

async function removeModel(model: AiModel) {
  try {
    await deleteModel(model.id);
    await providerStore.load();
  } catch (error) {
    console.error("删除模型失败:", error);
  }
}

function onTaskModelChange(taskKey: string, event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  const modelId = value === "" ? null : Number(value);
  saveTaskModel(taskKey, modelId)
    .then(() => providerStore.load())
    .catch((error) => console.error("保存任务分配失败:", error));
}

function formatTime(iso: string): string {
  if (!iso) {
    return "";
  }
  return new Date(iso).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

onMounted(async () => {
  try {
    await providerStore.load();
  } catch (error) {
    console.error("加载模型配置失败:", error);
  }
});
</script>
