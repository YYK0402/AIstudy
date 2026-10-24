<template>
  <div class="page">
    <div class="page-title"><h1>模型配置</h1><div class="desc">服务商 · 模型 · 任务分配 · 提示词模板 · 调用日志</div></div>
    <div class="settings-tabs">
      <button class="settings-tab" :class="{ on: activeTab === 'models' }" @click="activeTab = 'models'">模型配置</button>
      <button class="settings-tab" :class="{ on: activeTab === 'prompts' }" @click="activeTab = 'prompts'">提示词模板</button>
    </div>
    <div v-if="settingsDirty" class="save-float">
      <span>设置有修改</span>
      <button class="btn primary sm" :disabled="settingsSaving" @click="saveSettings">
        {{ settingsSaving ? "保存中…" : "保存" }}
      </button>
    </div>
    <div v-show="activeTab === 'models'">
    <div class="two-col settings-two-col">
      <div class="card">
        <h3>服务商 <button class="btn sm ghost" style="margin-left:auto" @click="modalStore.openNewProvider()">＋ 新增服务商</button></h3>
        <div v-if="providerStore.providers.length === 0" class="empty-state" style="padding:24px 0">
          <span class="ico"><AppIcon name="link" :size="28" /></span>
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
              <span class="row-more">
                <button class="btn sm ghost row-more-btn" title="更多操作" @click.stop="toggleProviderMenu(p.id)">⋯</button>
                <div v-if="providerMenuId === p.id" class="row-menu" @click.stop>
                  <button @click.stop="closeProviderMenu(); handleEdit(p)">编辑</button>
                  <button class="danger" @click.stop="closeProviderMenu(); handleDelete(p)">删除</button>
                </div>
              </span>
              <div class="switch" :class="{ on: p.enabled }" @click="toggleProvider(p)"></div>
            </div>
            <div v-if="expandedId === p.id" class="provider-models">
              <div class="model-list">
                <div v-if="modelsOf(p.id).length === 0" class="s" style="color:var(--as-text-faint)">暂无模型</div>
                <div v-for="m in modelsOf(p.id)" :key="m.id" class="model-item">
                  <template v-if="editingModelId === m.id">
                    <input v-model="editModel.modelId" aria-label="模型 ID" placeholder="模型 ID" style="flex:1" />
                    <input v-model="editModel.displayName" aria-label="模型显示名" placeholder="显示名" style="flex:0.8" />
                    <input v-model="editModel.maxContext" aria-label="上下文长度" placeholder="上下文" type="number" style="width:70px" />
                    <input v-model="editModel.temperature" aria-label="温度" placeholder="温度" type="number" step="0.1" min="0" max="2" style="width:64px" />
                    <input v-model="editModel.maxTokens" aria-label="最大输出" placeholder="最大输出" type="number" style="width:78px" />
                    <button class="btn sm" @click="saveEditModel(m)">确定</button>
                    <button class="btn sm ghost" @click="editingModelId = null">取消</button>
                  </template>
                  <template v-else>
                    <span class="m-name">{{ m.displayName }}</span>
                    <span class="m-id">{{ m.modelId }}</span>
                    <span v-if="m.maxContext" class="m-id">{{ m.maxContext }} ctx</span>
                    <span v-if="m.temperature != null" class="m-id">t{{ m.temperature }}</span>
                    <span v-if="m.maxTokens != null" class="m-id">out{{ m.maxTokens }}</span>
                    <span class="m-del" title="编辑" style="opacity:1" @click="startEditModel(m)"><AppIcon name="pencil" :size="12" /></span>
                    <span class="m-del" title="删除" @click="removeModel(m)"><AppIcon name="x" :size="12" /></span>
                  </template>
                </div>
                <div v-if="fetchingModels" class="s" style="color:var(--as-text-faint)">获取模型列表中…</div>
                <template v-else-if="addingModelId === p.id && !modelUseManual">
                  <div class="model-item">
                    <select v-model="newModel.modelId" aria-label="服务商模型" @change="pickModel(newModel.modelId)" style="flex:1">
                      <option value="">选择模型</option>
                      <option v-for="id in availableModels(p.id)" :key="id" :value="id">{{ id }}</option>
                    </select>
                    <input v-model="newModel.displayName" aria-label="模型显示名" placeholder="显示名（自动预填）" style="flex:0.8" />
                    <input v-model="newModel.maxContext" aria-label="上下文长度" placeholder="上下文" type="number" style="width:70px" />
                    <input v-model="newModel.temperature" aria-label="温度" placeholder="温度" type="number" step="0.1" min="0" max="2" style="width:64px" />
                    <input v-model="newModel.maxTokens" aria-label="最大输出" placeholder="最大输出" type="number" style="width:78px" />
                    <button class="btn sm" :disabled="!newModel.modelId" @click="addModel(p.id)">确定</button>
                  </div>
                  <button class="btn sm ghost" @click="useManualInput()">手动输入模型 ID</button>
                </template>
                <template v-else-if="addingModelId === p.id">
                  <div v-if="modelFetchError" class="s" style="color:var(--as-red);margin:2px 6px">自动获取失败：{{ modelFetchError }}</div>
                  <div class="model-item">
                    <input v-model="newModel.modelId" aria-label="模型 ID" placeholder="模型 ID" />
                    <input v-model="newModel.displayName" aria-label="模型显示名" placeholder="显示名" />
                    <input v-model="newModel.maxContext" aria-label="上下文长度" placeholder="上下文" type="number" />
                    <input v-model="newModel.temperature" aria-label="温度" placeholder="温度" type="number" step="0.1" min="0" max="2" style="width:64px" />
                    <input v-model="newModel.maxTokens" aria-label="最大输出" placeholder="最大输出" type="number" style="width:78px" />
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
            <select :value="taskModelMap[GLOBAL_DEFAULT_KEY] ?? ''" aria-label="全局默认模型" @change="onTaskModelChange(GLOBAL_DEFAULT_KEY, $event)">
              <option value="">（未设置）</option>
              <option v-for="m in providerStore.models" :key="m.id" :value="m.id">{{ m.displayName }}</option>
            </select>
          </div>
          <div v-for="t in visibleTasks" :key="t.key" class="ta-row">
            <span class="t">{{ t.name }}</span>
            <select :value="taskModelMap[t.key] ?? ''" :aria-label="`${t.name} 模型`" @change="onTaskModelChange(t.key, $event)">
              <option value="">全局默认</option>
              <option v-for="m in providerStore.models" :key="m.id" :value="m.id">{{ m.displayName }}</option>
            </select>
          </div>
        </div>
        <button v-if="tasks.length > TASK_ASSIGN_PREVIEW" class="link-btn" style="margin-top:8px" @click="taskAssignExpanded = !taskAssignExpanded">
          {{ taskAssignExpanded ? "收起" : `展开全部 ${tasks.length} 项` }}
        </button>
        <div class="s" style="color:var(--as-text-faint);margin-top:10px">
          优先级：课程指定的模型（课程编辑弹窗设置）＞ 任务级 ＞ 全局默认。
        </div>
      </div>
    </div>
    <div class="card" style="margin-top:14px" @change="markDirty" @input="markDirty">
      <h3>数据与存储
        <button class="btn primary sm" :disabled="settingsSaving" @click="saveSettings" style="margin-left:auto">
          {{ settingsSaving ? "保存中…" : "保存" }}
        </button>
      </h3>
      <div class="ta-row">
        <span class="t">章节识别方式</span>
        <select v-model="settings.chapterMode" aria-label="章节识别方式">
          <option value="manual">手动（上传后不自动建目录）</option>
          <option value="auto">自动（上传资料后按标题识别目录）</option>
        </select>
      </div>
      <div class="s" style="color:var(--as-text-faint);margin-top:4px">
        自动模式：上传 Word/Markdown/PPT 后按标题层级识别章节结构并弹出预览确认；PDF 采用字号启发式识别，可能不精确，可在预览中修正。
      </div>
      <div class="ta-row" style="margin-top:14px">
        <span class="t">资料持久化到思源</span>
        <div class="switch" :class="{ on: settings.persistToSiyuan }" @click="togglePersist"></div>
      </div>
      <div v-if="settings.persistToSiyuan" class="ta-row" style="margin-top:10px">
        <span class="t">笔记本名称</span>
        <input v-model="settings.notebookName" aria-label="思源笔记本名称" placeholder="AI 研习" style="flex:1" />
      </div>
      <div class="s" style="color:var(--as-text-faint);margin-top:6px">
        开启后，课程、上传的资料、章节会同步写入思源笔记本（一个课程 = 一个顶层文档），方便浏览与检索；关闭则仅存插件数据。
      </div>
      <div class="ta-row" style="margin-top:14px">
        <span class="t">AI 失败自动重试</span>
        <select v-model.number="settings.aiRetryCount" aria-label="AI 失败重试次数">
          <option :value="0">关闭</option>
          <option :value="1">1 次（超时 / 5xx / 网络错误）</option>
          <option :value="2">2 次（超时 / 5xx / 网络错误）</option>
        </select>
      </div>
      <div class="s" style="color:var(--as-text-faint);margin-top:6px">
        仅对超时、5xx、网络错误自动重试（间隔 2 秒递增），每次尝试均记入调用日志；鉴权等 4xx 错误不重试。
      </div>
      <div class="ta-row" style="margin-top:14px">
        <span class="t">请求速率限制（次/分钟）</span>
        <input v-model.number="settings.aiRateLimitPerMin" aria-label="每分钟请求上限" type="number" min="0" step="1" placeholder="0 = 不限" style="width:90px" />
      </div>
      <div class="s" style="color:var(--as-text-faint);margin-top:6px">
        0 = 不限。AI 调用（全部服务商共享窗口）超过上限时排队等待窗口释放（本地 Ollama 建议 30 以上，公网 API 建议 10-20）。
      </div>
    </div>
    <div class="card" style="margin-top:14px">
      <h3>最近调用日志</h3>
      <div v-if="providerStore.logs.length === 0" class="empty-state" style="padding:24px 0">
        <span class="ico">📜</span>
        暂无调用记录
      </div>
      <template v-else>
        <table class="log-table">
          <tr><th>任务</th><th>模型</th><th>Token</th><th>状态</th><th>时间</th></tr>
          <template v-for="log in pagedLogs" :key="log.id">
            <tr class="log-row" :class="{ active: detailLogId === log.id }" title="点击查看明细" @click="toggleLogDetail(log.id)">
              <td>{{ log.taskKey }}</td>
              <td class="mono">{{ log.modelName }}</td>
              <td class="mono">{{ log.tokenIn + log.tokenOut }}</td>
              <td><span class="status-dot" :class="log.status === 'success' ? 'ok' : 'bad'"></span> {{ log.status }}</td>
              <td class="mono">{{ formatTime(log.createTime) }}</td>
            </tr>
            <tr v-if="detailLogId === log.id" class="log-detail-row">
              <td colspan="5">
                任务 {{ log.taskKey }} · 服务商 {{ log.providerName }} · 模型 {{ log.modelName }}<br />
                输入 token {{ log.tokenIn }} · 输出 token {{ log.tokenOut }} · {{ formatFullTime(log.createTime) }}
                <div v-if="log.status !== 'success' && log.errorMsg" class="log-err">✗ {{ log.errorMsg }}</div>
                <div v-else class="s" style="color:var(--as-text-faint)">调用成功（不保存请求/响应正文）</div>
              </td>
            </tr>
          </template>
        </table>
        <div v-if="logTotalPages > 1" class="pagination">
          <button class="btn sm ghost" :disabled="logPage === 1" @click="logPage--">‹ 上一页</button>
          <span class="pg-info">{{ logPage }} / {{ logTotalPages }}</span>
          <button class="btn sm ghost" :disabled="logPage === logTotalPages" @click="logPage++">下一页 ›</button>
        </div>
      </template>
    </div>
    </div>
    <div v-show="activeTab === 'prompts'">
      <div class="s" style="color:var(--as-text-faint);margin-bottom:12px">
        修改 8 类 AI 任务的提示词。模板中用
        <code class="code-inline">{{ "{varName}" }}</code>
        占位，运行时由系统填充实际值（各任务可用变量见卡片内列表）；删除占位符则该部分信息不再提供。保存与默认完全一致的内容会自动回到「默认」状态。
      </div>
      <div v-if="promptLoading" class="s" style="padding:24px 0;color:var(--as-text-faint)">加载中…</div>
      <template v-else>
        <div v-for="t in promptViews" :key="t.key" class="card" style="margin-bottom:14px">
          <h3>
            {{ t.name }}
            <span class="ptag" :class="t.isCustom ? 'custom' : 'def'">{{ t.isCustom ? "自定义" : "默认" }}</span>
            <span style="margin-left:auto;display:flex;gap:6px">
              <button
                class="btn sm ghost"
                :disabled="promptSavingKey === t.key || !t.isCustom"
                @click="resetPrompt(t)"
              >恢复默认</button>
              <button class="btn sm primary" :disabled="promptSavingKey === t.key || !promptDirty(t)" @click="savePrompt(t)">
                {{ promptSavingKey === t.key ? "保存中…" : "保存" }}
              </button>
            </span>
          </h3>
          <div class="s" style="color:var(--as-text-faint)">{{ t.desc }}</div>
          <div class="prompt-vars">
            <span v-for="v in t.vars" :key="v.name" class="prompt-var"><code class="code-inline">{{ v.name }}</code>{{ v.desc }}</span>
            <span v-if="t.vars.length === 0" class="prompt-var">（无变量，纯固定提示词）</span>
          </div>
          <label class="prompt-label">系统提示词（system）</label>
          <textarea v-model="promptEdits[t.key].system" class="prompt-ta" rows="6" :aria-label="`${t.name} 系统提示词`" spellcheck="false"></textarea>
          <label class="prompt-label">用户提示模板（user）</label>
          <textarea v-model="promptEdits[t.key].user" class="prompt-ta" rows="4" :aria-label="`${t.name} 用户提示词`" spellcheck="false"></textarea>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import AppIcon from "../components/AppIcon.vue";
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { useModalStore } from "../stores/modal";
import { useProviderStore } from "../stores/provider";
import {
  updateProvider,
  deleteProvider,
  testProvider as testProviderApi,
  fetchProviderModels,
  createModel,
  updateModel,
  deleteModel,
  saveTaskModel,
  getSettings,
  updateSettings,
  AI_TASKS,
  GLOBAL_DEFAULT_KEY,
  getPromptTemplateViews,
  savePromptTemplate as savePromptTemplateApi,
  resetPromptTemplate as resetPromptTemplateApi,
} from "../api";
import type { AiProvider, AiModel, PromptTemplateView } from "../api";

const modalStore = useModalStore();
const providerStore = useProviderStore();

const settings = reactive({
  chapterMode: "manual" as "manual" | "auto",
  persistToSiyuan: false,
  notebookName: "AI 研习",
  aiRetryCount: 0 as 0 | 1 | 2,
  aiRateLimitPerMin: 0,
});
const settingsSaving = ref(false);
/** 服务商行「⋯」菜单：同一时间只开一个 */
const providerMenuId = ref<number | null>(null);

function toggleProviderMenu(id: number) {
  providerMenuId.value = providerMenuId.value === id ? null : id;
}
function closeProviderMenu() {
  providerMenuId.value = null;
}
/** 底栏「有修改」提示：加载阶段不置脏，之后任何字段变更都提示 */
const settingsDirty = ref(false);
let settingsReady = false;

function markDirty() {
  if (settingsReady) settingsDirty.value = true;
}

function togglePersist() {
  settings.persistToSiyuan = !settings.persistToSiyuan;
  markDirty();
}
const logPage = ref(1);
const LOG_PAGE_SIZE = 10;
/** 当前展开明细的日志 id（同一时间只展开一条） */
const detailLogId = ref<number | null>(null);

function toggleLogDetail(id: number) {
  detailLogId.value = detailLogId.value === id ? null : id;
}

const pagedLogs = computed(() => {
  const sorted = [...providerStore.logs].sort((a, b) => b.id - a.id);
  const start = (logPage.value - 1) * LOG_PAGE_SIZE;
  return sorted.slice(start, start + LOG_PAGE_SIZE);
});
const logTotalPages = computed(() => Math.max(1, Math.ceil(providerStore.logs.length / LOG_PAGE_SIZE)));

const testingId = ref<number | null>(null);
const testResults = reactive<Record<number, { ok: boolean; message: string }>>({});
const expandedId = ref<number | null>(null);
const addingModelId = ref<number | null>(null);
const newModel = reactive({
  modelId: "",
  displayName: "",
  maxContext: "",
  temperature: "",
  maxTokens: "",
  /** 自动获取到的服务商模型 id 列表 */
  fetched: [] as string[],
});
const fetchingModels = ref(false);
const modelFetchError = ref("");
/** true = /models 获取失败，回退手动输入 */
const modelUseManual = ref(true);

const tasks = AI_TASKS;
/** 任务分配默认只展示常用项，避免设置页过long */
const TASK_ASSIGN_PREVIEW = 5;
const taskAssignExpanded = ref(false);
const visibleTasks = computed(() =>
  taskAssignExpanded.value ? tasks : tasks.slice(0, TASK_ASSIGN_PREVIEW),
);
const taskModelMap = computed(() => providerStore.taskModelMap);

// ===== 提示词模板 Tab =====
const activeTab = ref<"models" | "prompts">("models");
const promptViews = ref<PromptTemplateView[]>([]);
const promptLoading = ref(true);
const promptSavingKey = ref<string | null>(null);
const promptEdits = reactive<Record<string, { system: string; user: string }>>({});

async function loadPromptTemplates() {
  promptLoading.value = true;
  try {
    promptViews.value = await getPromptTemplateViews();
    for (const v of promptViews.value) {
      promptEdits[v.key] = { system: v.current.system, user: v.current.user };
    }
  } catch (error) {
    console.error("加载提示词模板失败:", error);
    window.siyuanAiStudy.showMessage("加载提示词模板失败", 4000, "error");
  } finally {
    promptLoading.value = false;
  }
}

function promptDirty(t: PromptTemplateView): boolean {
  const e = promptEdits[t.key];
  return !!e && (e.system !== t.current.system || e.user !== t.current.user);
}

async function savePrompt(t: PromptTemplateView) {
  const e = promptEdits[t.key];
  if (!e) return;
  if (!e.system.trim()) {
    window.siyuanAiStudy.showMessage("系统提示词不能为空", 4000, "error");
    return;
  }
  promptSavingKey.value = t.key;
  try {
    await savePromptTemplateApi(t.key, { system: e.system, user: e.user });
    promptViews.value = await getPromptTemplateViews();
    window.siyuanAiStudy.showMessage("提示词模板已保存");
  } catch (error) {
    console.error("保存提示词模板失败:", error);
    window.siyuanAiStudy.showMessage(error instanceof Error ? error.message : "保存提示词模板失败", 4000, "error");
  } finally {
    promptSavingKey.value = null;
  }
}

async function resetPrompt(t: PromptTemplateView) {
  if (!window.confirm(`确定将「${t.name}」恢复为默认模板？`)) return;
  promptSavingKey.value = t.key;
  try {
    await resetPromptTemplateApi(t.key);
    promptEdits[t.key] = { system: t.def.system, user: t.def.user };
    promptViews.value = await getPromptTemplateViews();
    window.siyuanAiStudy.showMessage("已恢复默认模板");
  } catch (error) {
    console.error("恢复默认模板失败:", error);
    window.siyuanAiStudy.showMessage(error instanceof Error ? error.message : "恢复默认模板失败", 4000, "error");
  } finally {
    promptSavingKey.value = null;
  }
}

const modelsOf = (providerId: number): AiModel[] => providerStore.models.filter((m) => m.providerId === providerId);

function toggleExpand(id: number) {
  expandedId.value = expandedId.value === id ? null : id;
  addingModelId.value = null;
  editingModelId.value = null;
}

async function toggleProvider(provider: AiProvider) {
  provider.enabled = !provider.enabled;
  try {
    await updateProvider(provider);
  } catch (error) {
    console.error("更新服务商状态失败:", error);
    window.siyuanAiStudy.showMessage(error instanceof Error ? error.message : "更新服务商状态失败", 4000, "error");
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
    window.siyuanAiStudy.showMessage(error instanceof Error ? error.message : "删除服务商失败", 4000, "error");
  }
}

function startAddModel(providerId: number) {
  addingModelId.value = providerId;
  newModel.modelId = "";
  newModel.displayName = "";
  newModel.maxContext = "";
  newModel.temperature = "";
  newModel.maxTokens = "";
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
      temperature: parseOptionalNum(newModel.temperature, 0, 2),
      maxTokens: parseOptionalInt(newModel.maxTokens),
    });
    addingModelId.value = null;
    await providerStore.load();
  } catch (error) {
    console.error("添加模型失败:", error);
    window.siyuanAiStudy.showMessage(error instanceof Error ? error.message : "添加模型失败", 4000, "error");
  }
}

// 注意：v-model 绑定 type=number 输入时值为 number（Vue 自动转换），空输入为 ""
function parseOptionalNum(raw: string | number, min: number, max: number): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function parseOptionalInt(raw: string | number): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

const editingModelId = ref<number | null>(null);
const editModel = reactive({
  modelId: "",
  displayName: "",
  maxContext: "",
  temperature: "",
  maxTokens: "",
});

function startEditModel(m: AiModel) {
  editingModelId.value = m.id;
  editModel.modelId = m.modelId;
  editModel.displayName = m.displayName;
  editModel.maxContext = m.maxContext === null ? "" : String(m.maxContext);
  editModel.temperature = m.temperature == null ? "" : String(m.temperature);
  editModel.maxTokens = m.maxTokens == null ? "" : String(m.maxTokens);
}

async function saveEditModel(m: AiModel) {
  if (!editModel.modelId.trim() || !editModel.displayName.trim()) {
    return;
  }
  try {
    await updateModel(m.id, {
      modelId: editModel.modelId.trim(),
      displayName: editModel.displayName.trim(),
      maxContext: Number(editModel.maxContext) || null,
      temperature: parseOptionalNum(editModel.temperature, 0, 2),
      maxTokens: parseOptionalInt(editModel.maxTokens),
    });
    editingModelId.value = null;
    await providerStore.load();
  } catch (error) {
    console.error("更新模型失败:", error);
    window.siyuanAiStudy.showMessage(error instanceof Error ? error.message : "更新模型失败", 4000, "error");
  }
}

async function removeModel(model: AiModel) {
  if (!window.confirm(`确定删除模型「${model.displayName}」？已绑定该模型的任务将回退到全局默认。`)) return;
  try {
    await deleteModel(model.id);
    await providerStore.load();
  } catch (error) {
    console.error("删除模型失败:", error);
    window.siyuanAiStudy.showMessage(error instanceof Error ? error.message : "删除模型失败", 4000, "error");
  }
}

function onTaskModelChange(taskKey: string, event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  const modelId = value === "" ? null : Number(value);
  saveTaskModel(taskKey, modelId)
    .then(() => providerStore.load())
    .catch((error) => {
      console.error("保存任务分配失败:", error);
      window.siyuanAiStudy.showMessage(error instanceof Error ? error.message : "保存任务分配失败", 4000, "error");
    });
}

async function saveSettings() {
  settingsSaving.value = true;
  try {
    await updateSettings({
      chapterMode: settings.chapterMode,
      persistToSiyuan: settings.persistToSiyuan,
      notebookName: settings.notebookName.trim() || "AI 研习",
      aiRetryCount: settings.aiRetryCount,
      aiRateLimitPerMin: Number(settings.aiRateLimitPerMin) || 0,
    });
    settings.notebookName = settings.notebookName.trim() || "AI 研习";
    settingsDirty.value = false;
    window.siyuanAiStudy.showMessage("设置已保存");
  } catch (error) {
    console.error("保存应用设置失败:", error);
    window.siyuanAiStudy.showMessage(error instanceof Error ? error.message : "保存应用设置失败", 4000, "error");
  } finally {
    settingsSaving.value = false;
  }
}

function formatTime(iso: string): string {
  if (!iso) {
    return "";
  }
  return new Date(iso).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function formatFullTime(iso: string): string {
  if (!iso) {
    return "";
  }
  return new Date(iso).toLocaleString("zh-CN");
}

onMounted(async () => {
  document.addEventListener("click", closeProviderMenu);
  void loadPromptTemplates();
  // 先加载应用设置（本地数据，快），再拉服务商/模型，避免慢请求拖住「有修改」判定
  try {
    const s = await getSettings();
    settings.chapterMode = s.chapterMode;
    settings.persistToSiyuan = s.persistToSiyuan;
    settings.notebookName = s.notebookName;
    settings.aiRetryCount = (s.aiRetryCount === 1 || s.aiRetryCount === 2 ? s.aiRetryCount : 0) as 0 | 1 | 2;
    settings.aiRateLimitPerMin = Number(s.aiRateLimitPerMin) || 0;
    // 等 watch 消化完加载赋值再允许置脏，避免一进页面就提示「有修改」
    await nextTick();
    settingsReady = true;
  } catch (error) {
    console.error("加载应用设置失败:", error);
  }
  try {
    await providerStore.load();
  } catch (error) {
    console.error("加载模型配置失败:", error);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener("click", closeProviderMenu);
});
</script>
