import { defineStore } from "pinia";
import { getData, getTaskModelMap } from "../api";
import type { AiProvider, AiModel, CallLog } from "../api";

export const useProviderStore = defineStore("provider", {
  state: () => ({
    providers: [] as AiProvider[],
    models: [] as AiModel[],
    logs: [] as CallLog[],
    taskModelMap: {} as Record<string, number | null>,
  }),
  actions: {
    async load() {
      const data = await getData();
      // structuredClone 深拷贝总是返回新引用，整体赋值能可靠触发响应式，同时隔离 store 与 data 引用
      this.providers = structuredClone(data.providers);
      this.models = structuredClone(data.models);
      this.logs = structuredClone(data.logs);
      this.taskModelMap = await getTaskModelMap();
    },
  },
});
