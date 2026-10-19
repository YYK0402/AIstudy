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
          <div v-for="p in providerStore.providers" :key="p.id" class="provider-item">
            <div class="logo" style="background:var(--as-accent-soft);color:var(--as-accent-strong)">{{ p.name.slice(0, 2) }}</div>
            <div class="info"><div class="n">{{ p.name }}</div><div class="s">{{ p.baseUrl }}</div></div>
            <div class="switch" :class="{ on: p.enabled }" @click="toggleProvider(p)"></div>
          </div>
        </div>
      </div>
      <div class="card">
        <h3>AI 任务模型分配</h3>
        <div class="task-assign">
          <div v-for="t in tasks" :key="t.name" class="ta-row">
            <span class="t">{{ t.name }}</span>
            <select :value="t.model">
              <option value="">全局默认</option>
              <option v-for="m in providerStore.models" :key="m.id" :value="m.displayName">{{ m.displayName }}</option>
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
import { onMounted } from "vue";
import { useModalStore } from "../stores/modal";
import { useProviderStore } from "../stores/provider";
import { updateProvider } from "../api";
import type { AiProvider } from "../api";

const modalStore = useModalStore();
const providerStore = useProviderStore();

const tasks = [
  { name: "文档知识点抽取", model: "" },
  { name: "AI 学习计划生成", model: "" },
  { name: "AI 习题生成", model: "" },
  { name: "讲解内容评估", model: "" },
  { name: "简答题 AI 阅卷", model: "" },
  { name: "学习报告生成", model: "" },
  { name: "图谱关联关系推理", model: "" },
];

async function toggleProvider(provider: AiProvider) {
  provider.enabled = !provider.enabled;
  try {
    await updateProvider(provider);
  } catch (error) {
    console.error("更新服务商状态失败:", error);
  }
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
