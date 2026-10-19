<template>
  <div class="page">
    <div class="page-title"><h1>模型配置</h1><div class="desc">服务商 · 模型 · 任务分配 · 调用日志</div></div>
    <div class="two-col" style="grid-template-columns:1fr 1fr">
      <div class="card">
        <h3>服务商 <button class="btn sm ghost" style="margin-left:auto" @click="showComingSoon">＋ 新增服务商</button></h3>
        <div v-if="providers.length === 0" class="empty-state" style="padding:24px 0">
          <span class="ico">🔌</span>
          暂无服务商，新增 OpenAI 兼容接口的大模型服务
        </div>
        <div v-else class="provider-list">
          <div v-for="p in providers" :key="p.id" class="provider-item">
            <div class="logo" style="background:var(--accent-soft);color:var(--accent-strong)">{{ p.name.slice(0, 2) }}</div>
            <div class="info"><div class="n">{{ p.name }}</div><div class="s">{{ p.baseUrl }}</div></div>
            <div class="switch" :class="{ on: p.enabled }" @click="p.enabled = !p.enabled"></div>
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
              <option v-for="m in models" :key="m.id" :value="m.displayName">{{ m.displayName }}</option>
            </select>
          </div>
        </div>
      </div>
    </div>
    <div class="card" style="margin-top:14px">
      <h3>最近调用日志</h3>
      <div v-if="logs.length === 0" class="empty-state" style="padding:24px 0">
        <span class="ico">📜</span>
        暂无调用记录
      </div>
      <table v-else class="log-table">
        <tr><th>任务</th><th>模型</th><th>Token</th><th>状态</th><th>时间</th></tr>
        <tr v-for="log in logs" :key="log.id">
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
import { onMounted, ref } from "vue";
import { getData } from "../api";
import type { AiProvider, AiModel, CallLog } from "../api";

const providers = ref<AiProvider[]>([]);
const models = ref<AiModel[]>([]);
const logs = ref<CallLog[]>([]);

const tasks = [
  { name: "文档知识点抽取", model: "" },
  { name: "AI 学习计划生成", model: "" },
  { name: "AI 习题生成", model: "" },
  { name: "讲解内容评估", model: "" },
  { name: "简答题 AI 阅卷", model: "" },
  { name: "学习报告生成", model: "" },
  { name: "图谱关联关系推理", model: "" },
];

function showComingSoon() {
  console.log("新增服务商功能待实现");
}

function formatTime(iso: string): string {
  if (!iso) {
    return "";
  }
  return new Date(iso).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

onMounted(async () => {
  try {
    const data = await getData();
    providers.value = data.providers;
    models.value = data.models;
    logs.value = data.logs;
  } catch (error) {
    console.error("加载模型配置失败:", error);
  }
});
</script>
